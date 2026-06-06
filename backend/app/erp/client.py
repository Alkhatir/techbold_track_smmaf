import httpx

from ..models import Activity, ActivityCreate, CustomerSystem, Employee, Ticket, TicketStatus


class ERPError(Exception):
    def __init__(self, code: str, message: str, details: str = ""):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


class ERPClient:
    def __init__(self, base_url: str, bearer_token: str):
        self._base_url = base_url.rstrip("/")
        # Store token privately — never log it
        self._headers = {"Authorization": f"Bearer {bearer_token}"}

    def _make_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=30.0,
        )

    def _handle(self, response: httpx.Response, resource: str = "resource") -> dict:
        if response.status_code == 401:
            raise ERPError("ERP_UNAUTHORIZED", "Unauthorized: check ERP bearer token.")
        if response.status_code == 403:
            raise ERPError("ERP_FORBIDDEN", "Forbidden: insufficient permissions.")
        if response.status_code == 404:
            raise ERPError("ERP_NOT_FOUND", f"{resource} not found.")
        if response.status_code >= 500:
            raise ERPError("ERP_SERVER_ERROR", "ERP server error.", f"HTTP {response.status_code}")
        response.raise_for_status()
        return response.json()

    async def get_me(self) -> Employee:
        try:
            async with self._make_client() as client:
                r = await client.get("/api/v1/me")
                return Employee(**self._handle(r, "Employee"))
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def list_my_open_tickets(
        self,
        status: str | None = None,
        priority: str | None = None,
        sort: str = "date",
    ) -> list[Ticket]:
        try:
            params: dict = {"sort": sort}
            if status:
                params["status"] = status
            if priority:
                params["priority"] = priority
            async with self._make_client() as client:
                r = await client.get("/api/v1/me/tickets", params=params)
                data = self._handle(r, "Tickets")
                return [Ticket(**t) for t in (data or [])]
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def get_ticket(self, ticket_id: int) -> Ticket:
        try:
            async with self._make_client() as client:
                r = await client.get(f"/api/v1/tickets/{ticket_id}")
                return Ticket(**self._handle(r, "Ticket"))
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def get_customer_system(self, ticket_id: int) -> CustomerSystem:
        try:
            async with self._make_client() as client:
                r = await client.get(f"/api/v1/tickets/{ticket_id}/customer-system")
                return CustomerSystem(**self._handle(r, "CustomerSystem"))
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def set_ticket_status(self, ticket_id: int, status: TicketStatus) -> Ticket:
        try:
            async with self._make_client() as client:
                r = await client.patch(
                    f"/api/v1/tickets/{ticket_id}/status",
                    json={"status": status.value},
                )
                return Ticket(**self._handle(r, "Ticket"))
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def create_activity(self, activity: ActivityCreate) -> Activity:
        try:
            payload = activity.model_dump(mode="json", exclude_none=True)
            async with self._make_client() as client:
                r = await client.post("/api/v1/activities/create", json=payload)
                return Activity(**self._handle(r, "Activity"))
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))

    async def reset(self) -> dict:
        try:
            async with self._make_client() as client:
                r = await client.post("/api/v1/me/reset")
                return self._handle(r, "Reset")
        except ERPError:
            raise
        except Exception as e:
            raise ERPError("ERP_UNAVAILABLE", "ERP is unavailable.", str(e))
