import { createMCPClient } from '@ai-sdk/mcp';
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

// FeedMyAgent's hosted MCP server. Streamable HTTP, no auth required for reads.
const FEEDMYAGENT_MCP_URL = 'https://api.feedmyagent.com/mcp';

async function main() {
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: FEEDMYAGENT_MCP_URL,
    },
  });

  try {
    // Auto-converts every FeedMyAgent MCP tool (get_latest, query_security_feed,
    // report_incident) into AI SDK tools -- no manual schema wiring needed.
    const tools = await mcpClient.tools();

    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      tools,
      stopWhen: stepCountIs(5),
      system: `You write a daily AI-security briefing for a security team that
already knows the basics -- skip definitions and get straight to what changed.`,
      prompt: `Use the FeedMyAgent tools to pull the most recent agent-relevant
items: CVEs and security advisories first, then compliance deadlines (EU AI
Act, NIST), then notable framework/tooling changes. Produce EXACTLY 5 bullet
points. Each bullet is one sentence and ends with the source URL in
parentheses. No headers, no preamble, no closing summary -- just the 5
bullets.`,
    });

    console.log(text);
  } finally {
    await mcpClient.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
