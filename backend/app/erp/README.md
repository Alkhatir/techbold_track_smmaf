# `app/erp` — Phoenix ERP client

A thin async HTTP client over the **Phoenix ERP** REST API. It is the backend's
only integration point for tickets, the logged-in technician, customer system
info, and activity submission.

| File | Role |
|---|---|
| `client.py` | `ERPClient` (httpx) + `ERPError`. |

The ERP contract is defined by `docs/phoenix-openapi.yaml` — that spec is
**read-only**. Extend this client to match it; never edit the spec.

---

## `ERPClient`

Constructed per request via `dependencies.get_erp_client()` using
`settings.erp_base_url` and `settings.erp_bearer_token`. The bearer token is held
privately in the `Authorization` header and is **never logged**. Each call opens a
short-lived `httpx.AsyncClient` (30s timeout) via `_make_client()`.

### Methods → endpoints

| Method | ERP endpoint | Returns |
|---|---|---|
| `get_me()` | `GET /api/v1/me` | `Employee` |
| `list_my_open_tickets(status, priority, sort)` | `GET /api/v1/me/tickets` | `list[Ticket]` |
| `get_ticket(id)` | `GET /api/v1/tickets/{id}` | `Ticket` |
| `get_customer_system(id)` | `GET /api/v1/tickets/{id}/customer-system` | `CustomerSystem` |
| `set_ticket_status(id, status)` | `PATCH /api/v1/tickets/{id}/status` | `Ticket` |
| `create_activity(activity)` | `POST /api/v1/activities/create` | `Activity` |
| `reset()` | `POST /api/v1/me/reset` | `dict` |

Responses are parsed straight into the Pydantic models from `app/models.py`.

## Error handling

`_handle(response, resource)` maps HTTP status codes to a typed `ERPError` with a
stable `code`:

| Status | `ERPError.code` |
|---|---|
| 401 | `ERP_UNAUTHORIZED` |
| 403 | `ERP_FORBIDDEN` |
| 404 | `ERP_NOT_FOUND` |
| ≥ 500 | `ERP_SERVER_ERROR` |
| network/transport failure | `ERP_UNAVAILABLE` |

Each method re-raises `ERPError` as-is and wraps any other exception (DNS,
connection refused, timeout, JSON decode, …) as `ERP_UNAVAILABLE`. The route layer
(`api/routes_tickets.py`, `api/routes_agent.py`) turns these codes into HTTP
responses with the uniform `{"error": {...}}` envelope.

`create_activity` serialises the payload with `exclude_none=True` so optional
activity fields are omitted rather than sent as `null`.
