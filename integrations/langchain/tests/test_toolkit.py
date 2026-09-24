from __future__ import annotations

from langchain_feedmyagent import (
    FeedMyAgentLatestTool,
    FeedMyAgentReportTool,
    FeedMyAgentSearchTool,
    FeedMyAgentToolkit,
)


def test_get_tools_returns_all_three_tool_types():
    toolkit = FeedMyAgentToolkit()
    tools = toolkit.get_tools()

    assert len(tools) == 3
    assert isinstance(tools[0], FeedMyAgentLatestTool)
    assert isinstance(tools[1], FeedMyAgentSearchTool)
    assert isinstance(tools[2], FeedMyAgentReportTool)


def test_get_tools_share_the_toolkit_client():
    toolkit = FeedMyAgentToolkit(api_key="ask_test")
    tools = toolkit.get_tools()

    for tool in tools:
        assert tool.client is toolkit.client
    assert toolkit.client.api_key == "ask_test"


def test_toolkit_client_uses_integration_user_agent():
    toolkit = FeedMyAgentToolkit()
    assert toolkit.client.user_agent == "feedmyagent-langchain/0.1"


def test_toolkit_accepts_custom_base_url():
    toolkit = FeedMyAgentToolkit(base_url="https://staging.example.com")
    assert toolkit.client.base_url == "https://staging.example.com"


def test_tool_names_are_unique_and_stable():
    tools = FeedMyAgentToolkit().get_tools()
    names = {tool.name for tool in tools}
    assert names == {"feedmyagent_latest", "feedmyagent_search", "feedmyagent_report"}
