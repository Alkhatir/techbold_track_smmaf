from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from ..dependencies import get_erp_client
from ..erp.client import ERPError

router = APIRouter(tags=["tickets"])


def _erp_error_response(e: ERPError) -> JSONResponse:
    return JSONResponse(
        status_code=_status_for_code(e.code),
        content={"error": {"code": e.code, "message": e.message, "details": e.details}},
    )


def _status_for_code(code: str) -> int:
    return {
        "ERP_UNAUTHORIZED": 401,
        "ERP_FORBIDDEN": 403,
        "ERP_NOT_FOUND": 404,
        "ERP_UNAVAILABLE": 503,
    }.get(code, 502)


@router.get("/tickets")
async def list_tickets(
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    sort: str = Query(default="date"),
):
    erp = get_erp_client()
    try:
        tickets = await erp.list_my_open_tickets(status=status, priority=priority, sort=sort)
        return tickets
    except ERPError as e:
        return _erp_error_response(e)


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: int):
    erp = get_erp_client()
    try:
        return await erp.get_ticket(ticket_id)
    except ERPError as e:
        return _erp_error_response(e)


@router.get("/tickets/{ticket_id}/system")
async def get_customer_system(ticket_id: int):
    erp = get_erp_client()
    try:
        return await erp.get_customer_system(ticket_id)
    except ERPError as e:
        return _erp_error_response(e)
