"""Session lifecycle routes: create, fetch, approve connection, approve/reject commands, abort."""

from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..audit.log import audit_logger
from ..config import settings
from ..dependencies import get_erp_client
from ..erp.client import ERPError
from ..models import (
    ApprovalStatus,
    ApproveCommandRequest,
    ApproveConnectionRequest,
    CreateSessionRequest,
    ProposedCommand,
    SessionState,
    TicketSession,
)
from ..ssh.runner import SSHConnectionError, SSHRunner
from ..ssh.safety import classify_command
from ..state import sessions, ssh_runners
from .websocket import broadcast

router = APIRouter(tags=["sessions"])


def _not_found(session_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error": {"code": "SESSION_NOT_FOUND", "message": f"Session {session_id} not found.", "details": ""}},
    )


def _err(code: str, message: str, status: int = 400, details: str = "") -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details}},
    )


async def _broadcast_session(session: TicketSession) -> None:
    await broadcast(session.id, {"type": "session_update", "data": session.model_dump(mode="json")})


async def _broadcast_audit(session: TicketSession) -> None:
    events = audit_logger.list_events(session.id)
    if events:
        last = events[-1]
        await broadcast(session.id, {"type": "audit_event", "data": last.model_dump(mode="json")})


# ---------------------------------------------------------------------------
# POST /api/sessions — create a new session
# ---------------------------------------------------------------------------

@router.post("/sessions", status_code=201)
async def create_session(body: CreateSessionRequest):
    erp = get_erp_client()
    try:
        ticket = await erp.get_ticket(body.ticket_id)
    except ERPError as e:
        return JSONResponse(
            status_code=404 if e.code == "ERP_NOT_FOUND" else 502,
            content={"error": {"code": e.code, "message": e.message, "details": e.details}},
        )

    try:
        customer_system = await erp.get_customer_system(body.ticket_id)
    except ERPError as e:
        return JSONResponse(
            status_code=404 if e.code == "ERP_NOT_FOUND" else 502,
            content={"error": {"code": e.code, "message": e.message, "details": e.details}},
        )

    session = TicketSession(
        ticket_id=body.ticket_id,
        ticket=ticket,
        customer_system=customer_system,
        state=SessionState.SYSTEM_LOADED,
    )
    sessions[session.id] = session

    audit_logger.add_event(str(session.ticket_id), session.id, "system", "ticket_loaded", f"Loaded ticket #{ticket.id}: {ticket.title}")
    audit_logger.add_event(str(session.ticket_id), session.id, "system", "customer_system_loaded", f"Customer system loaded: {customer_system.system.ip}:{customer_system.system.port}")
    audit_logger.add_event(str(session.ticket_id), session.id, "system", "connection_proposed", "Awaiting technician approval to connect via SSH")

    session.state = SessionState.CONNECTION_PENDING
    sessions[session.id] = session

    return session


# ---------------------------------------------------------------------------
# GET /api/sessions/{session_id}
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)
    return session


# ---------------------------------------------------------------------------
# GET /api/sessions
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions():
    return list(sessions.values())


