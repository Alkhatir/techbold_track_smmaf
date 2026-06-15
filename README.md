# AI Service Desk Autopilot

AI Service Desk Autopilot is a full-stack technician workspace for resolving
Linux incidents from the Phoenix ERP. It lets a technician load assigned tickets,
connect to the affected customer VM over SSH, use Claude to diagnose and propose
fixes, approve every command before execution, validate the result, and submit a
structured activity report back to the ERP.

The project was built for the techbold START Hack service-desk track, but this
repository now contains an implemented operator console and backend, not just the
starter template.

## Core Workflow

```
Phoenix ERP ticket
  -> FastAPI backend loads ticket + customer system
  -> technician approves SSH connection
  -> Claude proposes diagnostics and fixes
  -> technician approves, edits, or rejects each command
  -> backend runs approved commands over SSH with safety checks
  -> validation output is collected
  -> activity report is drafted and submitted to Phoenix ERP
```

Human approval is mandatory. The agent proposes actions; the backend safety layer
classifies commands; only explicitly approved commands can reach a customer VM.

## Repository Layout

```
backend/             FastAPI API, ERP client, SSH runner, agent orchestration, audit log
frontend/            React/TanStack technician workspace
docs/                Phoenix OpenAPI spec and original scoring rubric
docker-compose.yml   Local full-stack runtime
keys/                SSH keys for customer VMs (git-ignored)
README.md            Project entry point
```

Deeper module documentation lives in:

- `backend/README.md`
- `frontend/README.md`
- `backend/app/*/README.md`
- `frontend/src/*/README.md`

## Stack

Backend:

- Python 3.11
- FastAPI + Uvicorn
- Pydantic settings/models
- httpx for Phoenix ERP calls
- Paramiko for SSH
- Anthropic SDK for Claude
- pytest + pytest-asyncio

Frontend:

- React 19 + TypeScript
- TanStack Start, Router, and Query
- Vite 7
- Tailwind CSS v4
- shadcn/ui primitives
- Native WebSocket session updates

## Configuration

Never commit `.env` files or SSH keys. The repository ignores `.env`, `keys/*`,
`*.pem`, and `*.key`.

For Docker, create a root `.env` file:

```bash
cp backend/.env.example .env
```

Then fill in the real values. When running with Docker, keys are mounted at
`/keys`, so use container paths such as `/keys/case1_key.pem`.

| Variable | Purpose | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key used by the backend agent | `sk-ant-...` |
| `ANTHROPIC_MODEL` | Claude model ID | `claude-sonnet-4-20250514` |
| `ERP_BASE_URL` | Phoenix ERP base URL | `https://...` |
| `ERP_BEARER_TOKEN` | Phoenix ERP bearer token | `...` |
| `SSH_KEYS_DIR` | Directory for per-customer SSH keys | `/keys` in Docker, `./keys` locally |
| `SSH_PRIVATE_KEY_PATH` | Fallback SSH key path | `/keys/id_rsa.pem` |
| `SSH_DEFAULT_USER` | Default SSH login user | `azureuser` |
| `COMMAND_TIMEOUT_SECONDS` | Per-command SSH timeout | `30` |
| `MAX_COMMAND_OUTPUT_CHARS` | Command output truncation limit | `12000` |
| `VITE_API_BASE` | Browser-facing backend URL | `http://localhost:8000` |

The backend also supports per-customer key discovery from `SSH_KEYS_DIR`, such as
`<customer_id>_key.pem` or `case<N>_key.pem`.

## Run With Docker

From the repository root:

```bash
cp backend/.env.example .env
mkdir -p keys
# copy your SSH .pem files into ./keys, then edit .env
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Backend Swagger UI: `http://localhost:8000/docs`

## Run Locally

Backend:

```bash
cd backend
cp .env.example .env
uv sync --dev
PYTHONPATH=. uv run uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

By default, the frontend expects the backend at `http://localhost:8000`. Override
that with `VITE_API_BASE` in `frontend/.env` when needed.

## Tests And Quality Checks

Backend tests:

```bash
cd backend
PYTHONPATH=. uv run pytest
```

Frontend checks:

```bash
cd frontend
npm run lint
npm run build
```

## Main Backend API

All application routes are mounted under `/api`; live session updates use
WebSockets.

| Method and path | Purpose |
|---|---|
| `GET /health` | Backend liveness |
| `GET /api/me` | Current technician from Phoenix ERP |
| `GET /api/tickets` | Assigned ticket list |
| `GET /api/tickets/{id}` | Ticket detail |
| `GET /api/tickets/{id}/system` | Customer system and SSH target |
| `POST /api/sessions` | Create an incident session |
| `POST /api/sessions/{id}/approve-connection` | Approve or reject SSH connection |
| `POST /api/sessions/{id}/analyze` | Ask the agent for diagnostics |
| `POST /api/sessions/{id}/commands/{cmd_id}/approve` | Approve, edit, or reject a command |
| `POST /api/sessions/{id}/propose-fix` | Ask the agent for a fix plan |
| `POST /api/sessions/{id}/generate-activity` | Draft the ERP activity report |
| `POST /api/sessions/{id}/submit-activity` | Submit activity and mark the ticket done |
| `WS /ws/sessions/{id}` | Live audit events, command output, state changes |

See `backend/app/api/README.md` for detailed route behavior.

## Safety Model

- Claude cannot execute commands directly.
- Every proposed or edited command is checked by the backend safety classifier.
- The technician must approve each command before it runs.
- Command output and audit data are redacted before being exposed to the UI.
- Sessions and audit trails are in memory; restarting the backend clears them.
- SSH commands have timeouts and output limits.

## Demo Behavior

The frontend can fall back to a client-side simulation if the backend is missing
or a session cannot be created. This keeps the workspace demoable, but real ERP,
SSH, agent, and activity submission behavior requires the FastAPI backend and
valid environment variables.

## Phoenix ERP Contract

The Phoenix API contract is documented in `docs/phoenix-openapi.yaml`. The
backend consumes this API for technician identity, assigned tickets, customer
system data, ticket status updates, and activity creation.

## License

MIT. See `LICENSE`.
