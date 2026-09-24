# FeedMyAgent × crewAI

crewAI tools for [FeedMyAgent](https://feedmyagent.com), built on the
[`feedmyagent`](https://pypi.org/project/feedmyagent/) Python SDK
(`integrations/python` in this repo).

```
integrations/crewai/
├── crewai_tools/tools/feedmyagent_tool/   ← copy this into a crewAI-tools fork
│   ├── __init__.py
│   ├── feedmyagent_tool.py                (FeedMyAgentLatestTool, FeedMyAgentSearchTool, FeedMyAgentReportTool)
│   └── README.md
├── tests/tools/feedmyagent_tool_test.py   ← copy into tests/tools/ in the fork
├── examples/daily_security_briefing.py    ← standalone example, not copied into the fork
├── pyproject.toml                         ← LOCAL DEV ONLY, do not copy into the fork
└── README.md                              ← this file
```

The `crewai_tools/tools/feedmyagent_tool/` folder mirrors the exact layout
crewAI-tools uses for every tool (see `BUILDING_TOOLS.md` in
[crewAIInc/crewAI-tools](https://github.com/crewAIInc/crewAI-tools)), so it
can be dropped into a fork with no restructuring.

## What's here

- **`FeedMyAgentLatestTool`** — most recent items (`GET /items`, sorted by
  date; optional `tags`/`use_case` filters). Mirrors the hosted `get_latest`
  MCP tool.
- **`FeedMyAgentSearchTool`** — natural-language ranked search. Mirrors the
  hosted `query_security_feed` MCP tool's ranking (term matches → score →
  recency), via the SDK's `query()`.
- **`FeedMyAgentReportTool`** — `POST /items` to submit a new item/incident.
  Requires an API key.

Reads are anonymous. See `crewai_tools/tools/feedmyagent_tool/README.md`
for the tool-level docs (usage, response format, configuration) that ships
with the tool itself.

## Local development (this folder only — not part of the fork payload)

This folder's own `pyproject.toml` is a *dev harness* so the tool can be
tested standalone before it's copied into a real crewAI-tools checkout. It
installs a local `crewai_tools` package (containing only
`tools/feedmyagent_tool/`) plus `crewai` (for `crewai.tools.BaseTool`) and
`feedmyagent`. It is **not** meant to be copied into the fork — the fork
already has its own `crewai_tools` package and `pyproject.toml`.

```bash
python3 -m venv /tmp/fma-venv-crewai
source /tmp/fma-venv-crewai/bin/activate

# Editable install of the feedmyagent SDK this tool builds on:
pip install -e /path/to/techmeme-for-agents-skill/integrations/python

# Editable install of this dev harness + test deps:
pip install -e '.[test]'

pytest tests/ -v
```

### Live smoke test (no LLM needed)

The tests above mock the SDK. To confirm the tool actually talks to the
real FeedMyAgent API:

```bash
python3 -c "
from crewai_tools.tools.feedmyagent_tool.feedmyagent_tool import FeedMyAgentLatestTool
print(FeedMyAgentLatestTool()._run(limit=3))
"
```

### Full crew example (needs an LLM)

`examples/daily_security_briefing.py` wires the three tools into a
"security researcher" agent and task. Running the crew end-to-end needs an
LLM configured for crewAI (e.g. `OPENAI_API_KEY`); the FeedMyAgent reads
themselves need no key.

```bash
export OPENAI_API_KEY=...   # or any provider crewai.LLM supports
python examples/daily_security_briefing.py
```

## User-Agent / attribution

Requests are sent with `User-Agent: feedmyagent-crewai/0.1` so usage from this integration is attributable in FeedMyAgent's analytics.

## Publishing to a fork and opening the upstream PR

This task prepares the code; it does not publish or open a PR (no repo
push/fork credentials available here). To ship it:

```bash
# 1. Fork crewAIInc/crewAI-tools on GitHub (via the UI, or:)
gh repo fork crewAIInc/crewAI-tools --clone=true --remote=true
cd crewAI-tools

# 2. Branch
git checkout -b feat/feedmyagent-tool

# 3. Copy the tool + its tests (NOT pyproject.toml or examples/ from this folder)
cp -r /path/to/this/integrations/crewai/crewai_tools/tools/feedmyagent_tool \
      crewai_tools/tools/feedmyagent_tool
cp /path/to/this/integrations/crewai/tests/tools/feedmyagent_tool_test.py \
   tests/tools/feedmyagent_tool_test.py

# 4. Register the tool in the two package __init__.py files, matching every
#    other tool (see e.g. the SerperDevTool lines in each file):
#    crewai_tools/tools/__init__.py:
#        from crewai_tools.tools.feedmyagent_tool.feedmyagent_tool import (
#            FeedMyAgentLatestTool,
#            FeedMyAgentReportTool,
#            FeedMyAgentSearchTool,
#        )
#      ...and add "FeedMyAgentLatestTool", "FeedMyAgentReportTool",
#      "FeedMyAgentSearchTool" to that file's __all__.
#    crewai_tools/__init__.py: same two edits (top-level re-export).

# 5. Add feedmyagent as an optional extra in pyproject.toml, next to the
#    other integrations under [project.optional-dependencies]:
#        feedmyagent = [
#            "feedmyagent>=0.1.0",
#        ]

# 6. Install and run the full suite from the fork root:
uv sync --all-extras
uv run pytest tests/tools/feedmyagent_tool_test.py -v
pre-commit run -a

# 7. Commit, push, and open the PR
git add crewai_tools/tools/feedmyagent_tool tests/tools/feedmyagent_tool_test.py \
        crewai_tools/tools/__init__.py crewai_tools/__init__.py pyproject.toml
git commit -m "Add FeedMyAgent tools (latest, search, report)"
git push -u origin feat/feedmyagent-tool
gh pr create --repo crewAIInc/crewAI-tools \
  --title "Add FeedMyAgent tools (latest, search, report)" \
  --body "Adds FeedMyAgentLatestTool, FeedMyAgentSearchTool, and FeedMyAgentReportTool, wrapping the feedmyagent Python SDK (https://pypi.org/project/feedmyagent/). Reads are anonymous; reporting needs a free API key. See crewai_tools/tools/feedmyagent_tool/README.md for usage."
```

The upstream repo's own checklist (`BUILDING_TOOLS.md`, "PR checklist")
covers everything above; this folder satisfies all of it except the two
`__init__.py` registrations and the `pyproject.toml` extra, which can only
be done inside an actual checkout of the fork (step 4–5).
