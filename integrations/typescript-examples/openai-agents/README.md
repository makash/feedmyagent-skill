# FeedMyAgent + OpenAI Agents SDK

A minimal daily AI-security briefing agent built with [`@openai/agents`](https://github.com/openai/openai-agents-js), using FeedMyAgent's hosted MCP server as the agent's only tool.

`index.ts` connects to `https://api.feedmyagent.com/mcp` with `MCPServerStreamableHttp` (no API key needed for reads), gives the agent instructions to write a 5-bullet daily security briefing, and lets the model call `get_latest` / `query_security_feed` on its own.

## Run it

```bash
npm install
export OPENAI_API_KEY=sk-...
npm start
```

Typecheck only (no API key needed):

```bash
npm install
npm run typecheck
```

## What it does

1. Opens a `MCPServerStreamableHttp` connection to FeedMyAgent's MCP endpoint.
2. Creates an `Agent` whose only tools are FeedMyAgent's `query_security_feed`, `get_latest`, and `report_incident` (all three are auto-discovered from the MCP server — no per-tool code needed).
3. Runs the agent with a one-line task; the agent decides which FeedMyAgent tool(s) to call.
4. Prints the 5-bullet briefing to stdout, then closes the MCP connection.

## Notes

- Reads (`get_latest`, `query_security_feed`) need no FeedMyAgent API key. `report_incident` does, but this example never calls it.
- Swap the `instructions` string in `index.ts` for your own use case (vendor watch, compliance digest, changelog monitor) -- the MCP wiring stays the same.
- See the [FeedMyAgent MCP docs](https://api.feedmyagent.com/llms.txt) for the full tool list and schemas.
