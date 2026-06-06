from .models import TicketSession

# In-memory session store — keyed by session_id
sessions: dict[str, TicketSession] = {}

# SSH runners — keyed by session_id (not serialisable, stored separately)
ssh_runners: dict = {}
