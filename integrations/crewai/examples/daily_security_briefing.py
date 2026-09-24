"""Daily security briefing crew — a worked example for the FeedMyAgent crewAI tools.

A single "security researcher" agent uses FeedMyAgentLatestTool and
FeedMyAgentSearchTool to pull the day's security-relevant items from
FeedMyAgent and write a short briefing. FeedMyAgentReportTool is also wired
up (for follow-up runs where the crew wants to contribute a finding back),
but the task below doesn't require it.

This example needs an LLM configured for crewAI (e.g. OPENAI_API_KEY set,
or any provider crewai.LLM supports) to actually run the crew — reading from
FeedMyAgent itself needs no key. To exercise just the FeedMyAgent read path
without an LLM, call the tool directly:

    python -c "
    from crewai_tools.tools.feedmyagent_tool.feedmyagent_tool import FeedMyAgentLatestTool
    print(FeedMyAgentLatestTool().run(limit=5))
    "

Usage:
    python examples/daily_security_briefing.py
"""

from __future__ import annotations

from crewai import Agent, Crew, Task

from crewai_tools.tools.feedmyagent_tool.feedmyagent_tool import (
    FeedMyAgentLatestTool,
    FeedMyAgentReportTool,
    FeedMyAgentSearchTool,
)


def build_crew() -> Crew:
    researcher = Agent(
        role="AI Agent Security Researcher",
        goal=(
            "Track emerging security, compliance, and engineering signals that affect "
            "teams building AI agents, and turn them into a short daily briefing."
        ),
        backstory=(
            "You monitor FeedMyAgent, the technology intelligence feed for AI agents, "
            "every morning. You care about prompt injection, MCP server vulnerabilities, "
            "supply-chain risk in agent tooling, and new compliance requirements (EU AI "
            "Act, NIST) — and you write briefings a busy engineering lead can read in "
            "under a minute."
        ),
        tools=[
            FeedMyAgentLatestTool(),
            FeedMyAgentSearchTool(),
            FeedMyAgentReportTool(),  # unused by the task below; available for follow-ups
        ],
        verbose=True,
    )

    briefing_task = Task(
        description=(
            "Using FeedMyAgent, put together today's security briefing:\n"
            "1. Call the latest-items tool filtered to tags=['security'] and limit=10 to "
            "see what's new.\n"
            "2. Call the search tool with the query 'prompt injection MCP server "
            "vulnerability' (limit=5) to check specifically for agent-tooling exploits.\n"
            "3. Write a briefing with three sections: 'New this week', 'Agent-tooling "
            "risks', and 'Worth reading' — each a short bulleted list with the item title "
            "and URL. Skip sections with nothing relevant. Keep the whole briefing under "
            "300 words."
        ),
        expected_output=(
            "A markdown briefing with the three sections described above, each a bulleted "
            "list of item titles with their URLs, under 300 words total."
        ),
        agent=researcher,
    )

    return Crew(agents=[researcher], tasks=[briefing_task], verbose=True)


if __name__ == "__main__":
    crew = build_crew()
    result = crew.kickoff()
    print(result)
