# `src/lib/workspace` — domain types, guardrails, mock data

The UI-facing domain model: the TypeScript types the components render, the
client-side guardrail classifier, and the offline demo data.

| File | Role |
|---|---|
| `types.ts` | All UI types: tickets, the agent feed, guardrails, log entries, activity drafts. |
| `guardrails.ts` | `checkGuardrail()` command classifier + `maskSecrets()` for mock output. |
| `mockData.ts` | Scripted tickets, analyses, commands, and simulated output for demo/fallback mode. |

---

## `types.ts`

The vocabulary shared across the workspace. Highlights:

- **`Ticket`** / **`SystemInfo`** — mirror the Phoenix ERP schema (snake_case wire
  fields). `system` is colocated on the ticket for UI convenience but is loaded
  separately from the customer-system endpoint.
- **`AgentItem`** — the discriminated union rendered in the diagnosis feed:
  - `AgentMessage` (`kind: "message"`) — agent prose.
  - `TechnicianMessage` (`kind: "technician_message"`) — operator chat.
  - `AgentAnalysisItem` (`kind: "analysis"`) — the initial background analysis;
    `pending` while the agent works, then filled with `ticket_summary`,
    `affected_component`, and ranked `hypotheses`.
  - `AgentAction` (`kind: "action"`) — a proposed command card carrying the
    current/original command, `edited` flag, `guardrail`, `status`, streamed
    `output`, and an optional `breakpoint`.
- **`ActionStatus`** — the command lifecycle: `proposed → approved → running →
  succeeded`/`failed`, plus `rejected`, `aborted`, and the verification states
  `verified_ok` / `verified_regressed`.
- **`Guardrail` / `GuardrailLevel`** — `safe` | `caution` | `blocked` (+ optional reason).
- **`LogEntry`** — an audit-trail row (`info`/`warn`/`danger`/`success`).
- **`ActivityDraft`** — mirrors the ERP `activities/create` body.
- **`QueueLoadState`** — `ok` | `loading` | `empty` | `auth_error` for the ticket queue.

## `guardrails.ts`

- **`checkGuardrail(command)`** — regex classifier returning `{ level, reason? }`.
  - `BLOCK_PATTERNS` — broad/destructive operations (recursive `rm` from root,
    `dd` to `/dev`, `mkfs`, blanket `chmod 777`, disabling firewall/SELinux,
    reading/exfiltrating secrets, deleting logs/history, running app as root, …).
    Targeted single-file ops are intentionally allowed.
  - `CAUTION_PATTERNS` — service restarts, `chown`/`chmod`, `kill -9`, package ops.
  - Anything else → `safe`.
- **`maskSecrets(line)`** — redacts bearer tokens, `password`/`token`/`api_key`
  assignments, and PEM private-key blocks from mock terminal output so the UI never
  renders real-looking secrets.

> This is the **UI mirror** of the backend's authoritative classifier
> (`backend/app/ssh/safety.py`). It drives badges and the override prompt, but the
> backend remains the real safety gate — the two lists are deliberately similar in
> spirit but maintained independently.

## `mockData.ts`

Powers **demo / fallback mode** when the backend is unavailable. Provides a set of
realistic tickets (five hidden incidents per the brief — stopped service, full
disk, broken config, failed cron, port conflict — plus a resolved one) and builder
functions (`buildAnalysis`, `buildAgentScript`, `buildFollowupSafer`,
`simulatedOutput`, `verifyText`) that the workspace replays on a timer to simulate
a live agent session entirely client-side.
