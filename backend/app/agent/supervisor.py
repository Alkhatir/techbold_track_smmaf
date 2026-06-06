from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import anthropic

from ..audit.log import AuditLogger
from ..models import (
    AgentAnalysis,
    ActivityDraft,
    FixPlan,
    Hypothesis,
    ProposedCommand,
    TicketSession,
)
from ..ssh.safety import classify_command
from .prompts import (
    SYSTEM_PROMPT,
    build_activity_prompt,
    build_analysis_prompt,
    build_fix_prompt,
)
from .schemas import ACTIVITY_TOOL, ANALYSIS_TOOL, FIX_PLAN_TOOL


class SupervisorAgent:
    def __init__(self, client: anthropic.AsyncAnthropic, audit_logger: AuditLogger) -> None:
        self._client = client
        self._audit = audit_logger

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _call_tool(self, tool_schema: dict, prompt: str) -> dict:
        """Force the model to call a tool and return its structured input."""
        from ..config import settings

        response = await self._client.messages.create(
            model=settings.anthropic_model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": tool_schema["name"]},
            messages=[{"role": "user", "content": prompt}],
        )
        for block in response.content:
            if hasattr(block, "type") and block.type == "tool_use":
                return block.input  # type: ignore[return-value]
        raise ValueError("LLM did not return a tool_use block")

    def _to_proposed_commands(self, raw: list[dict]) -> list[ProposedCommand]:
        result = []
        for item in raw:
            command = item.get("command", "").strip()
            if not command:
                continue
            safety = classify_command(command)
            result.append(
                ProposedCommand(
                    command=command,
                    reason=item.get("reason", ""),
                    risk=safety.risk,
                    expected_result=item.get("expected_result", ""),
                    requires_approval=True,
                    blocked=not safety.allowed,
                    block_reason=safety.reason if not safety.allowed else None,
                )
            )
        return result

    def _format_command_results(self, session: TicketSession) -> str:
        lines = []
        for r in session.executed_commands:
            lines.append(f"$ {r.command}")
            lines.append(f"exit_code={r.exit_code}")
            if r.stdout:
                lines.append(r.stdout[:2000])
            if r.stderr:
                lines.append(f"STDERR: {r.stderr[:500]}")
            lines.append("")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def analyze_ticket(
        self, session: TicketSession
    ) -> tuple[AgentAnalysis, list[ProposedCommand]]:
        if not session.ticket or not session.customer_system:
            raise ValueError("Session must have ticket and customer_system loaded")

        self._audit.add_event(
            ticket_id=str(session.ticket_id),
            session_id=session.id,
            actor="agent",
            event_type="agent_analysis_started",
            message="Starting ticket analysis",
        )

        prompt = build_analysis_prompt(
            ticket=session.ticket,
            customer_system=session.customer_system,
            audit_summary=self._audit.summary(session.id),
            command_results=self._format_command_results(session),
        )

        data = await self._call_tool(ANALYSIS_TOOL, prompt)

        hypotheses = [Hypothesis(**h) for h in data.get("hypotheses", [])]
        proposed = self._to_proposed_commands(data.get("proposed_commands", []))

        analysis = AgentAnalysis(
            ticket_summary=data.get("ticket_summary", ""),
            affected_component=data.get("affected_component"),
            hypotheses=hypotheses,
            proposed_commands=[p.model_dump() for p in proposed],
        )

        self._audit.add_event(
            ticket_id=str(session.ticket_id),
            session_id=session.id,
            actor="agent",
            event_type="hypotheses_generated",
            message=f"Generated {len(hypotheses)} hypotheses and {len(proposed)} proposed commands",
        )

        return analysis, proposed

    async def propose_fix(
        self, session: TicketSession
    ) -> tuple[FixPlan, list[ProposedCommand]]:
        if not session.ticket or not session.customer_system:
            raise ValueError("Session must have ticket and customer_system loaded")

        prompt = build_fix_prompt(
            ticket=session.ticket,
            customer_system=session.customer_system,
            command_results=self._format_command_results(session),
            audit_summary=self._audit.summary(session.id),
        )

        data = await self._call_tool(FIX_PLAN_TOOL, prompt)

        fix_cmds = self._to_proposed_commands(data.get("fix_commands", []))
        val_cmds = self._to_proposed_commands(data.get("validation_commands", []))
        diag_cmds = self._to_proposed_commands(data.get("additional_diagnostic_commands", []))

        fix_plan = FixPlan(
            root_cause=data.get("root_cause", ""),
            evidence=data.get("evidence", []),
            needs_more_diagnostics=data.get("needs_more_diagnostics", False),
            fix_commands=[c.model_dump() for c in fix_cmds],
            validation_commands=[c.model_dump() for c in val_cmds],
            additional_diagnostic_commands=[c.model_dump() for c in diag_cmds],
        )

        all_proposed = fix_cmds + val_cmds + diag_cmds

        self._audit.add_event(
            ticket_id=str(session.ticket_id),
            session_id=session.id,
            actor="agent",
            event_type="fix_plan_generated",
            message=f"Fix plan: {fix_plan.root_cause[:120]}",
        )

        return fix_plan, all_proposed

    async def generate_activity(self, session: TicketSession) -> ActivityDraft:
        if not session.ticket:
            raise ValueError("Session must have ticket loaded")

        validation_results = "\n".join(
            f"$ {r.command}\nexit={r.exit_code}\n{r.stdout[:500]}"
            for r in session.executed_commands
            if r.exit_code == 0
        )

        prompt = build_activity_prompt(
            ticket=session.ticket,
            audit_events=self._audit.summary(session.id),
            command_results=self._format_command_results(session),
            validation_results=validation_results,
        )

        data = await self._call_tool(ACTIVITY_TOOL, prompt)

        now = datetime.utcnow()
        start = session.started_at or session.created_at

        draft = ActivityDraft(
            ticket_id=session.ticket_id,
            start_datetime=start,
            end_datetime=now,
            summary=data.get("summary", ""),
            root_cause=data.get("root_cause", ""),
            actions_taken=data.get("actions_taken", ""),
            commands_summary=data.get("commands_summary", ""),
            validation_result=data.get("validation_result", ""),
        )

        self._audit.add_event(
            ticket_id=str(session.ticket_id),
            session_id=session.id,
            actor="agent",
            event_type="activity_generated",
            message="Activity draft generated",
        )

        return draft
