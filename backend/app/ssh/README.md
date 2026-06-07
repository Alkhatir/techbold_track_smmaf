# `app/ssh` — SSH execution, safety, and redaction

This package is where commands actually touch a customer VM — and where the
backend's hardest safety guarantees live. It does three jobs:

| File | Role |
|---|---|
| `safety.py` | **Deterministic** command safety classifier. The LLM never decides safety — this does. |
| `runner.py` | Paramiko SSH client: connect, run a command with a timeout, truncate + redact output. |
| `redactor.py` | Masks secrets in any text/dict before it is logged or returned. |

---

## `safety.py` — the safety gate

`classify_command(command) -> SafetyDecision` is the single authority on whether a
command may run and how risky it is. It is called both when the agent proposes a
command and again immediately before execution (and after any technician edit).

How it works:

1. **Build the candidate set.** Besides the raw command it also checks:
   - the **inner command** of a shell wrapper (`bash -c "…"`), to catch
     `bash -c "rm -rf /"` style bypasses (`_extract_inner`); and
   - the **sudo-stripped** form, so classifiers see the real base command.
2. **Hard blocks first.** `_HARD_BLOCKS` is a list of regex → reason pairs for
   things that must *never* run, e.g. broad recursive `rm`/`chmod`/`chown` on
   system roots, `mkfs`, `dd` to a device, fork bombs, history tampering, reading
   `/etc/shadow` / `.pem` / SSH private keys / `.env`, disabling firewall/audit
   services, `kill 1`. Any match → `allowed=False`, `risk=BLOCKED`.
3. **Risk classification (first match wins).** `_RISK_PATTERNS` maps commands to a
   `RiskLevel`:
   - `READ_ONLY` — `systemctl status`, `journalctl`, `ss`/`netstat`, `df`/`du`/`free`,
     `ps`, `ping`/`dig`/`nslookup`/`traceroute`/`resolvectl`, `curl` (unless it
     uploads data or writes to a path), `cat`/`grep`/`ls`/`stat`/etc.,
     `nginx -t`, version checks, `dpkg -l`, `crontab -l`.
   - `SERVICE_RESTART` — `systemctl restart|reload|start`.
   - `LOW_CHANGE` — targeted `mkdir`/`touch`/`ln -s`/`chown`/`chmod`/`systemctl enable`.
   - `PACKAGE_CHANGE` — `apt`/`pip`/`snap` install/remove/update.
   - `NEEDS_MANUAL_REVIEW` — `sed -i`, `tee`, `mv`/`cp` into `/etc`, redirects into
     `/etc`, DB shells (`mysql`/`psql`/`sqlite3`/`mongosh`), interactive editors.
4. **Default.** Anything unmatched is **allowed but `NEEDS_MANUAL_REVIEW`** — it
   surfaces to the technician rather than being silently trusted or dropped.

> The classifier is intentionally *context-aware*: a targeted `chown` on
> `/var/www/uploads` is `LOW_CHANGE`, but a recursive `chown -R … /var` is a hard
> block. See `tests/test_safety.py` for the exact allow/block expectations.

`SafetyDecision` (in `app/models.py`) carries `allowed`, `risk`, `reason`, and the
`normalized_command`.

## `runner.py` — `SSHRunner`

Wraps a single Paramiko connection for one session.

- **`connect()`** — loads the private key (tries RSA, then Ed25519, then ECDSA via
  `_load_key`), opens the connection with `AutoAddPolicy`, and maps Paramiko
  auth/SSH/OS errors to a clean `SSHConnectionError`.
- **`is_connected`** — checks the transport is active.
- **`run(command_id, command, risk)`** — executes with the configured timeout,
  reads stdout/stderr and the exit code, detects timeouts, **truncates** output to
  `max_output_chars`, and returns a `CommandResult`. Output is passed through
  `redact_text` so **no secrets are ever stored or returned** (the result is
  flagged `redacted=True`).
- **`close()`** — best-effort teardown.

Live runners are held in `app/state.py::ssh_runners`, keyed by session id (they are
not serialisable, so they live outside the session objects).

Timeouts and output caps come from `Settings`
(`command_timeout_seconds`, `max_command_output_chars`).

## `redactor.py`

Two entry points, used by `runner.py` (command output) and `audit/log.py`
(structured event data):

- **`redact_text(text)`** — regex substitutions for PEM private-key blocks,
  `Authorization: Bearer` headers, SSH public-key material, `password=`/`token=`/
  `api_key=`/`secret=` assignments, credentials embedded in DB URLs, and sensitive
  `.env`-style assignments (`ANTHROPIC_*`, `AWS_*`, `*_SECRET`, …). Patterns are
  ordered most-specific first.
- **`redact_dict(data)`** — recursively walks a dict, fully masking values whose
  **key** looks sensitive (`password`, `token`, `secret`, `api_key`,
  `authorization`, `private_key`, …) and running `redact_text` over remaining
  string values.

All replaced material becomes the literal `[REDACTED_SECRET]`.

---

## Where this fits

```
agent proposes command
     └─► classify_command()  ── BLOCKED ─►  flagged, never queued
                              └─ allowed ─►  ProposedCommand(risk=…)
technician approves (maybe edits)
     └─► classify_command() again  ── BLOCKED ─►  refused
                                    └─ allowed ─►  SSHRunner.run()
                                                       └─► redact_text(output) ─► CommandResult
```
