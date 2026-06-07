# `app/api` — HTTP & WebSocket routes

This package is the edge of the backend: it translates HTTP/WebSocket requests
into ERP calls, SSH execution, and agent invocations, and enforces the
**approval gates** that keep a human in the loop.

All routers are registered in `app/main.py`. The three HTTP routers mount under
`/api`; the WebSocket router mounts at the root.

| File | Routes | Role |
|---|---|---|
| `routes_tickets.py` | `GET /api/me`, `/api/tickets`, `/api/tickets/{id}`, `/api/tickets/{id}/system` | Read-through to the Phoenix ERP. |
| `routes_sessions.py` | session CRUD, connection approval, command approval, abort | Owns the session lifecycle and the approval/execution gates. |
| `routes_agent.py` | `analyze`, `propose-fix`, `generate-activity`, `submit-activity`, `chat` | Invokes the Claude supervisor and persists its output onto the session. |
| `websocket.py` | `WS /ws/sessions/{id}` | Pushes live updates to the browser. |

---

## `routes_tickets.py`

Thin wrappers over `ERPClient` (built fresh per request via
`get_erp_client()`). The only real logic is error mapping: `ERPError` codes are
translated to HTTP status codes by `_status_for_code` (e.g. `ERP_UNAUTHORIZED`
→ 401, `ERP_NOT_FOUND` → 404, `ERP_UNAVAILABLE` → 503, everything else → 502) and
returned as a uniform `{"error": {...}}` body.

`GET /api/tickets` forwards optional `status`, `priority`, and `sort` query
params to the ERP.

## `routes_sessions.py`

The heart of the human-in-the-loop flow.

- **`POST /sessions`** — fetches the ticket and customer system from the ERP,
  creates a `TicketSession`, logs the load events, and moves it to
  `CONNECTION_PENDING`. **No SSH happens yet.**
- **`POST /sessions/{id}/approve-connection`** — on reject, the session is
  aborted. On approve, it resolves the SSH key (`_resolve_key_path`), builds an
  `SSHRunner`, and **connects**. The live runner is stored in
  `state.ssh_runners`; the session moves to `CONNECTED`. Connection failures move
  the session to `ERROR` and return `SSH_CONNECTION_FAILED`.
- **`POST /sessions/{id}/commands/{cmd_id}/approve`** — the critical gate:
  1. Rejects unknown / already-blocked commands.
  2. If the technician *edited* the command, the edited form is re-run through
     `classify_command`; a blocked result aborts execution.
  3. A **final safety re-check** runs immediately before execution (defence in
     depth — even an un-edited command is re-classified).
  4. Executes via the session's `SSHRunner`, appends a `CommandResult`, removes
     the command from `pending_commands`, logs `command_finished`/`command_failed`,
     and broadcasts the result over WebSocket.
- **`POST /sessions/{id}/abort`** — closes the SSH runner and marks the session
  `ABORTED`.

`_resolve_key_path(customer_id, system_key_path)` chooses the SSH key in priority
order: ERP-provided path → `keys/<customer_id>_key.pem` → `keys/case<N>_key.pem`
(where `N = customer_id - 5000`, a hackathon convention) → the global default.

## `routes_agent.py`

Each endpoint constructs a `SupervisorAgent` (Claude client + audit logger) and
calls one method, then writes the structured result back onto the session and
advances its state.

- **`analyze`** — requires an approved connection. Claude returns an
  `AgentAnalysis` (hypotheses + proposed diagnostics). Proposed commands are
  already safety-classified inside the agent; **blocked ones are logged but never
  queued**, safe ones go into `pending_commands` and are broadcast.
- **`propose-fix`** — requires existing diagnostic results
  (`executed_commands`). Produces a `FixPlan` with fix + validation (+ optional
  extra diagnostic) commands, queueing the non-blocked ones for approval.
- **`generate-activity`** — Claude drafts the structured ERP activity; session
  moves to `ACTIVITY_READY`.
- **`submit-activity`** — posts the draft to the ERP via `create_activity`, then
  best-effort sets the ticket to `DONE` (a status-update failure does not fail the
  submission), and moves the session to `SUBMITTED`.
- **`chat`** — free-form question/instruction answered in session context (no tool
  use, plain text reply).

Errors during agent calls set the session to `ERROR`, log the failure, and return
`AGENT_ERROR` (HTTP 500).

## `websocket.py`

A minimal pub/sub: `_connections` maps `session_id → [WebSocket]`. `broadcast()`
fan-outs a JSON message to every socket for a session and prunes dead ones. The
endpoint keeps the socket open by awaiting client messages (used as keep-alive
pings) and cleans up on disconnect.

Message `type`s emitted elsewhere in the app: `session_update`, `audit_event`,
`pending_command`, `command_result`, `activity_draft`.

---

## Conventions

- Errors use a consistent envelope: `{"error": {"code", "message", "details"}}`,
  built by the local `_err(...)` / `_not_found(...)` helpers.
- Session state transitions and every actor action are written to the audit log
  (`audit_logger.add_event`) and, where the UI needs it, broadcast over WebSocket.
- Routes mutate the in-memory `sessions` dict directly (re-assigning
  `sessions[id] = session` after changes) — there is no ORM or DB layer.
