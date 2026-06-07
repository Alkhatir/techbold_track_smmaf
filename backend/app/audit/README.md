# `app/audit` — audit trail

An append-only, in-memory record of **everything that happens in a session** —
who did it (`system`, `technician`, or `agent`), when, and what. It is the
provenance layer behind the human-in-the-loop guarantee and the source data for
the activity draft Claude generates.

| File | Role |
|---|---|
| `log.py` | `AuditLogger` + the module-level `audit_logger` singleton. |

---

## `AuditLogger`

A single process-wide instance (`audit_logger`) is imported throughout the app
(routes and the agent). Events are stored in `_store: dict[session_id ->
list[AuditEvent]]`.

- **`add_event(ticket_id, session_id, actor, event_type, message, data=None)`** —
  appends an `AuditEvent` (defined in `app/models.py`, with auto id + UTC
  timestamp). Any structured `data` is passed through
  `redactor.redact_dict` first, so **secrets never enter the audit log**.
- **`list_events(session_id)`** — all events for a session (returned to the UI via
  `GET /api/sessions/{id}/logs` and broadcast over WebSocket as `audit_event`).
- **`summary(session_id)`** — a compact `[HH:MM:SS] event_type: message` text
  rendering, fed back to Claude as session context in the analysis, fix, chat, and
  activity prompts.

## Event vocabulary

Representative `event_type` values emitted across the app:

`ticket_loaded`, `customer_system_loaded`, `connection_proposed`,
`connection_approved` / `connection_rejected`, `ssh_connected`,
`agent_analysis_started`, `hypotheses_generated`, `command_proposed`,
`command_blocked`, `command_edited`, `command_rejected`, `command_started`,
`command_finished` / `command_failed`, `fix_plan_generated`,
`chat_message` / `chat_reply`, `activity_generated`, `activity_submitted`,
`session_aborted`, `error`.

> Like sessions, the audit trail is **in-memory only** — restarting the backend
> clears it. There is no persistence layer.
