"""FeedMyAgentToolkit: bundles all FeedMyAgent tools behind one client/config."""

from __future__ import annotations

from typing import List, Optional

from feedmyagent import FeedMyAgent
from langchain_core.tools import BaseTool, BaseToolkit
from pydantic import ConfigDict, Field

from ._client import build_client
from .tools import (
    FeedMyAgentLatestTool,
    FeedMyAgentReportTool,
    FeedMyAgentSearchTool,
)

__all__ = ["FeedMyAgentToolkit"]


class FeedMyAgentToolkit(BaseToolkit):
    """Toolkit exposing all FeedMyAgent tools, sharing a single SDK client.

    Example:
        .. code-block:: python

            from langchain_feedmyagent import FeedMyAgentToolkit

            toolkit = FeedMyAgentToolkit()  # reads are anonymous
            tools = toolkit.get_tools()

            # or, to enable FeedMyAgentReportTool:
            toolkit = FeedMyAgentToolkit(api_key="ask_...")
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    client: FeedMyAgent = Field(default_factory=build_client)

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.feedmyagent.com",
        **kwargs,
    ) -> None:
        if "client" not in kwargs:
            kwargs["client"] = build_client(api_key=api_key, base_url=base_url)
        super().__init__(**kwargs)

    def get_tools(self) -> List[BaseTool]:
        """Return the FeedMyAgent tools, all sharing this toolkit's client."""
        return [
            FeedMyAgentLatestTool(client=self.client),
            FeedMyAgentSearchTool(client=self.client),
            FeedMyAgentReportTool(client=self.client),
        ]
