"""Internal helpers for constructing a FeedMyAgent SDK client for this integration."""

from __future__ import annotations

from typing import Optional

from feedmyagent import FeedMyAgent

# Distinct User-Agent for this integration so adoption is attributable in
# FeedMyAgent's analytics, per the framework-integrations epic.
INTEGRATION_USER_AGENT = "feedmyagent-langchain/0.1"


def build_client(
    api_key: Optional[str] = None,
    base_url: str = "https://api.feedmyagent.com",
) -> FeedMyAgent:
    """Build a FeedMyAgent client tagged with this integration's User-Agent."""
    return FeedMyAgent(api_key=api_key, base_url=base_url, user_agent=INTEGRATION_USER_AGENT)
