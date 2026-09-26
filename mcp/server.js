#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSecApiError, AgentSecMcpClient } from './client.js'

const apiBaseUrl =
  process.env.FEEDMYAGENT_API_BASE_URL ?? process.env.AGENTSEC_API_BASE_URL ?? 'https://api.feedmyagent.com'
if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim().length === 0) {
  throw new Error('FEEDMYAGENT_API_BASE_URL is required')
}

// Without a key the server still works (reads are anonymous), but a key lets
// report_incident work out of the box and lets the feed count this install as
// one agent. Provision one silently on first run and reuse it from disk after.
// Where this install came from (e.g. FEEDMYAGENT_REF=glama in a directory's
// install snippet), so the self-provisioned key records its channel. The API
// sanitizes ref to [a-z0-9-] and drops anything else.
function installRef() {
  const raw = (process.env.FEEDMYAGENT_REF ?? '').trim().toLowerCase()
  return /^[a-z0-9-]{1,48}$/.test(raw) ? `mcp-${raw}` : 'mcp'
}

async function loadOrProvisionKey(baseUrl) {
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'feedmyagent')
  const file = join(dir, 'credentials.json')
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    if (typeof saved?.key === 'string' && saved.key.length > 0) {
      return saved.key
    }
  } catch {
    // No saved credentials; fall through to provisioning.
  }
  try {
    const response = await fetch(`${baseUrl}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'feedmyagent-mcp-auto', ref: installRef() })
    })
    if (!response.ok) {
      return null
    }
    const body = await response.json()
    const key = body?.data?.key
    if (typeof key !== 'string' || key.length === 0) {
      return null
    }
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify({ key, created_at: new Date().toISOString() }) + '\n', { mode: 0o600 })
    return key
  } catch {
    return null
  }
}

const configuredKey = process.env.FEEDMYAGENT_API_KEY ?? process.env.AGENTSEC_API_KEY

const client = new AgentSecMcpClient({
  baseUrl: apiBaseUrl,
  apiKey: configuredKey
})

// Provision lazily, on the first tool call rather than at startup: package
// scanners and registry probes that only start the server (or list tools)
// must not mint keys, or they inflate the adoption count.
let keyPromise = null
async function ensureApiKey() {
  if (client.apiKey) return
  keyPromise ??= loadOrProvisionKey(apiBaseUrl)
  const key = await keyPromise
  if (typeof key === 'string' && key.length > 0) client.apiKey = key
}

// title/description/websiteUrl/icons mirror the Worker's initialize serverInfo
// (src/index.ts MCP_SERVER_INFO): MCP Implementation metadata fields, ignored
// by clients that predate them.
const server = new Server(
  {
    name: 'feedmyagent-mcp',
    title: 'FeedMyAgent',
    version: '0.1.4',
    description: 'Technology intelligence feed for AI agents: tech stack, compliance, security.',
    websiteUrl: 'https://feedmyagent.com',
    icons: [{ src: 'https://feedmyagent.com/icon.svg', mimeType: 'image/svg+xml' }]
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query_security_feed',
      description:
        'Query feed items relevant to a natural-language context — technology, compliance, and security news for AI agents — with optional tag filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description of what the agent is doing.'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tag filters applied to feed search.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 5,
            description: 'Maximum number of items to return.'
          }
        },
        required: ['query'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            description: 'Matching feed items.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Item id.' },
                title: { type: 'string', description: 'Item title.' },
                summary: {
                  type: ['string', 'null'],
                  description: 'Short summary, or null when the item has not been enriched yet.'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Classifier tags.'
                },
                score: { type: 'number', description: 'Community ranking score.' },
                url: { type: 'string', description: 'Canonical item URL.' }
              },
              required: ['id', 'title', 'summary', 'tags', 'score', 'url'],
              additionalProperties: false
            }
          },
          source: {
            type: 'object',
            description: 'Provenance of the payload.',
            properties: {
              name: { type: 'string', description: 'Feed name.' },
              url: { type: 'string', description: 'Feed homepage URL.' }
            },
            required: ['name', 'url'],
            additionalProperties: false
          }
        },
        required: ['data', 'source'],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    },
    {
      name: 'get_latest',
      description: 'Get the latest feed items (technology, compliance, and security news for AI agents), optionally filtered by tags and source.',
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tag filters.'
          },
          source: {
            type: 'string',
            enum: ['reddit', 'x', 'rss', 'cve', 'hn', 'submitted'],
            description: 'Optional source filter.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10,
            description: 'Maximum number of items to return.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            description: 'Matching feed items.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Item id.' },
                title: { type: 'string', description: 'Item title.' },
                summary: {
                  type: ['string', 'null'],
                  description: 'Short summary, or null when the item has not been enriched yet.'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Classifier tags.'
                },
                score: { type: 'number', description: 'Community ranking score.' },
                url: { type: 'string', description: 'Canonical item URL.' }
              },
              required: ['id', 'title', 'summary', 'tags', 'score', 'url'],
              additionalProperties: false
            }
          },
          source: {
            type: 'object',
            description: 'Provenance of the payload.',
            properties: {
              name: { type: 'string', description: 'Feed name.' },
              url: { type: 'string', description: 'Feed homepage URL.' }
            },
            required: ['name', 'url'],
            additionalProperties: false
          }
        },
        required: ['data', 'source'],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    },
    {
      name: 'report_incident',
      description:
        'Submit an incident or signal encountered by an agent. Creates a pending submitted item via REST API.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Optional reference URL.'
          },
          title: {
            type: 'string',
            description: 'Short incident title.'
          },
          description: {
            type: 'string',
            description: 'Incident details.'
          }
        },
        required: ['title', 'description'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'The created submission.',
            properties: {
              id: { type: 'string', description: 'Created item id.' },
              status: {
                type: 'string',
                description: 'Moderation status; usually "pending" until classification publishes it.'
              },
              url: { type: 'string', description: 'Reference URL stored for the submission.' }
            },
            required: ['id', 'status', 'url'],
            additionalProperties: false
          },
          source: {
            type: 'object',
            description: 'Provenance of the payload.',
            properties: {
              name: { type: 'string', description: 'Feed name.' },
              url: { type: 'string', description: 'Feed homepage URL.' }
            },
            required: ['name', 'url'],
            additionalProperties: false
          }
        },
        required: ['data', 'source'],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = readArgs(request.params.arguments)
  await ensureApiKey()

  try {
    if (name === 'query_security_feed') {
      const data = await client.querySecurityFeed({
        query: args.query,
        tags: args.tags,
        limit: args.limit
      })
      return responsePayload(data)
    }

    if (name === 'get_latest') {
      const data = await client.getLatest({
        tags: args.tags,
        source: args.source,
        limit: args.limit
      })
      return responsePayload(data)
    }

    if (name === 'report_incident') {
      const data = await client.reportIncident({
        url: args.url,
        title: args.title,
        description: args.description
      })
      return responsePayload(data)
    }

    return errorPayload('not_found', `Unknown tool: ${name}`)
  } catch (error) {
    if (error instanceof AgentSecApiError) {
      if (error.code === 'internal') {
        return errorPayload('internal', 'Internal server error')
      }
      return errorPayload(error.code, error.message)
    }

    return errorPayload('internal', 'Internal server error')
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)

function readArgs(value) {
  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSecApiError('invalid_request', 'Tool arguments must be an object', 400)
  }

  return value
}

function responsePayload(data) {
  // structuredContent mirrors the text block so the declared outputSchemas
  // stay honest (MCP structured tool output).
  const payload = { data, source: { name: 'FeedMyAgent', url: 'https://feedmyagent.com' } }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  }
}

function errorPayload(code, message) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: {
              code,
              message
            }
          },
          null,
          2
        )
      }
    ]
  }
}
