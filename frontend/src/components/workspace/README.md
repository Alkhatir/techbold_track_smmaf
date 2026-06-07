# `src/components/workspace` — domain components

The custom UI for the technician workspace. These compose the shadcn/ui primitives
(`../ui`) into the incident-resolution console. Almost all state and the backend
wiring live in `routes/index.tsx`; these components are mostly presentational and
communicate up via callback props.

## Layout

The workspace (`routes/index.tsx`) renders a three-column shell:

```
┌──────────────────────── TopBar ─────────────────────────┐
│ TicketQueue │        IncidentPane         │ ActivityLog  │
│  (left)     │  (center: diagnosis feed,   │  (right:     │
│             │   terminal, ticket info)    │  audit trail)│
└──────────────────────────────────────────────────────────┘
                  ActivitySubmitModal (overlay)
```

## Components

| Component | Role |
|---|---|
| `TopBar` | Header with technician identity (name · username · team) and the **ABORT ALL** kill-switch (`onAbortAll`) + logout. |
| `TicketQueue` | Left column. Lists tickets with priority/status styling; supports sort (`date`/`priority`/`status`) and status/priority/date filters. Renders `loadState` (loading/empty/auth_error). Calls `onSelect(id)`. |
| `IncidentPane` | Center column with three tabs — **diagnosis** (the agent feed of `AnalysisCard` / message / `ActionCard` items), **terminal** (`Terminal`), and **info** (`TicketInfo`) — plus the chat input (`onSendChat`). Fans approval/edit/reject/retry/abort/breakpoint callbacks down to `ActionCard`. |
| `AnalysisCard` | The agent's initial background analysis (violet accent). Shows a skeleton while `pending`, then `ticket_summary`, affected component, and ranked hypotheses. |
| `ActionCard` | A proposed command awaiting approval. Approve / edit / reject / retry / abort, a `GuardrailBadge`, collapsible output, breakpoint toggle, and an explicit **override** confirmation for `blocked` commands. Re-checks the guardrail live while editing. |
| `Terminal` | Auto-scrolling streamed SSH output, colorizing prompts/ok/errors. |
| `TicketInfo` | Read-only ticket + customer-system details (priority, SLA, tags, IP/port/user/OS). |
| `GuardrailBadge` | Small safe/caution/blocked badge (icon + label + reason tooltip). |
| `ActivityLog` | Right column. The audit trail (`LogEntry` list) plus the **Propose Fix** and **Review & Submit** actions; shows a spinner while the activity draft is generating. |
| `ActivitySubmitModal` | Final review of the editable `ActivityDraft` (summary, root cause, actions, commands, validation) with a "mark ticket DONE" toggle before submitting to the ERP. |

## Conventions

- Components are **controlled from `routes/index.tsx`** via props — they don't call
  the backend `api` directly (the modal/queue/cards just emit intent upward).
- Types come from `@/lib/workspace/types`; backend types (e.g. `BackendEmployee`)
  come from `@/lib/api/client`.
- Guardrail levels shown here come from `@/lib/workspace/guardrails` and mirror the
  backend safety classifier — the backend remains the authoritative gate.
- Styling uses Tailwind v4 design tokens (`bg-card`, `text-danger`, `border-border`,
  …) and the `cn()` helper; the whole workspace renders in dark mode.
