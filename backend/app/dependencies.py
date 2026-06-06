import anthropic
from fastapi import Request

from .audit.log import audit_logger
from .config import settings


def get_anthropic_client(request: Request) -> anthropic.AsyncAnthropic:
    return request.app.state.anthropic_client


def get_audit_logger():
    return audit_logger


def get_erp_client():
    from .erp.client import ERPClient
    return ERPClient(base_url=settings.erp_base_url, bearer_token=settings.erp_bearer_token)
