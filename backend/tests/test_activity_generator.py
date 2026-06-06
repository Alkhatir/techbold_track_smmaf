"""Tests for activity generation — uses deterministic fake data, no LLM calls."""

import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models import (
    ActivityDraft,
    AuditEvent,
    CommandResult,
    CustomerSystem,
    RiskLevel,
    SessionState,
    SystemInfo,
    Ticket,
    TicketSession,
    TicketStatus,
)
from app.ssh.redactor import redact_text


def _make_session() -> TicketSession:
    ticket = Ticket(
        id=7001,
        title="Web service returning 502",
        description="Our status API is down, returning 502 errors since this morning.",
        priority="high",
        status=TicketStatus.OPEN,
        customer_id=5001,
        customer_name="Nordlicht Logistik GmbH",
    )
    system_info = SystemInfo(ip="10.0.0.5", port=22, username="azureuser", os="Ubuntu 22.04 LTS")
    customer_system = CustomerSystem(ticket_id=7001, customer_id=5001, system=system_info)

    session = TicketSession(
        ticket_id=7001,
        ticket=ticket,
        customer_system=customer_system,
        state=SessionState.VALIDATING,
        connection_approved=True,
        started_at=datetime(2026, 6, 7, 10, 0, 0),
    )

    session.executed_commands = [
        CommandResult(
            id="cmd_001",
            command="systemctl list-units --failed --no-pager",
            stdout="nginx.service   failed\n",
            stderr="",
            exit_code=0,
            duration_seconds=0.5,
            risk=RiskLevel.READ_ONLY,
        ),
        CommandResult(
            id="cmd_002",
            command="journalctl -u nginx -n 20 --no-pager",
            stdout='Jun 07 10:00:01 host nginx[1234]: nginx: [emerg] open() "/var/www/app" failed (2: No such file or directory)\n',
            stderr="",
            exit_code=0,
            duration_seconds=0.3,
            risk=RiskLevel.READ_ONLY,
        ),
        CommandResult(
            id="cmd_003",
            command="mkdir -p /var/www/app",
            stdout="",
            stderr="",
            exit_code=0,
            duration_seconds=0.1,
            risk=RiskLevel.LOW_CHANGE,
        ),
        CommandResult(
            id="cmd_004",
            command="systemctl restart nginx",
            stdout="",
            stderr="",
            exit_code=0,
            duration_seconds=1.2,
            risk=RiskLevel.SERVICE_RESTART,
        ),
        CommandResult(
            id="cmd_005",
            command="systemctl is-active nginx",
            stdout="active\n",
            stderr="",
            exit_code=0,
            duration_seconds=0.2,
            risk=RiskLevel.READ_ONLY,
        ),
    ]

    return session


def test_activity_draft_has_required_fields():
    """ActivityDraft model must have all required fields."""
    session = _make_session()

    now = datetime(2026, 6, 7, 10, 25, 0)
    draft = ActivityDraft(
        ticket_id=session.ticket_id,
        start_datetime=session.started_at,  # type: ignore[arg-type]
        end_datetime=now,
        summary="Restored nginx web service after missing document root caused start failure.",
        root_cause="The nginx service failed to start because the configured document root /var/www/app did not exist on the filesystem.",
        actions_taken="1. Checked failed systemd units. 2. Inspected nginx journal for errors. 3. Created missing /var/www/app directory. 4. Restarted nginx. 5. Confirmed service active.",
        commands_summary="systemctl list-units --failed, journalctl -u nginx, mkdir -p /var/www/app, systemctl restart nginx, systemctl is-active nginx",
        validation_result="systemctl is-active nginx returned 'active'. Service confirmed running after restart.",
    )

    assert draft.summary
    assert draft.root_cause
    assert draft.actions_taken
    assert draft.commands_summary
    assert draft.validation_result
    assert draft.ticket_id == 7001


def test_activity_draft_no_secrets():
    """commands_summary must not contain secret-like strings."""
    draft = ActivityDraft(
        ticket_id=7001,
        start_datetime=datetime(2026, 6, 7, 10, 0, 0),
        end_datetime=datetime(2026, 6, 7, 10, 25, 0),
        summary="Restored web service.",
        root_cause="Missing directory.",
        actions_taken="Created directory and restarted service.",
        commands_summary="mkdir /var/www/app, systemctl restart nginx",
        validation_result="Service active.",
    )
    # Verify redaction doesn't corrupt clean content
    redacted = redact_text(draft.commands_summary)
    assert redacted == draft.commands_summary


def test_session_command_results_present():
    """Executed commands are stored in session."""
    session = _make_session()
    assert len(session.executed_commands) == 5
    assert any(r.exit_code == 0 for r in session.executed_commands)


def test_validation_commands_identified():
    """Validation commands (zero exit code, is-active / curl) present in results."""
    session = _make_session()
    validation = [r for r in session.executed_commands if "is-active" in r.command or "curl" in r.command]
    assert len(validation) >= 1
    assert all(r.exit_code == 0 for r in validation)


def test_activity_draft_root_cause_technical():
    """Root cause should not just be the symptom."""
    draft = ActivityDraft(
        ticket_id=7001,
        start_datetime=datetime(2026, 6, 7, 10, 0, 0),
        end_datetime=datetime(2026, 6, 7, 10, 25, 0),
        summary="Restored web service.",
        root_cause="The nginx service failed to start because the configured document root /var/www/app did not exist.",
        actions_taken="Created directory and restarted nginx.",
        commands_summary="mkdir, systemctl restart",
        validation_result="nginx active.",
    )
    # Root cause should mention a technical reason, not just "service is down"
    assert "nginx is down" not in draft.root_cause.lower()
    assert len(draft.root_cause) > 20
