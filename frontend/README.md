# Frontend — AI Service Desk Autopilot

The technician's operator console: a single-screen workspace for **human-approved,
AI-assisted Linux incident resolution over SSH**, wired to the FastAPI backend and
the Phoenix ERP.

A technician signs in, picks a ticket, watches the agent diagnose the customer VM,
and **approves, edits, or rejects every command** before it runs. Nothing executes
without a human click — the UI mirrors the backend's human-in-the-loop guarantee.

---

## Stack

- **React 19** + **TypeScript**
- **TanStack Start** (SSR) + **TanStack Router** (file-based routing) + **TanStack Query**
- **Vite 7** (via `@lovable.dev/vite-tanstack-config`)
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives)
- **lucide-react** icons, **sonner** toasts
- Real-time updates over a native **WebSocket**

---

## Running it

### With Docker (recommended — runs frontend + backend together)

From the **repo root**:

```bash
cp .env.example .env       # fill in API keys + ERP URL
docker compose up --build  # frontend :5173, backend :8000
```

### Locally

```bash
cd frontend
npm install
npm run dev      # dev server on :5173 (Vite picks a free port if taken)
npm run build    # production build
npm run preview  # serve the production build
npm run lint     # ESLint
npm run format   # Prettier
```

### Environment

A single public variable points the app at the backend (`frontend/.env`):

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE` | Backend base URL (REST + WebSocket) | `http://localhost:8000` |

`VITE_`-prefixed vars are public and ship to the browser — never put secrets here.
The WebSocket URL is derived from this value (`http→ws`, `https→wss`) in
`lib/api/client.ts`.

---

## Project layout

```
frontend/
├── index.html              SPA/SSR HTML entry
├── vite.config.ts          Vite config (wraps @lovable.dev preset — read the notes there)
├── src/
│   ├── router.tsx          Builds the TanStack Router + Query client
│   ├── server.ts           SSR server entry (error wrapper)
│   ├── start.ts            TanStack Start instance + error middleware
│   ├── styles.css          Tailwind + design tokens
│   ├── routeTree.gen.ts    AUTO-GENERATED route tree — never edit by hand
│   ├── routes/             File-based routes              (see routes/README.md)
│   │   ├── __root.tsx      App shell: providers, 404 + error boundaries
│   │   ├── login.tsx       /login — one-button technician sign-in
│   │   └── index.tsx       / — the workspace (orchestrates everything)
│   ├── components/
│   │   ├── workspace/      Domain components                (see components/workspace/README.md)
│   │   └── ui/             shadcn/ui primitives — do NOT edit (see components/ui/README.md)
│   ├── lib/
│   │   ├── api/            Backend client + wire types + WS (see lib/api/README.md)
│   │   ├── workspace/      Shared types, guardrails, mock data (see lib/workspace/README.md)
│   │   ├── auth.tsx        Auth context (technician identity)
│   │   ├── utils.ts        `cn()` Tailwind class merge
│   │   ├── config.server.ts          Server-only config (never bundled to client)
│   │   ├── error-capture.ts          Out-of-band error capture for SSR
│   │   ├── error-page.ts             Static 500 HTML
│   │   └── lovable-error-reporting.ts  Error telemetry hook
│   └── hooks/              Reusable hooks (e.g. use-mobile)
└── Dockerfile              node:20-slim, runs `npm run dev`
```

---

## How it works

### Routing & auth

- `__root.tsx` wraps the app in `QueryClientProvider` + `AuthProvider`, and supplies
  the 404 and error boundary components.
- `/login` calls `auth.login()` → `GET /api/me` to load the technician profile,
  persisted in `localStorage`. `/` redirects here when unauthenticated.
- `/` (`routes/index.tsx`) is the workspace and holds almost all application state.

### The workspace (`routes/index.tsx`)

`index.tsx` is the orchestrator. It owns per-ticket state (agent feed items,
terminal output, SSH status, session ids, activity drafts) and drives the full
incident lifecycle by calling the backend `api` and reacting to WebSocket events.

A typical flow when a technician selects a ticket (`startRealSession`):

1. `POST /api/sessions` → backend loads the ticket + customer system from the ERP.
2. Open a **WebSocket** to `/ws/sessions/{id}` for live session updates, audit
   events, command results, pending commands, and the activity draft.
3. `POST …/approve-connection` → backend SSHes into the VM.
4. `POST …/analyze` → the agent returns an analysis + proposed read-only
   diagnostics, rendered as cards awaiting approval.
5. The technician **approves / edits / rejects** each command
   (`POST …/commands/{id}/approve`); results stream into the terminal.
6. `POST …/propose-fix` (enabled once commands have run) → fix plan + commands.
7. `POST …/generate-activity` → drafts the ERP activity, reviewed in a modal.
8. `POST …/submit-activity` → posts to the ERP and can mark the ticket DONE.

### Demo / fallback mode

The UI is resilient to a missing backend. If session creation or analysis fails,
`index.tsx` falls back to a **client-side simulation** driven by
`lib/workspace/mockData.ts` (scripted analysis, proposed commands, and simulated
terminal output). This makes the app fully demoable offline — useful for
development and presentations. Real-backend vs. demo mode is tracked per ticket.

### Guardrails in the UI

`lib/workspace/guardrails.ts` classifies each command as `safe` / `caution` /
`blocked` and is shown via `GuardrailBadge`. This is a **UX mirror** of the
backend's authoritative `app/ssh/safety.py` classifier — the backend remains the
real gate; approving a `blocked` command in the UI requires an explicit override.

---

## Conventions & gotchas

- **`routeTree.gen.ts` is auto-generated** by TanStack Router on dev/build —
  never edit it.
- **Don't edit `components/ui/`** — these are generated shadcn/ui primitives.
- **Don't hand-add Vite plugins** — `@lovable.dev/vite-tanstack-config` already
  bundles React, Tailwind, TanStack Start, the `@` path alias, env injection, etc.
  See the comment block in `vite.config.ts`.
- Wire types from the backend are prefixed `Backend*` and live in `lib/api/client.ts`;
  the UI-facing types live in `lib/workspace/types.ts`, with converters bridging them.
- Server-only code uses the `.server.ts` suffix so it never reaches the browser.
