"""Agent control routes: analyze, propose-fix, generate-activity, submit-activity."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..agent.supervisor import SupervisorAgent
from ..audit.log import audit_logger
from ..dependencies import get_anthropic_client, get_erp_client
from ..erp.client import ERPError
from ..models import ActivityCreate, ApprovalStatus, SessionState, TicketStatus
from ..state import sessions, ssh_runners
from .websocket import broadcast

router = APIRouter(tags=["agent"])


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


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/analyze
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/analyze")
async def analyze(session_id: str, request: Request):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    if not session.connection_approved:
        return _err("SSH_NOT_CONNECTED", "SSH connection must be approved before analysis.")

    client = get_anthropic_client(request)
    agent = SupervisorAgent(client=client, audit_logger=audit_logger)

    try:
        analysis, proposed = await agent.analyze_ticket(session)
    except Exception as e:
        session.state = SessionState.ERROR
        session.error_message = str(e)
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "error", f"Analysis failed: {e}")
        return _err("AGENT_ERROR", "Agent analysis failed.", 500, str(e))

    session.analysis = analysis
    session.state = SessionState.DIAGNOSING

    # Log all proposed commands (blocked ones too)
    for cmd in proposed:
        if cmd.blocked:
            audit_logger.add_event(
                str(session.ticket_id), session_id, "agent", "command_blocked",
                f"Agent proposed a blocked command: {cmd.command}",
                {"command_id": cmd.id, "reason": cmd.block_reason},
            )
        else:
            audit_logger.add_event(
                str(session.ticket_id), session_id, "agent", "command_proposed",
                f"Proposed: {cmd.command}",
                {"command_id": cmd.id, "risk": cmd.risk, "reason": cmd.reason},
            )
            session.pending_commands.append(cmd)

    sessions[session_id] = session

    # Broadcast pending commands to frontend
    for cmd in session.pending_commands:
        await broadcast(session_id, {"type": "pending_command", "data": cmd.model_dump(mode="json")})

    return {
        "analysis": analysis,
        "pending_commands": [c for c in session.pending_commands if c.approval_status == ApprovalStatus.PENDING],
    }


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/propose-fix
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/propose-fix")
async def propose_fix(session_id: str, request: Request):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    if not session.connection_approved:
        return _err("SSH_NOT_CONNECTED", "SSH must be connected before proposing a fix.")

    if not session.executed_commands:
        return _err("NO_EVIDENCE", "No diagnostic results yet. Run diagnostics first.")

    client = get_anthropic_client(request)
    agent = SupervisorAgent(client=client, audit_logger=audit_logger)

    try:
        fix_plan, proposed = await agent.propose_fix(session)
    except Exception as e:
        session.state = SessionState.ERROR
        session.error_message = str(e)
        sessions[session_id] = session
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "error", f"Fix proposal failed: {e}")
        return _err("AGENT_ERROR", "Agent fix proposal failed.", 500, str(e))

    session.fix_plan = fix_plan
    session.state = SessionState.FIX_PENDING
    sessions[session_id] = session

    from ..models import ApprovalStatus
    for cmd in proposed:
        if cmd.blocked:
            audit_logger.add_event(
                str(session.ticket_id), session_id, "agent", "command_blocked",
                f"Fix command blocked: {cmd.command}",
                {"command_id": cmd.id, "reason": cmd.block_reason},
            )
        else:
            audit_logger.add_event(
                str(session.ticket_id), session_id, "agent", "command_proposed",
                f"Fix command proposed: {cmd.command}",
                {"command_id": cmd.id, "risk": cmd.risk},
            )
            session.pending_commands.append(cmd)

    sessions[session_id] = session

    for cmd in proposed:
        if not cmd.blocked:
            await broadcast(session_id, {"type": "pending_command", "data": cmd.model_dump(mode="json")})

    return {
        "fix_plan": fix_plan,
        "pending_commands": [c.model_dump() for c in proposed if not c.blocked],
    }


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/generate-activity
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/generate-activity")
async def generate_activity(session_id: str, request: Request):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    client = get_anthropic_client(request)
    agent = SupervisorAgent(client=client, audit_logger=audit_logger)

    try:
        draft = await agent.generate_activity(session)
    except Exception as e:
        audit_logger.add_event(str(session.ticket_id), session_id, "system", "error", f"Activity generation failed: {e}")
        return _err("AGENT_ERROR", "Activity generation failed.", 500, str(e))

    session.activity_draft = draft
    session.state = SessionState.ACTIVITY_READY
    sessions[session_id] = session

    await broadcast(session_id, {"type": "activity_draft", "data": draft.model_dump(mode="json")})

    return draft


# ---------------------------------------------------------------------------
# POST /api/sessions/{session_id}/submit-activity
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/submit-activity")
async def submit_activity(session_id: str):
    session = sessions.get(session_id)
    if not session:
        return _not_found(session_id)

    if not session.activity_draft:
        return _err("NO_ACTIVITY_DRAFT", "Generate an activity draft first.")

    draft = session.activity_draft
    erp = get_erp_client()

    activity_payload = ActivityCreate(
        ticket_id=draft.ticket_id,
        start_datetime=draft.start_datetime,
        end_datetime=draft.end_datetime,
        description=draft.description or draft.summary,
        summary=draft.summary,
        root_cause=draft.root_cause,
        actions_taken=draft.actions_taken,
        commands_summary=draft.commands_summary,
        validation_result=draft.validation_result,
    )

    try:
        activity = await erp.create_activity(activity_payload)
    except ERPError as e:
        audit_logger.add_event(
            str(session.ticket_id), session_id, "system", "error",
            f"Activity submission failed: {e.message}",
        )
        return JSONResponse(
            status_code=502,
            content={"error": {"code": e.code, "message": e.message, "details": e.details}},
        )

    # Set ticket status to DONE
    try:
        await erp.set_ticket_status(session.ticket_id, TicketStatus.DONE)
    except ERPError:
        pass  # Don't fail the whole submission if status update fails

    session.state = SessionState.SUBMITTED
    sessions[session_id] = session

    audit_logger.add_event(
        str(session.ticket_id), session_id, "technician", "activity_submitted",
        f"Activity submitted to ERP (id={activity.id})",
        {"activity_id": activity.id},
    )

    return {"status": "submitted", "activity": activity}
