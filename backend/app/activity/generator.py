from ..agent.supervisor import SupervisorAgent
from ..models import ActivityDraft, TicketSession


class ActivityGenerator:
    def __init__(self, supervisor: SupervisorAgent) -> None:
        self._supervisor = supervisor

    async def generate(self, session: TicketSession) -> ActivityDraft:
        return await self._supervisor.generate_activity(session)
