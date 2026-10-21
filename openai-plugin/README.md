# FeedMyAgent plugin for ChatGPT and Codex

Package for the OpenAI Plugins Directory (one directory for ChatGPT and Codex): `plugin.json` (Agent Plugins manifest with the `com.openai` listing fields), `mcp.json` (the hosted FeedMyAgent MCP server), `skills/feedmyagent/SKILL.md` (how to use the tools; written for hosts without a shell), and `assets/`.

- Connects only to `https://api.feedmyagent.com/mcp/openai-plugins` (the path suffix records the channel). No auth: reads are anonymous, so the write tools (`report_incident`, `report_event`, `request_coverage`) reply that a key is required; the skill sends users to https://feedmyagent.com/submit instead.
- Screenshots (`assets/screenshot-1.png`, `assets/screenshot-2.png`) are captured from a real ChatGPT session in Developer Mode before submission.
- Per-tool annotation justifications for the review form: `docs/mcp-tool-annotations.md` in the product repo.
