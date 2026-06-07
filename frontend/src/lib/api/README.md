# `src/lib/api` — backend client

The single integration point with the FastAPI backend: typed REST wrappers, the
WebSocket subscription, the backend wire types, and the converters that turn
backend payloads into the UI's own types.

| File | Role |
|---|---|
| `client.ts` | Everything: `Backend*` wire types, the `api` REST object, converters, and `connectSessionWs`. |
| `example.functions.ts` | Scaffold example of a TanStack `createServerFn` (not used by the app). |

`API_BASE` comes from `import.meta.env.VITE_API_BASE` (default `http://localhost:8000`).

---

## `client.ts`

### Wire types (`Backend*`)

TypeScript mirrors of the backend Pydantic models (`backend/app/models.py`):
`BackendEmployee`, `BackendTicket`, `BackendCustomerSystem`, `BackendProposedCommand`,
`BackendCommandResult`, `BackendAgentAnalysis`, `BackendFixPlan`,
`BackendActivityDraft`, `BackendAuditEvent`, `BackendTicketSession`, plus the
`RiskLevel` / `ApprovalStatus` / `SessionState` string unions. These use the
backend's snake_case wire format.

### `api` — REST wrappers

All requests go through `apiFetch<T>(path, init)`, which prefixes `${API_BASE}/api`,
sets JSON headers, and throws `Error(error.message)` on non-2xx (unwrapping the
backend's `{ error: { message } }` envelope).

| Group | Methods → endpoints |
|---|---|
| `api.me` | `get()` → `GET /me` |
| `api.tickets` | `list({status?, priority?, sort?})` → `GET /tickets` |
| `api.sessions` | `create(ticketId)`, `get(id)`, `approveConnection(id, approved)`, `approveCommand(id, cmdId, body)`, `abort(id)` |
| `api.agent` | `analyze(id)`, `proposeFix(id)`, `generateActivity(id)`, `submitActivity(id)`, `chat(id, message)` |

`approveCommand` returns either a `BackendCommandResult` (executed) or a
`{ status, command_id }` (rejected) — callers narrow on `"exit_code" in result`.

### Converters

Bridge backend payloads → UI types (`lib/workspace/types.ts`):

- **`riskToGuardrail(risk, blocked)`** — maps a backend `RiskLevel` to the UI
  `safe` / `caution` / `blocked` guardrail level (`read_only`/`low_change` → safe;
  `service_restart`/`package_change`/`needs_manual_review` → caution; blocked → blocked).
- **`proposedCommandToAction(cmd)`** — `BackendProposedCommand` → `AgentAction` card.
- **`analysisToItem(analysis, id?)`** — `BackendAgentAnalysis` → an `AgentAnalysisItem`
  feed entry (the optional `id` lets it replace an in-flight "analyzing…" placeholder).
- **`fixPlanToItems(plan)`** — renders a fix plan's root cause + evidence as a message item.
- **`auditEventToLogEntry(evt)`** — audit event → audit-trail `LogEntry`, with
  `_auditLevel()` choosing info/warn/danger/success from the event type.
- **`commandResultToLines(result)`** — formats stdout/stderr/exit code into terminal lines.

### `connectSessionWs(sessionId, handlers)`

Opens a WebSocket to `/ws/sessions/{id}` (deriving `ws`/`wss` from `API_BASE`) and
dispatches incoming frames by `type` to the matching handler:

| Frame `type` | Handler |
|---|---|
| `session_update` | `onSessionUpdate` |
| `audit_event` | `onAuditEvent` |
| `command_result` | `onCommandResult` |
| `pending_command` | `onPendingCommand` |
| `activity_draft` | `onActivityDraft` |

Malformed frames are ignored; errors are logged as warnings. `routes/index.tsx`
stores handlers in a ref so the socket callbacks always invoke the latest state.

> **Dedup note:** proposed commands arrive both in the HTTP `analyze`/`propose-fix`
> response *and* as a `pending_command` WebSocket broadcast. The workspace dedupes
> by command `id` so cards never appear twice.
