"""Factory for the chat LLM client (PLAN §5, §9), mirroring `app.market.factory`."""

from __future__ import annotations

from ..config import Settings
from .llm import LLMClient, OpenRouterLLMClient
from .mock import MockLLMClient


def create_llm_client(settings: Settings) -> LLMClient | None:
    """Choose the chat client from settings.

    - LLM_MOCK=true → MockLLMClient, even when a key is set (tests and E2E stay free)
    - OPENROUTER_API_KEY set → OpenRouterLLMClient (litellm is not imported yet)
    - Neither → None: the app still starts and POST /api/chat returns 503
    """
    if settings.llm_mock:
        return MockLLMClient()
    if settings.openrouter_api_key:
        return OpenRouterLLMClient(settings.openrouter_api_key)
    return None
