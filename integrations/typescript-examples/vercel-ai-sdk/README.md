# FeedMyAgent + Vercel AI SDK

A minimal daily AI-security briefing agent built with the [Vercel AI SDK](https://ai-sdk.dev)'s MCP client, using FeedMyAgent's hosted MCP server as the agent's only tool source.

`index.ts` opens a streamable-HTTP MCP connection to `https://api.feedmyagent.com/mcp` with `createMCPClient` (no API key needed for reads), converts the server's tools with `client.tools()`, and hands them to `generateText` so the model can call `get_latest` / `query_security_feed` on its own.

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

1. `createMCPClient({ transport: { type: 'http', url: ... } })` connects to FeedMyAgent's MCP endpoint over streamable HTTP.
2. `client.tools()` converts FeedMyAgent's `query_security_feed`, `get_latest`, and `report_incident` MCP tools into AI SDK tools automatically -- no per-tool schema code.
3. `generateText` runs the model with those tools and `stopWhen: stepCountIs(5)` so it can call a tool, read the result, and keep going for a few steps before answering.
4. Prints the 5-bullet briefing to stdout, then closes the MCP client.

## Notes

- This uses `createMCPClient` from `@ai-sdk/mcp` (current AI SDK v5+ API, in its own package as of the `ai@5`/`@ai-sdk/mcp` split). The `@ai-sdk/mcp` package still exports the older name `experimental_createMCPClient` as an alias, so either import works.
- Reads (`get_latest`, `query_security_feed`) need no FeedMyAgent API key. `report_incident` does, but this example never calls it.
- `stepCountIs` is exported from `ai`; swap it for a different `StopCondition` if you want a longer or shorter tool loop.
- See the [FeedMyAgent MCP docs](https://api.feedmyagent.com/llms.txt) for the full tool list and schemas.
