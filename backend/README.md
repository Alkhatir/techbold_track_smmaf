# Backend — AI Service Desk Autopilot

FastAPI service that powers the technician workspace. It loads tickets from the
**Phoenix ERP**, opens an SSH session to the customer's Linux VM, and uses
**Claude** to diagnose problems and propose fixes — but **never executes anything
without explicit technician approval**.

> The single most important design rule: **human-in-the-loop is non-negotiable.**
> Claude only ever *proposes* commands. A deterministic safety classifier
> (`app/ssh/safety.py`) is the backstop, and a technician must approve every
> command before it touches a customer VM.

---

## What the backend does (the flow)

```
Technician (browser)
  │  REST + WebSocket
  ▼
FastAPI backend  ──────►  Phoenix ERP (httpx)      fetch tickets, submit activity
        │         ──────►  Customer VM (Paramiko)    run *approved* commands over SSH
        └─────────►  Anthropic Claude (SDK)    analyze, propose fix, draft activity
```

A ticket is worked through a **session** — a state machine held entirely in
memory. The lifecycle (see `SessionState` in `app/models.py`):

```
CREATED
  → SYSTEM_LOADED            ticket + customer system fetched from ERP
  → CONNECTION_PENDING       waiting for technician to approve SSH
  → CONNECTED                SSH established
  → DIAGNOSING               Claude proposed read-only diagnostics
  → FIX_PENDING              Claude proposed a fix, awaiting approval
  → FIXING / VALIDATING      approved commands running
  → ACTIVITY_READY           Claude drafted the ERP activity log
  → SUBMITTED                activity posted to ERP, ticket marked DONE
  (ABORTED / ERROR are terminal off-ramps)
```

Each step is gated:

1. **Create session** → backend pulls the ticket + customer system info from the ERP.
2. **Approve connection** → only then does the backend SSH into the VM.
3. **Analyze** → Claude returns hypotheses + *proposed* read-only diagnostics.
   Every proposed command is run through the safety classifier; blocked ones are
   flagged, never queued.
4. **Approve each command** → the technician approves (optionally edits) a command;
   it is re-classified for safety, then executed. Output is redacted of secrets.
5. **Propose fix** → with diagnostic evidence in hand, Claude proposes a minimal
   fix plus validation commands — again all subject to approval.
6. **Generate activity** → Claude drafts a structured ERP activity (summary, root
   cause, actions, validation).
7. **Submit activity** → posted to the ERP and the ticket is set to `DONE`.

Every action — by `system`, `technician`, or `agent` — is recorded in an
in-memory audit trail.

---

## Project layout

```
backend/
├── app/
│   ├── main.py            FastAPI app: lifespan, CORS, router registration, /health
│   ├── config.py          Pydantic settings loaded from .env
│   ├── models.py          All shared Pydantic models + enums (single source of truth)
│   ├── state.py           In-memory session store + live SSH runner registry
│   ├── dependencies.py    Provider functions (Anthropic client, ERP client, audit)
│   ├── api/               HTTP + WebSocket routes        (see api/README.md)
│   ├── agent/             Claude orchestration + prompts  (see agent/README.md)
│   ├── ssh/               SSH execution + safety + redaction (see ssh/README.md)
│   ├── erp/               Phoenix ERP HTTP client         (see erp/README.md)
│   ├── audit/             Append-only audit log           (see audit/README.md)
│   └── activity/          Activity-draft helper           (see activity/README.md)
├── tests/                 pytest suite                    (see tests/README.md)
├── pyproject.toml         Dependencies + pytest config (canonical)
├── requirements.txt       Used by the Dockerfile only
└── Dockerfile             python:3.11-slim image
```

### Key modules at a glance

| Module | Responsibility |
|---|---|
| `main.py` | Wires the app together. Opens one shared `AsyncAnthropic` client on startup (lifespan), registers the `tickets`, `sessions`, `agent` routers under `/api`, and the WebSocket router at the root. |
| `config.py` | `Settings` (pydantic-settings) read from `.env`. Holds API keys, ERP URL/token, SSH key locations and user, command timeout, and max output size. |
| `models.py` | Every Pydantic model and enum used across the app: `Ticket`, `TicketSession`, `ProposedCommand`, `CommandResult`, `AgentAnalysis`, `FixPlan`, `ActivityDraft`, `RiskLevel`, `SessionState`, etc. The ERP-facing models mirror `docs/phoenix-openapi.yaml`. |
| `state.py` | Two module-level dicts: `sessions` (serialisable session objects, keyed by `session_id`) and `ssh_runners` (live, non-serialisable Paramiko runners). **No database — restarting the process loses all sessions.** |
| `dependencies.py` | Small provider helpers. Note the ERP client is built per-request; the Anthropic client is a single long-lived instance held on `app.state`. |

