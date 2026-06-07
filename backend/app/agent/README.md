# `app/agent` — Claude orchestration

This package is the only place that talks to **Claude**. It turns ticket context
and SSH evidence into *structured proposals* — analyses, fix plans, and activity
drafts — using Anthropic **tool-use** for reliable, schema-validated output.

The agent **only ever proposes**. It does not execute commands, and it does not
decide whether a command is safe — that is the job of `app/ssh/safety.py`, which
the agent calls on every command it emits.

| File | Role |
|---|---|
| `supervisor.py` | `SupervisorAgent` — orchestrates all Claude calls. |
| `prompts.py` | The system prompt + builders for each task prompt. |
| `schemas.py` | Anthropic tool-use JSON schemas that force structured output. |
| `diagnostics.py` | Curated catalogue of known-safe diagnostic commands (reference / prompt material). |

---

## `supervisor.py`

`SupervisorAgent(client, audit_logger)` exposes four async methods, each backed by
a forced tool call (except `chat`):

| Method | Prompt builder | Tool schema | Returns |
|---|---|---|---|
| `analyze_ticket(session)` | `build_analysis_prompt` | `ANALYSIS_TOOL` | `(AgentAnalysis, [ProposedCommand])` |
| `propose_fix(session)` | `build_fix_prompt` | `FIX_PLAN_TOOL` | `(FixPlan, [ProposedCommand])` |
| `generate_activity(session)` | `build_activity_prompt` | `ACTIVITY_TOOL` | `ActivityDraft` |
| `chat(session, message)` | `build_chat_prompt` | — (plain text) | `str` |

Key internals:

- **`_call_tool(schema, prompt)`** — calls `messages.create` with
  `tool_choice={"type": "tool", "name": ...}` to *force* a single structured
  tool call, then returns the tool's `input` dict. Raises if the model returns no
  `tool_use` block. This is how we get guaranteed-shaped JSON instead of free
  text.
- **`_to_proposed_commands(raw)`** — the safety bridge. For every command the LLM
  proposes it calls `classify_command()` and builds a `ProposedCommand` carrying
  the assigned `RiskLevel`, `requires_approval=True`, and `blocked` /
  `block_reason` when the classifier rejects it. **Safety is stamped here, before
  the command ever reaches the technician.**
- **`_format_command_results(session)`** — renders executed-command stdout/stderr
  (truncated) into the evidence block fed back to Claude on later steps.
- The model ID comes from `settings.anthropic_model`; the client is the shared
  `AsyncAnthropic` instance created in `main.py`'s lifespan.

Each method also writes progress to the audit log (`agent_analysis_started`,
`hypotheses_generated`, `fix_plan_generated`, `activity_generated`).

## `prompts.py`

- **`SYSTEM_PROMPT`** — encodes the agent's safety posture: technician is always
  in control, propose with reason + expected result, read-only diagnostics first,
  fix the root cause not the symptom, minimal targeted changes, no secret
  exposure, only base-Ubuntu tooling.
- **`build_analysis_prompt`** — injects ticket + system + audit + prior results,
  and seeds a baseline diagnostic playbook plus symptom→check heuristics. Asks for
  a summary, affected component, ranked hypotheses, and 5–8 read-only commands.
- **`build_fix_prompt`** — given diagnostic evidence, asks for a minimal fix with
  a technical root cause and mandatory validation commands; instructs the model to
  set `needs_more_diagnostics=true` instead of guessing when evidence is thin.
- **`build_chat_prompt`** — session-scoped Q&A; truncates long command output to
  stay within context.
- **`build_activity_prompt`** — asks for the structured ERP activity (summary,
  technical root cause, actions, commands summary with **no secrets/raw output**,
  validation proof); truncates long output.

## `schemas.py`

Three Anthropic tool definitions whose `input_schema` (JSON Schema) constrains the
model's output:

- **`ANALYSIS_TOOL`** (`output_analysis`) — `ticket_summary`, optional
  `affected_component`, `hypotheses[]` (title/description/confidence/evidence/
  next_check), `proposed_commands[]` (command/reason/expected_result).
- **`FIX_PLAN_TOOL`** (`output_fix_plan`) — `root_cause`, `evidence[]`,
  `needs_more_diagnostics`, and three command lists: additional diagnostics, fix,
  validation.
- **`ACTIVITY_TOOL`** (`output_activity`) — `summary`, `root_cause`,
  `actions_taken`, `commands_summary`, `validation_result`.

These mirror the corresponding Pydantic models in `app/models.py`.

## `diagnostics.py`

A curated library of known-safe, base-Ubuntu diagnostic commands grouped by
scenario (baseline, service, web, config checks, disk, permissions, database,
network/DNS, PostgreSQL privilege checks). Templates use `{service}`, `{path}`,
`{hostname}`, etc. placeholders. It exists to anchor the agent toward vetted
commands rather than inventing new ones.

---

## How a command becomes runnable

```
Claude tool output (raw command dicts)
        │
        ▼  _to_proposed_commands
classify_command()  ──►  RiskLevel + allowed/blocked        (app/ssh/safety.py)
        │
        ▼
ProposedCommand(requires_approval=True, blocked=?)
        │
        ▼  routes_agent queues non-blocked ones
pending_commands  ──►  technician approves  ──►  re-classified  ──►  SSHRunner.run
```

The agent never closes this loop on its own — approval and execution happen in
`app/api/routes_sessions.py`.
