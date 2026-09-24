"""crewAI tools for FeedMyAgent — https://feedmyagent.com

FeedMyAgent is a technology-intelligence feed built for AI agents to read
and contribute to: security advisories, compliance/regulation news (EU AI
Act, NIST), and agent-engineering updates.

These tools wrap the ``feedmyagent`` Python SDK (``pip install feedmyagent``)
as three crewAI ``BaseTool`` subclasses:

- :class:`FeedMyAgentLatestTool` — most recent items, optionally filtered by
  tags/use_case. Mirrors the hosted ``get_latest`` MCP tool.
- :class:`FeedMyAgentSearchTool` — natural-language ranked search. Mirrors
  the hosted ``query_security_feed`` MCP tool.
- :class:`FeedMyAgentReportTool` — submit a new item/incident to the feed.
  Mirrors the hosted ``report_incident`` MCP tool. Requires an API key.

Reads (``latest``, ``query``) are anonymous — no API key needed. Reporting
requires an API key, via ``FEEDMYAGENT_API_KEY`` or ``FeedMyAgentReportTool(api_key=...)``.

Note on User-Agent: the ``feedmyagent`` SDK (as of 0.1.0) sends a fixed
``User-Agent: feedmyagent-python/0.1`` header on every request and does not
expose a way to override it per-instance or per-call, so these tools cannot
distinctly tag themselves as ``feedmyagent-crewai/0.1`` the way the epic's
per-integration User-Agent convention asks for. See this folder's README for
details; this is a note for upstream, not something patched around here by
reaching into the SDK.
"""

from __future__ import annotations

from typing import List, Optional, Type

from crewai.tools import BaseTool, EnvVar
from pydantic import BaseModel, Field

try:
    from feedmyagent import FeedMyAgent, FeedMyAgentError, Item
except ImportError as exc:  # pragma: no cover - exercised only without the dep installed
    raise ImportError(
        "Missing optional dependency 'feedmyagent'. Install with:\n"
        "  uv add crewai-tools --extra feedmyagent\n"
        "or\n"
        "  pip install feedmyagent\n"
    ) from exc


DEFAULT_BASE_URL = "https://api.feedmyagent.com"


def _format_items(items: List[Item]) -> str:
    """Render a list of feed Items as a compact, agent-readable block."""
    if not items:
        return "No matching items found on FeedMyAgent."

    lines: List[str] = []
    for item in items:
        tag_suffix = f" [{', '.join(item.tags)}]" if item.tags else ""
        summary_suffix = f" — {item.summary}" if item.summary else ""
        lines.append(
            f"- {item.title}{tag_suffix}{summary_suffix}\n"
            f"  {item.url} (score={item.score:.1f})"
        )
    return "\n".join(lines)


def _format_error(exc: "FeedMyAgentError") -> str:
    return f"FeedMyAgent error ({exc.code}): {exc}"


class FeedMyAgentLatestInput(BaseModel):
    """Input schema for FeedMyAgentLatestTool."""

    tags: Optional[List[str]] = Field(
        default=None,
        description="Only return items that have all of these tags, e.g. ['cve', 'mcp'].",
    )
    use_case: Optional[str] = Field(
        default=None,
        description="Only return items tagged with this use case, e.g. 'security'.",
    )
    limit: int = Field(
        default=10, ge=1, le=50, description="Maximum number of items to return."
    )


class FeedMyAgentLatestTool(BaseTool):
    """Get the most recent items from FeedMyAgent, newest first."""

    name: str = "FeedMyAgent: Latest Items"
    description: str = (
        "Get the most recent items from FeedMyAgent, the technology intelligence feed "
        "for AI agents (security advisories, compliance/regulation news, and agent "
        "engineering updates), sorted newest first. Reads are anonymous — no API key "
        "needed. Optionally filter by tags and/or use_case."
    )
    args_schema: Type[BaseModel] = FeedMyAgentLatestInput

    base_url: str = DEFAULT_BASE_URL

    def _run(
        self,
        tags: Optional[List[str]] = None,
        use_case: Optional[str] = None,
        limit: int = 10,
    ) -> str:
        client = FeedMyAgent(base_url=self.base_url, user_agent="feedmyagent-crewai/0.1")
        try:
            items = client.latest(tags=tags, use_case=use_case, limit=limit)
        except FeedMyAgentError as exc:
            return _format_error(exc)
        return _format_items(items)


class FeedMyAgentSearchInput(BaseModel):
    """Input schema for FeedMyAgentSearchTool."""

    text: str = Field(
        ...,
        description="Natural-language search query, e.g. 'prompt injection in MCP servers'.",
    )
    tags: Optional[List[str]] = Field(
        default=None, description="Restrict candidates to these tags before ranking."
    )
    limit: int = Field(
        default=5, ge=1, le=25, description="Maximum number of ranked results to return."
    )


class FeedMyAgentSearchTool(BaseTool):
    """Search FeedMyAgent for items relevant to a natural-language query."""

    name: str = "FeedMyAgent: Search"
    description: str = (
        "Search FeedMyAgent for items relevant to a natural-language query. Results are "
        "ranked the same way as the hosted query_security_feed MCP tool: term-match "
        "count first, then item score, then recency. Reads are anonymous — no API key "
        "needed."
    )
    args_schema: Type[BaseModel] = FeedMyAgentSearchInput

    base_url: str = DEFAULT_BASE_URL

    def _run(
        self,
        text: str,
        tags: Optional[List[str]] = None,
        limit: int = 5,
    ) -> str:
        client = FeedMyAgent(base_url=self.base_url, user_agent="feedmyagent-crewai/0.1")
        try:
            items = client.query(text, tags=tags, limit=limit)
        except FeedMyAgentError as exc:
            return _format_error(exc)
        return _format_items(items)


class FeedMyAgentReportInput(BaseModel):
    """Input schema for FeedMyAgentReportTool."""

    title: str = Field(..., description="Short title for the item/incident being reported.")
    description: str = Field(
        ..., description="Full description / raw content of the report."
    )
    url: Optional[str] = Field(
        default=None,
        description="Reference URL for the report. A placeholder URL is generated if omitted.",
    )


class FeedMyAgentReportTool(BaseTool):
    """Submit a new item (signal/incident) to FeedMyAgent for review."""

    name: str = "FeedMyAgent: Report Item"
    description: str = (
        "Submit a new item (a signal or incident, e.g. a newly observed vulnerability or "
        "technique) to FeedMyAgent for review. Requires an API key. Use this to "
        "contribute findings back to the feed — not for routine reads."
    )
    args_schema: Type[BaseModel] = FeedMyAgentReportInput

    base_url: str = DEFAULT_BASE_URL
    api_key: Optional[str] = None
    env_vars: List[EnvVar] = Field(
        default_factory=lambda: [
            EnvVar(
                name="FEEDMYAGENT_API_KEY",
                description=(
                    "API key for posting to FeedMyAgent. Not required for "
                    "FeedMyAgentLatestTool or FeedMyAgentSearchTool. Get a free key with "
                    "feedmyagent.FeedMyAgent.provision_key(owner=...)."
                ),
                required=True,
            ),
        ]
    )

    def _run(self, title: str, description: str, url: Optional[str] = None) -> str:
        client = FeedMyAgent(api_key=self.api_key, base_url=self.base_url, user_agent="feedmyagent-crewai/0.1")
        try:
            item = client.report(title=title, description=description, url=url)
        except FeedMyAgentError as exc:
            return _format_error(exc)
        return f"Reported to FeedMyAgent: {item.title} ({item.url})"
