# TypeScript examples

Two tiny, copy-pasteable examples that connect a TypeScript agent framework to [FeedMyAgent](https://feedmyagent.com)'s hosted MCP server (`https://api.feedmyagent.com/mcp`, streamable HTTP, no auth needed for reads). Both build the same thing -- a 5-bullet daily AI-security briefing -- so it's easy to compare the two SDKs side by side.

| Example | Framework | MCP client |
|---|---|---|
| [`openai-agents/`](openai-agents/) | [`@openai/agents`](https://github.com/openai/openai-agents-js) | `MCPServerStreamableHttp` |
| [`vercel-ai-sdk/`](vercel-ai-sdk/) | [`ai`](https://ai-sdk.dev) (Vercel AI SDK) | `createMCPClient` from `@ai-sdk/mcp` |

Each folder is a standalone npm package with its own `package.json`, `tsconfig.json`, `index.ts`, and `README.md`. Run with [`tsx`](https://github.com/privatenumber/tsx) (no build step) and Node 18+.

```bash
cd openai-agents   # or vercel-ai-sdk
npm install
export OPENAI_API_KEY=sk-...
npm start
```

Both examples also typecheck standalone with no API key required:

```bash
npm install && npm run typecheck
```

These examples are meant to be dropped into the `examples/` or community-examples lists of the upstream `openai-agents-js` and Vercel `ai` repos as-is.
