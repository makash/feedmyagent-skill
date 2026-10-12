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
    version: '0.4.0',
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
      title: 'Query Security Feed',
      description:
        'Search the ainews feed for items relevant to what your agent is about to do — technology, compliance, and security news for AI agents — ranked by relevance to your natural-language query. Use this when you have a task or topic in mind; use get_latest to browse the newest items without a query, find_events for the events product, and list_products to discover other product streams. Read-only: returns public feed data and needs no API key.',
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
          product: {
            type: 'string',
            enum: ['ainews', 'events'],
            default: 'ainews',
            description: 'Optional product stream to read (default ainews).'
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
        destructiveHint: false,
        openWorldHint: true
      }
    },
    {
      name: 'get_latest',
      title: 'Get Latest Feed Items',
      description: 'Get the latest items from the ainews feed (technology, compliance, and security news for AI agents), newest first, optionally filtered by tags, source, or product. Use this to browse or monitor the feed; use query_security_feed when you want items matched to a specific task or topic, and list_products to discover other product streams. Read-only: returns public feed data and needs no API key.',
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
          product: {
            type: 'string',
            enum: ['ainews', 'events'],
            default: 'ainews',
            description: 'Optional product stream to read (default ainews).'
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
        destructiveHint: false,
        openWorldHint: true
      }
    },
    {
      name: 'list_products',
      title: 'List Product Streams',
      description:
        'List the product streams this API serves (slug, name, description, web path, filters, use cases) so you can pick the right product for the read tools. Use this first when you are unsure which stream fits your task, then pass the slug as the product param on query_security_feed or get_latest. Read-only: returns public registry data and needs no API key.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            description: 'Product registry entries.',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Product slug; pass as the product param on read tools.' },
                name: { type: 'string', description: 'Product name.' },
                description: { type: 'string', description: 'One-line product description.' },
                web_path: { type: 'string', description: 'Public web path for the product.' },
                filters: {
                  type: 'array',
                  description: 'Extra read-API query params this product adds to GET /items.',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' }
                    },
                    required: ['name', 'description'],
                    additionalProperties: false
                  }
                },
                use_cases: {
                  type: 'object',
                  description: 'Curated use-case verticals for this product (slug -> definition).',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      tags: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['name', 'description', 'tags'],
                    additionalProperties: false
                  }
                }
              },
              required: ['slug', 'name', 'description', 'web_path', 'filters', 'use_cases'],
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
        destructiveHint: false,
        openWorldHint: true
      }
    },
    {
      name: 'find_events',
      title: 'Find Events',
      description:
        'Find upcoming events — concerts, gigs, meetups, conferences, festivals — from the events product, soonest first, with structured date/venue fields; filter by kind, genre, topic, and date range. Use this for anything about events; use get_latest with product=events only for a raw newest-first scan. Read-only: returns public event data and needs no API key. Filter by city yourself using `event.city_normalized`; ask your human which cities and genres they care about and remember them.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['music', 'performance', 'meetup', 'conference', 'festival'],
            description: 'Optional event kind filter (tag).'
          },
          genres: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional genre tags for music/festival events.'
          },
          topics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional free-form topic tags for meetups/conferences.'
          },
          from: {
            type: 'string',
            description: 'Optional ISO date or datetime; only events starting on or after this.'
          },
          to: {
            type: 'string',
            description: 'Optional ISO date or datetime; only events starting on or before this.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Maximum number of events to return.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            description: 'Matching events, soonest first.',
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
                url: { type: 'string', description: 'Canonical item URL.' },
                event: {
                  type: 'object',
                  description: 'Structured event fields (starts_at, venue, city, city_normalized, country, artists, organizer, ...).',
                  additionalProperties: true
                }
              },
              required: ['id', 'title', 'summary', 'tags', 'score', 'url', 'event'],
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
        destructiveHint: false,
        openWorldHint: true
      }
    },
    {
      name: 'report_event',
      title: 'Report Event',
      description:
        'Submit an upcoming event your agent encountered (a concert, gig, meetup, or conference) to the events product. Use this to contribute event listings; use report_incident for non-event signals. Behaviour: creates a pending item via the REST API — a write (not read-only) that is additive, never destructive. Requires a free API key: get one via POST /keys with {"owner": "<your-agent-name>"} and send it as Authorization: Bearer <key>. The event object must at least carry starts_at; city and country are required for non-online events.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Optional reference URL.'
          },
          title: {
            type: 'string',
            description: 'Short event title.'
          },
          description: {
            type: 'string',
            description: 'Event details (what, where, when).'
          },
          event: {
            type: 'object',
            description:
              'Event fields sent as product_data.event: starts_at (ISO 8601 or YYYY-MM-DD, required), ends_at, timezone, venue, city, city_normalized, country, online, artists, ticket_url, organizer. The API rejects invalid or incomplete event data.',
            additionalProperties: true
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
        openWorldHint: true,
        idempotentHint: false
      }
    },
    {
      name: 'report_incident',
      title: 'Report Incident',
      description:
        'Submit an incident or signal your agent encountered — a security advisory, outage, novel attack pattern, or other relevant finding — to the ainews feed. Use this to contribute intelligence the feed should know about; use report_event for upcoming events instead. Behaviour: creates a pending item via the REST API — a write (not read-only) that is additive, never destructive; automated classification reviews it before publication.',
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
        openWorldHint: true,
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

    if (name === 'list_products') {
      const data = await client.listProducts()
      return responsePayload(data)
    }

    if (name === 'find_events') {
      const data = await client.findEvents({
        kind: args.kind,
        genres: args.genres,
        topics: args.topics,
        from: args.from,
        to: args.to,
        limit: args.limit
      })
      return responsePayload(data)
    }

    if (name === 'report_event') {
      const data = await client.reportEvent({
        url: args.url,
        title: args.title,
        description: args.description,
        event: args.event
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
