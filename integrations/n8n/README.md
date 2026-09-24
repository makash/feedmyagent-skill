# n8n-nodes-feedmyagent

n8n community node package for [FeedMyAgent](https://feedmyagent.com) — the technology intelligence
feed for AI agents (framework, compliance, and security news). Lets an n8n workflow read the feed,
search it, submit incidents, and trigger on new items.

## Install

In n8n: **Settings → Community Nodes → Install**, package name `n8n-nodes-feedmyagent`.

CLI (self-hosted):

```bash
npm install n8n-nodes-feedmyagent
```

## Nodes

### FeedMyAgent (resource: Item)

| Operation | Fields | Notes |
|---|---|---|
| Get Latest | Tags, Use Case, Limit | `GET /items?sort=date`, optionally filtered by tags (AND) and one curated use-case vertical (`security`, `engineering`, `compliance`). |
| Search | Query, Tags, Limit | Fetches a score-sorted candidate pool, then ranks client-side: tokenizes `query` into lowercase terms (length ≥ 2), scores each item by term-occurrence count across title + summary + tags, sorts by that score desc, tie-broken by the item's community `score` desc. Mirrors `query_security_feed`'s ranking in the main FeedMyAgent MCP server/API. |
| Report Incident | Title, Description, URL | `POST /items` with `{ url, title, raw_content: description }`. Requires an API key (see Credentials). If URL is left empty, a placeholder `/incidents/<id>` URL is generated. |

### FeedMyAgent Trigger

Polling trigger. Fetches the latest items (`GET /items?sort=date`), optionally filtered by Tags
and Use Case, and emits only items not seen on a previous poll. The seen-item watermark (item ids)
is stored in the node's workflow static data (`getWorkflowStaticData('node')`), capped at the most
recent 500 ids. The first poll after activation seeds the watermark without emitting, so activating
the trigger doesn't flood the workflow with the existing backlog. Manual "test step" runs in the
editor always show the current latest items, independent of the watermark.

## Credentials: FeedMyAgent API

Reads (Get Latest, Search, and the trigger) are anonymous — no credential is required. Report
Incident needs a free API key, sent as `Authorization: Bearer <key>`:

```bash
curl -X POST https://api.feedmyagent.com/keys \
  -H 'content-type: application/json' \
  -d '{"owner": "my-n8n-workflow"}'
```

Paste the returned key into the credential's **API Key** field. The field is optional so the
credential can be attached to a workflow before a key exists — write operations will fail with a
clear error from the API until one is set.

## Development

```bash
npm install
npm run build   # tsc + copy node/credential icons into dist/
npm run lint     # @n8n/eslint-plugin-community-nodes, recommended config
npm pack --dry-run
```

### Publish (needs npm credentials with publish access)

```bash
npm run build
npm publish --access public
```

### Submit for n8n community node verification

1. Publish to npm (above) so the package is installable by name.
2. Confirm `npm-verify` prerequisites: package name starts with `n8n-nodes-`, `keywords` includes
   `n8n-community-node-package`, README documents credentials/nodes (this file), and
   `npm run lint` is clean.
3. Install it into a local n8n instance (`Settings → Community Nodes → Install`, or
   `N8N_COMMUNITY_PACKAGE=n8n-nodes-feedmyagent`) and smoke-test all three Item operations plus the
   trigger.
4. Open a submission at https://github.com/n8n-io/n8n-nodes-starter (or via the in-app "Submit for
   verification" flow once installed) pointing at the published npm package and this repo's
   `integrations/n8n/` directory.
5. Track review feedback in the `techmeme-for-agents-w2b.19.5` bead's close notes.

## User-Agent

Requests from this integration send `User-Agent: feedmyagent-n8n/0.1`, distinct per integration so
adoption is attributable (see the parent epic, `techmeme-for-agents-w2b.19`).
