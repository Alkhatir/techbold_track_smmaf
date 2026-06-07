from typing import Any

from ..models import AuditEvent
from ..ssh.redactor import redact_dict


class AuditLogger:
    def __init__(self) -> None:
        self._store: dict[str, list[AuditEvent]] = {}

    def add_event(
        self,
        ticket_id: str,
        session_id: str,
        actor: str,
        event_type: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> AuditEvent:
        safe_data = redact_dict(data) if data else None
        event = AuditEvent(
            ticket_id=ticket_id,
            session_id=session_id,
            actor=actor,
            event_type=event_type,
            message=message,
            data=safe_data,
        )
        self._store.setdefault(session_id, []).append(event)
        return event

    def list_events(self, session_id: str) -> list[AuditEvent]:
        return list(self._store.get(session_id, []))

    def summary(self, session_id: str) -> str:
        events = self.list_events(session_id)
        lines = [
            f"[{e.timestamp.strftime('%H:%M:%S')}] {e.event_type}: {e.message}"
            for e in events
        ]
        return "\n".join(lines)


# Module-level singleton used throughout the app
audit_logger = AuditLogger()
