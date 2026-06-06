from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# ERP models — matching phoenix-openapi.yaml exactly
# ---------------------------------------------------------------------------

class TicketStatus(str, Enum):
    OPEN = "OPEN"
    PENDING = "PENDING"
    DONE = "DONE"


class SystemInfo(BaseModel):
    ip: str
    port: int = 22
    username: str
    os: str
    notes: Optional[str] = None


class Ticket(BaseModel):
    id: int
    title: str
    description: str
    priority: str
    status: TicketStatus
    customer_id: int
    customer_name: str
    tags: list[str] = []
    sla_due_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class CustomerSystem(BaseModel):
    ticket_id: int
    customer_id: int
    system: SystemInfo


class Employee(BaseModel):
    id: int
    firstname: str
    lastname: str
    username: str
    teamname: str


class ActivityCreate(BaseModel):
    ticket_id: int
    start_datetime: datetime
    end_datetime: datetime
    description: Optional[str] = None
    summary: Optional[str] = None
    root_cause: Optional[str] = None
    actions_taken: Optional[str] = None
    commands_summary: Optional[str] = None
    validation_result: Optional[str] = None


class Activity(BaseModel):
    id: int
    team_id: int
    team_name: str
    employee_id: int
    ticket_id: int
    start_datetime: datetime
    end_datetime: datetime
    description: str 
    summary: Optional[str] = None
    root_cause: Optional[str] = None
    actions_taken: Optional[str] = None
    commands_summary: Optional[str] = None
    validation_result: Optional[str] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Internal enums
# ---------------------------------------------------------------------------

class RiskLevel(str, Enum):
    READ_ONLY = "read_only"
    SERVICE_RESTART = "service_restart"
    LOW_CHANGE = "low_change"
    PACKAGE_CHANGE = "package_change"
    NEEDS_MANUAL_REVIEW = "needs_manual_review"
    BLOCKED = "blocked"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    BLOCKED = "blocked"


class SessionState(str, Enum):
    CREATED = "created"
    SYSTEM_LOADED = "system_loaded"
    CONNECTION_PENDING = "connection_pending_approval"
    CONNECTED = "connected"
    DIAGNOSING = "diagnosing"
    FIX_PENDING = "fix_pending_approval"
    FIXING = "fixing"
    VALIDATING = "validating"
    ACTIVITY_READY = "activity_ready"
    SUBMITTED = "submitted"
    ABORTED = "aborted"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Safety
# ---------------------------------------------------------------------------

class SafetyDecision(BaseModel):
    allowed: bool
    risk: RiskLevel
    reason: str
    normalized_command: str


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

class ProposedCommand(BaseModel):
    id: str = Field(default_factory=lambda: f"cmd_{uuid.uuid4().hex[:8]}")
    command: str
    reason: str
    risk: RiskLevel
    expected_result: str
    requires_approval: bool = True
    blocked: bool = False
    block_reason: Optional[str] = None
    approval_status: ApprovalStatus = ApprovalStatus.PENDING
    technician_note: Optional[str] = None


class CommandResult(BaseModel):
    id: str
    command: str
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False
    duration_seconds: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    risk: RiskLevel = RiskLevel.READ_ONLY
    redacted: bool = True


# ---------------------------------------------------------------------------
# Agent outputs
# ---------------------------------------------------------------------------

class Hypothesis(BaseModel):
    title: str
    description: str
    confidence: str
    supporting_evidence: list[str] = []
    next_check: str


class AgentAnalysis(BaseModel):
    ticket_summary: str
    affected_component: Optional[str] = None
    hypotheses: list[Hypothesis] = []
    proposed_commands: list[dict] = []


class FixPlan(BaseModel):
    root_cause: str
    evidence: list[str] = []
    needs_more_diagnostics: bool = False
    additional_diagnostic_commands: list[dict] = []
    fix_commands: list[dict] = []
    validation_commands: list[dict] = []


class ActivityDraft(BaseModel):
    ticket_id: int
    start_datetime: datetime
    end_datetime: datetime
    summary: str
    root_cause: str
    actions_taken: str
    commands_summary: str
    validation_result: str
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditEvent(BaseModel):
    id: str = Field(default_factory=lambda: f"evt_{uuid.uuid4().hex[:8]}")
    ticket_id: str
    session_id: str
    actor: str
    event_type: str
    message: str
    data: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class TicketSession(BaseModel):
    id: str = Field(default_factory=lambda: f"sess_{uuid.uuid4().hex[:12]}")
    ticket_id: int
    ticket: Optional[Ticket] = None
    customer_system: Optional[CustomerSystem] = None
    state: SessionState = SessionState.CREATED
    connection_approved: bool = False
    pending_commands: list[ProposedCommand] = []
    executed_commands: list[CommandResult] = []
    analysis: Optional[AgentAnalysis] = None
    fix_plan: Optional[FixPlan] = None
    activity_draft: Optional[ActivityDraft] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    error_message: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True}


# ---------------------------------------------------------------------------
# Request / response helpers
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    ticket_id: int


class ApproveConnectionRequest(BaseModel):
    approved: bool


class ApproveCommandRequest(BaseModel):
    approved: bool
    edited_command: Optional[str] = None
    technician_note: Optional[str] = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: str = ""


class ErrorResponse(BaseModel):
    error: ErrorDetail