---

## Running it

### With Docker (recommended — runs frontend + backend together)

From the **repo root**:

```bash
cp .env.example .env      # fill in API keys + ERP URL
docker compose up --build # frontend :5173, backend :8000
```

The Dockerfile installs from `requirements.txt` and serves with uvicorn on
`0.0.0.0:8000`.

### Locally (this project uses `uv`)

```bash
cd backend
uv sync --dev                          # install runtime + dev deps from pyproject/uv.lock
uv run uvicorn app.main:app --reload   # http://localhost:8000
```

Health check: `GET http://localhost:8000/health` → `{"status": "ok"}`.

> **Heads-up on env files:** the backend loads `.env` from the *current working
> directory* (`SettingsConfigDict(env_file=".env")`). Run uvicorn from `backend/`
> with a `backend/.env`, or export the variables in your shell.

### Tests

`pytest` config lives in `pyproject.toml` (`asyncio_mode = "auto"`, `testpaths = ["tests"]`).
Set `PYTHONPATH=.` so the tests import the local `app` package rather than any
polluted system path:

```bash
cd backend
PYTHONPATH=. uv run pytest                  # whole suite
PYTHONPATH=. uv run pytest tests/test_safety.py   # one file
```

---

## Environment variables

Configured via `.env` (see `.env.example`). Loaded by `app/config.py`.

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `ANTHROPIC_MODEL` | Model ID | `claude-sonnet-4-20250514` |
| `ERP_BASE_URL` | Phoenix ERP base URL | — |
| `ERP_BEARER_TOKEN` | Bearer token for the ERP | — |
| `SSH_KEYS_DIR` | Directory of per-customer keys | `./keys` |
| `SSH_PRIVATE_KEY_PATH` | Fallback key when no per-customer key matches | `./keys/id_rsa.pem` |
| `SSH_DEFAULT_USER` | Default SSH login user | `azureuser` |
| `COMMAND_TIMEOUT_SECONDS` | Per-command SSH timeout | `30` |
| `MAX_COMMAND_OUTPUT_CHARS` | Truncate command stdout/stderr beyond this | `12000` |

SSH keys live in `./keys/` (git-ignored). Key selection logic is in
`api/routes_sessions.py::_resolve_key_path` (ERP-provided path → `keys/<customer_id>_key.pem`
→ `keys/case<N>_key.pem` → global default).

---

## HTTP & WebSocket API

All HTTP routes are mounted under `/api`. The WebSocket lives at the root.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness probe |
| `GET /api/me` | Logged-in technician profile (from ERP) |
| `GET /api/tickets` | List the technician's open tickets (filter by `status`, `priority`, `sort`) |
| `GET /api/tickets/{id}` | Single ticket |
| `GET /api/tickets/{id}/system` | Customer system / SSH target for a ticket |
| `POST /api/sessions` | Create a session for a ticket (loads ticket + system) |
| `GET /api/sessions` / `GET /api/sessions/{id}` | List / fetch sessions |
| `GET /api/sessions/{id}/logs` | Audit events for a session |
| `POST /api/sessions/{id}/approve-connection` | Approve/reject SSH; on approve, connects |
| `POST /api/sessions/{id}/commands/{cmd_id}/approve` | Approve (optionally edit) / reject + execute a command |
| `POST /api/sessions/{id}/abort` | Abort session, close SSH |
| `POST /api/sessions/{id}/analyze` | Claude analyzes the ticket, proposes diagnostics |
| `POST /api/sessions/{id}/propose-fix` | Claude proposes a fix from gathered evidence |
| `POST /api/sessions/{id}/generate-activity` | Claude drafts the ERP activity |
| `POST /api/sessions/{id}/submit-activity` | Submit activity to ERP, mark ticket DONE |
| `POST /api/sessions/{id}/chat` | Free-form Q&A with the agent in session context |
| `WS /ws/sessions/{id}` | Live session updates, command results, audit events |

See `app/api/README.md` for request/response details.

---

## Design constraints (don't break these)

- **Human-in-the-loop is mandatory.** Claude proposes; the technician approves;
  only then does anything run. `safety.py` is a backstop, not the gate.
- **The safety classifier is deterministic.** The LLM never decides whether a
  command is safe. Edited commands are *re-classified* before execution.
- **Secrets are redacted** from all command output and audit data
  (`ssh/redactor.py`).
- **No persistent storage.** Sessions live in `app/state.py` dicts; a restart
  wipes them.
- **The ERP spec is read-only.** `docs/phoenix-openapi.yaml` describes the API —
  extend `erp/client.py` to match it; do not edit the spec.
