"""FastAPI entrypoint — techbold AI Service Desk Autopilot."""

from contextlib import asynccontextmanager

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .api import routes_agent, routes_sessions, routes_tickets
from .api import websocket as ws_module


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    yield
    await app.state.anthropic_client.close()


app = FastAPI(
    title="techbold AI Service Desk Autopilot",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_tickets.router, prefix="/api")
app.include_router(routes_sessions.router, prefix="/api")
app.include_router(routes_agent.router, prefix="/api")
app.include_router(ws_module.router)


@app.get("/health")
def health():
    return {"status": "ok"}
