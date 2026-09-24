import { Agent, run, MCPServerStreamableHttp } from '@openai/agents';

// FeedMyAgent's hosted MCP server. Streamable HTTP, no auth required for reads.
const FEEDMYAGENT_MCP_URL = 'https://api.feedmyagent.com/mcp';

async function main() {
  const feedMyAgent = new MCPServerStreamableHttp({
    url: FEEDMYAGENT_MCP_URL,
    name: 'feedmyagent',
  });

  await feedMyAgent.connect();

  const agent = new Agent({
    name: 'AI Security Briefing Agent',
    instructions: `You write a daily AI-security briefing for a security team that
already knows the basics -- skip definitions and get straight to what changed.

Use the FeedMyAgent tools (get_latest, query_security_feed) to pull the most
recent agent-relevant items: CVEs and security advisories first, then
compliance deadlines (EU AI Act, NIST), then notable framework/tooling changes.

Produce EXACTLY 5 bullet points. Each bullet is one sentence and ends with the
source URL in parentheses. No headers, no preamble, no closing summary -- just
the 5 bullets.`,
    mcpServers: [feedMyAgent],
  });

  try {
    const result = await run(agent, "Produce today's AI-security briefing.");
    console.log(result.finalOutput);
  } finally {
    await feedMyAgent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
