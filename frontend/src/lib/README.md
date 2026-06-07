# `src/lib` — shared logic

Framework-agnostic helpers, types, and the backend client. Anything that isn't a
route or a React component lives here.

| Path | Role |
|---|---|
| `api/` | Backend REST + WebSocket client, wire types (`Backend*`), and converters. See `api/README.md`. |
| `workspace/` | Shared UI types, the guardrail classifier, and offline mock data. See `workspace/README.md`. |
| `auth.tsx` | `AuthProvider` / `useAuth` — technician identity context. |
| `utils.ts` | `cn()` — `clsx` + `tailwind-merge` class combiner used across components. |
| `config.server.ts` | Server-only config. The `.server.ts` suffix keeps it out of the client bundle. |
| `error-capture.ts` | Records the last uncaught error out-of-band so SSR can recover the real stack. |
| `error-page.ts` | Renders the static 500 HTML fallback page. |
| `lovable-error-reporting.ts` | `reportLovableError` — forwards errors to the Lovable telemetry hook on `window`. |

---

## `auth.tsx`

A small React context, not a real identity provider — sign-in is a single button.

- **`AuthProvider`** hydrates the technician from `localStorage`
  (`phoenix.technician`) on mount, exposing `loading` until storage is read so
  route guards don't redirect prematurely.
- **`login()`** calls `api.me.get()` (`GET /api/me`) to fetch the technician
  profile from the ERP, persists it, and sets it in state.
- **`logout()`** clears storage and state.
- **`useAuth()`** returns `{ technician, isAuthenticated, loading, login, logout }`
  and throws if used outside the provider.

`isAuthenticated` is simply "a technician object is loaded". Route protection lives
in `routes/index.tsx` (redirect to `/login`) and `routes/login.tsx` (redirect to
`/` once signed in).

## Server-only files (`.server.ts`)

`config.server.ts` reads `process.env` **inside a function** (`getServerConfig()`),
because on Cloudflare Workers env binds per-request, not at module load. Public
config that the browser may read should instead be a `VITE_`-prefixed var accessed
via `import.meta.env`. The error helpers (`error-capture`, `error-page`) support the
SSR error middleware wired up in `src/server.ts` / `src/start.ts`.

> See `api/example.functions.ts` for the `createServerFn` pattern (a server-side
> handler callable from the client) — it's a scaffold example, not used by the app.