# ---------------------------------------------------------------------------
# GET /api/sessions/{session_id}/logs
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/logs")
async def get_session_logs(session_id: str):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)
    return audit_logger.list_events(session_id)


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/approve-connection
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/approve-connection")
async def approve_connection(session_id: str, body: ApproveConnectionRequest):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    if session.state not in (SessionState.CONNECTION_PENDING, SessionState.SYSTEM_LOADED):
        return _err("INVALID_STATE", f"Connection cannot be approved in state {session.state}")

    if not body.approved:
        session.state = SessionState.ABORTED
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "technician", "connection_rejected", "Technician rejected SSH connection")
        await _broadcast_session(session)
        return {"status": "rejected"}

    # Approved — attempt SSH connection
    audit_logger.add_event(str(session.ticket_id), session_id, "technician", "connection_approved", "Technician approved SSH connection")

    system = session.customer_system.system  # type: ignore[union-attr]
    key_path = settings.ssh_private_key_path

    runner = SSHRunner(
        host=system.ip,
        port=system.port,
        username=system.username,
        private_key_path=key_path,
        timeout_seconds=settings.command_timeout_seconds,
        max_output_chars=settings.max_command_output_chars,
    )

    try:
        runner.connect()
    except SSHConnectionError as e:
        session.state = SessionState.ERROR
        session.error_message = str(e)
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "error", f"SSH connection failed: {e}")
        await _broadcast_session(session)
        return _err("SSH_CONNECTION_FAILED", "Could not connect to the customer VM over SSH.", 502, str(e))

    ssh_runners[session_id] = runner
    session.state = SessionState.CONNECTED
    session.connection_approved = True
    session.started_at = datetime.utcnow()
    sessions[session_id] = session

    audit_logger.add_event(str(session.ticket_id), session_id, "system", "ssh_connected", f"SSH connected to {system.ip}:{system.port} as {system.username}")
    await _broadcast_session(session)
    await _broadcast_audit(session)

    return {"status": "connected", "session": session}


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/commands/{command_id}/approve
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/commands/{command_id}/approve")
async def approve_command(session_id: str, command_id: str, body: ApproveCommandRequest):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    # Find the pending command
    cmd = next((c for c in session.pending_commands if c.id == command_id), None)
    if not cmd:
        return _err("COMMAND_NOT_FOUND", f"Command {command_id} not found in pending commands", 404)

    if cmd.blocked:
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "command_blocked", f"Blocked command cannot be run: {cmd.command}", {"command_id": command_id, "reason": cmd.block_reason})
        return _err("COMMAND_BLOCKED", f"Command was blocked by safety layer: {cmd.block_reason}")

    if not body.approved:
        cmd.approval_status = ApprovalStatus.REJECTED
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "technician", "command_rejected", f"Technician rejected: {cmd.command}", {"command_id": command_id, "note": body.technician_note})
        await _broadcast_audit(session)
        return {"status": "rejected", "command_id": command_id}

    # Handle edited command — re-run safety check
    final_command = cmd.command
    if body.edited_command and body.edited_command.strip() != cmd.command:
        final_command = body.edited_command.strip()
        safety = classify_command(final_command)
        if not safety.allowed:
            audit_logger.add_event(str(session.ticket_id), session_id, "system", "command_blocked", f"Edited command blocked: {final_command}", {"reason": safety.reason})
            return _err("COMMAND_BLOCKED", f"Edited command blocked by safety layer: {safety.reason}")
        original = cmd.command
        cmd.command = final_command
        cmd.risk = safety.risk
        cmd.approval_status = ApprovalStatus.APPROVED
        audit_logger.add_event(str(session.ticket_id), session_id, "technician", "command_edited", f"Command edited to: {final_command}", {"original": original, "edited": final_command})
    else:
        cmd.approval_status = ApprovalStatus.APPROVED

    if body.technician_note:
        cmd.technician_note = body.technician_note

    # Re-verify safety gate before execution
    safety = classify_command(final_command)
    if not safety.allowed:
        cmd.blocked = True
        cmd.block_reason = safety.reason
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "command_blocked", f"Safety re-check blocked: {final_command}", {"reason": safety.reason})
        return _err("COMMAND_BLOCKED", f"Command blocked by safety layer: {safety.reason}")

    # Execute
    runner = ssh_runners.get(session_id)
    if not runner or not runner.is_connected:
        return _err("SSH_NOT_CONNECTED", "SSH is not connected.", 400)

    audit_logger.add_event(str(session.ticket_id), session_id, "system", "command_started", f"Running: {final_command}", {"command_id": command_id})

    result = runner.run(command_id=command_id, command=final_command, risk=cmd.risk)
    session.executed_commands.append(result)

    # Remove from pending
    session.pending_commands = [c for c in session.pending_commands if c.id != command_id]
    sessions[session_id] = session

    event_type = "command_finished" if result.exit_code == 0 else "command_failed"
    audit_logger.add_event(
        str(session.ticket_id),
        session_id,
        "system",
        event_type,
        f"Command finished (exit={result.exit_code}): {final_command}",
        {
            "command_id": command_id,
            "command": final_command,
            "exit_code": result.exit_code,
            "duration": result.duration_seconds,
            "timed_out": result.timed_out,
            "stdout_preview": result.stdout[:300],
        },
    )

    await broadcast(session_id, {"type": "command_result", "data": result.model_dump(mode="json")})
    await _broadcast_audit(session)

    return result


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/abort
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/abort")
async def abort_session(session_id: str):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    runner = ssh_runners.pop(session_id, None)
    if runner:
        runner.close()

    session.state = SessionState.ABORTED
    sessions[session_id] = session

    audit_logger.add_event(str(session.ticket_id), session_id, "technician", "session_aborted", "Session aborted by technician")
    await _broadcast_session(session)
    await _broadcast_audit(session)

    return {"status": "aborted"}
