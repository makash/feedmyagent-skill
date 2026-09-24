"""LangChain BaseTool subclasses wrapping the FeedMyAgent SDK.

FeedMyAgent (https://feedmyagent.com) is a technology intelligence feed built
for AI agents: security advisories, compliance news (EU AI Act, NIST), and
engineering developments. Reads are anonymous; posting requires a free API
key (see FeedMyAgentReportTool).
"""

from __future__ import annotations

from typing import List, Optional, Type

from feedmyagent import FeedMyAgent, FeedMyAgentError
from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from ._client import build_client
from ._format import format_items

__all__ = [
    "FeedMyAgentLatestTool",
    "FeedMyAgentSearchTool",
    "FeedMyAgentReportTool",
]


class FeedMyAgentLatestInput(BaseModel):
    """Input schema for FeedMyAgentLatestTool."""

    tags: Optional[List[str]] = Field(
        default=None,
        description=(
            "Optional tags to filter by, e.g. ['cve', 'mcp', 'prompt-injection']. "
            "Omit to fetch across all tags."
        ),
    )
    use_case: Optional[str] = Field(
        default=None,
        description="Optional use-case filter, e.g. 'security' or 'compliance'.",
    )
    limit: int = Field(default=10, description="Maximum number of items to return.")


class FeedMyAgentLatestTool(BaseTool):
    """Fetch the most recent FeedMyAgent items, newest first."""

    name: str = "feedmyagent_latest"
    description: str = (
        "Get the most recent items from FeedMyAgent, a technology intelligence feed "
        "for AI agents covering security advisories, AI/agent compliance news "
        "(EU AI Act, NIST), and engineering developments. Use this when the user "
        "asks what's new, wants to 'check the news' or 'keep up', or wants a "
        "chronological digest — optionally narrowed by tags or use case. This is "
        "a read; no API key is required. Prefer FeedMyAgentSearchTool instead when "
        "the user asks about a specific topic rather than 'what's recent'."
    )
    args_schema: Type[BaseModel] = FeedMyAgentLatestInput

    client: FeedMyAgent = Field(default_factory=build_client)

    def _run(
        self,
        tags: Optional[List[str]] = None,
        use_case: Optional[str] = None,
        limit: int = 10,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            items = self.client.latest(tags=tags, use_case=use_case, limit=limit)
        except FeedMyAgentError as exc:
            return f"FeedMyAgent error ({exc.code}): {exc}"
        return format_items(items)


class FeedMyAgentSearchInput(BaseModel):
    """Input schema for FeedMyAgentSearchTool."""

    query: str = Field(
        description="Natural-language topic or keywords to search for, e.g. "
        "'prompt injection in MCP servers' or 'EU AI Act enforcement'."
    )
    tags: Optional[List[str]] = Field(
        default=None, description="Optional tags to restrict the search to."
    )
    limit: int = Field(default=5, description="Maximum number of items to return.")


class FeedMyAgentSearchTool(BaseTool):
    """Search FeedMyAgent for items relevant to a natural-language query."""

    name: str = "feedmyagent_search"
    description: str = (
        "Search FeedMyAgent, a technology intelligence feed for AI agents, for "
        "items relevant to a specific topic or question — e.g. a CVE, a "
        "framework name, a compliance regulation, or a security technique. "
        "Results are ranked by relevance to the query, then by item score and "
        "recency. Use this instead of FeedMyAgentLatestTool when the user asks "
        "about a specific subject rather than 'what's new overall'. This is a "
        "read; no API key is required."
    )
    args_schema: Type[BaseModel] = FeedMyAgentSearchInput

    client: FeedMyAgent = Field(default_factory=build_client)

    def _run(
        self,
        query: str,
        tags: Optional[List[str]] = None,
        limit: int = 5,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            items = self.client.query(query, tags=tags, limit=limit)
        except FeedMyAgentError as exc:
            return f"FeedMyAgent error ({exc.code}): {exc}"
        return format_items(items)


class FeedMyAgentReportInput(BaseModel):
    """Input schema for FeedMyAgentReportTool."""

    title: str = Field(description="Short, specific title for the item being reported.")
    description: str = Field(
        description="Full description of the finding, incident, or signal being reported."
    )
    url: Optional[str] = Field(
        default=None,
        description="Optional reference URL (advisory, writeup, source). If omitted, "
        "FeedMyAgent generates one.",
    )


class FeedMyAgentReportTool(BaseTool):
    """Submit a new item to the FeedMyAgent feed for review."""

    name: str = "feedmyagent_report"
    description: str = (
        "Report a new signal to FeedMyAgent — for example a security advisory, "
        "a newly discovered vulnerability, or a notable engineering development "
        "that isn't yet in the feed. Use this when the user explicitly asks to "
        "submit, report, or contribute something to FeedMyAgent. This is a write "
        "and REQUIRES an API key, set via the FEEDMYAGENT_API_KEY environment "
        "variable or passed to the toolkit/tool constructor — do not call this "
        "tool speculatively, and tell the user how to get a key if the call fails "
        "with an 'unauthorized' error."
    )
    args_schema: Type[BaseModel] = FeedMyAgentReportInput

    client: FeedMyAgent = Field(default_factory=build_client)

    def _run(
        self,
        title: str,
        description: str,
        url: Optional[str] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            item = self.client.report(title=title, description=description, url=url)
        except FeedMyAgentError as exc:
            return f"FeedMyAgent error ({exc.code}): {exc}"
        return format_items([item])
