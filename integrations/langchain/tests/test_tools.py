from __future__ import annotations

import json

import pytest
from feedmyagent import FeedMyAgent, FeedMyAgentError, Item

from langchain_feedmyagent import (
    FeedMyAgentLatestTool,
    FeedMyAgentReportTool,
    FeedMyAgentSearchTool,
)
from langchain_feedmyagent._client import INTEGRATION_USER_AGENT, build_client


# ---------------------------------------------------------------------------
# fake FeedMyAgent client (no network) — captures calls, returns canned data
# ---------------------------------------------------------------------------


class FakeClient(FeedMyAgent):
    """A stand-in for FeedMyAgent that never hits the network.

    Subclasses the real client (rather than duck-typing) so it satisfies the
    tools' pydantic ``client: FeedMyAgent`` field validation.
    """

    def __init__(self, *, raise_error: FeedMyAgentError | None = None):
        super().__init__(user_agent=INTEGRATION_USER_AGENT)
        self.calls: list[tuple[str, dict]] = []
        self._raise_error = raise_error

    def _maybe_raise(self):
        if self._raise_error is not None:
            raise self._raise_error

    def latest(self, tags=None, use_case=None, limit=10):
        self.calls.append(("latest", {"tags": tags, "use_case": use_case, "limit": limit}))
        self._maybe_raise()
        return [
            Item(id="1", title="MCP auth bypass disclosed", summary="s", url="https://e/1",
                 tags=["mcp", "security"], score=9.1)
        ]

    def query(self, text, tags=None, limit=5):
        self.calls.append(("query", {"text": text, "tags": tags, "limit": limit}))
        self._maybe_raise()
        return [
            Item(id="2", title="Prompt injection in tool descriptions", summary=None,
                 url="https://e/2", tags=["prompt-injection"], score=4.4)
        ]

    def report(self, title, description, url=None):
        self.calls.append(("report", {"title": title, "description": description, "url": url}))
        self._maybe_raise()
        return Item(id="pending-1", title=title, summary=description, url=url or "https://e/gen",
                    tags=[], score=0.0)


# ---------------------------------------------------------------------------
# build_client / User-Agent
# ---------------------------------------------------------------------------


def test_build_client_sets_integration_user_agent():
    client = build_client()
    assert isinstance(client, FeedMyAgent)
    assert client.user_agent == "feedmyagent-langchain/0.1"


def test_tool_default_client_carries_integration_user_agent():
    tool = FeedMyAgentLatestTool()
    assert tool.client.user_agent == "feedmyagent-langchain/0.1"


# ---------------------------------------------------------------------------
# FeedMyAgentLatestTool
# ---------------------------------------------------------------------------


def test_latest_tool_invokes_client_latest_and_returns_json():
    fake = FakeClient()
    tool = FeedMyAgentLatestTool(client=fake)

    result = tool.invoke({"tags": ["mcp"], "use_case": "security", "limit": 3})

    assert fake.calls == [("latest", {"tags": ["mcp"], "use_case": "security", "limit": 3})]
    data = json.loads(result)
    assert data == [
        {
            "id": "1",
            "title": "MCP auth bypass disclosed",
            "summary": "s",
            "url": "https://e/1",
            "tags": ["mcp", "security"],
            "score": 9.1,
        }
    ]


def test_latest_tool_defaults():
    fake = FakeClient()
    tool = FeedMyAgentLatestTool(client=fake)
    tool.invoke({})
    assert fake.calls == [("latest", {"tags": None, "use_case": None, "limit": 10})]


def test_latest_tool_returns_error_text_on_api_error():
    fake = FakeClient(raise_error=FeedMyAgentError("invalid_request", "bad tag", 400))
    tool = FeedMyAgentLatestTool(client=fake)
    result = tool.invoke({})
    assert "invalid_request" in result
    assert "bad tag" in result


def test_latest_tool_empty_result_is_empty_json_array():
    class EmptyClient(FakeClient):
        def latest(self, tags=None, use_case=None, limit=10):
            self.calls.append(("latest", {}))
            return []

    tool = FeedMyAgentLatestTool(client=EmptyClient())
    assert tool.invoke({}) == "[]"


# ---------------------------------------------------------------------------
# FeedMyAgentSearchTool
# ---------------------------------------------------------------------------


def test_search_tool_invokes_client_query_and_returns_json():
    fake = FakeClient()
    tool = FeedMyAgentSearchTool(client=fake)

    result = tool.invoke({"query": "prompt injection", "limit": 2})

    assert fake.calls == [("query", {"text": "prompt injection", "tags": None, "limit": 2})]
    data = json.loads(result)
    assert data[0]["id"] == "2"
    assert data[0]["summary"] is None


def test_search_tool_requires_query_argument():
    tool = FeedMyAgentSearchTool(client=FakeClient())
    with pytest.raises(Exception):
        tool.invoke({})


def test_search_tool_returns_error_text_on_api_error():
    fake = FakeClient(raise_error=FeedMyAgentError("internal", "boom"))
    tool = FeedMyAgentSearchTool(client=fake)
    result = tool.invoke({"query": "x"})
    assert "FeedMyAgent error" in result
    assert "boom" in result


# ---------------------------------------------------------------------------
# FeedMyAgentReportTool
# ---------------------------------------------------------------------------


def test_report_tool_invokes_client_report_and_returns_created_item():
    fake = FakeClient()
    tool = FeedMyAgentReportTool(client=fake)

    result = tool.invoke(
        {"title": "New CVE", "description": "details", "url": "https://example.com/writeup"}
    )

    assert fake.calls == [
        ("report", {"title": "New CVE", "description": "details", "url": "https://example.com/writeup"})
    ]
    data = json.loads(result)
    assert data[0]["id"] == "pending-1"
    assert data[0]["title"] == "New CVE"


def test_report_tool_surfaces_unauthorized_error_as_text():
    fake = FakeClient(raise_error=FeedMyAgentError("unauthorized", "An API key is required", 401))
    tool = FeedMyAgentReportTool(client=fake)

    result = tool.invoke({"title": "t", "description": "d"})

    assert "unauthorized" in result
    assert "API key" in result
