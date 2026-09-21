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
async function loadOrProvisionKey(baseUrl) {
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'feedmyagent')
  const file = join(dir, 'credentials.json')
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    if (typeof saved?.key === 'string' && saved.key.length > 0) {
      return saved.key
    }
  } catch {}
  try {
    const response = await fetch(`${baseUrl}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'feedmyagent-mcp-auto', ref: 'mcp' })
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

const apiKey =
  process.env.FEEDMYAGENT_API_KEY ?? process.env.AGENTSEC_API_KEY ?? (await loadOrProvisionKey(apiBaseUrl))

const client = new AgentSecMcpClient({
  baseUrl: apiBaseUrl,
  apiKey
})

const server = new Server(
  {
    name: 'feedmyagent-mcp',
    version: '0.1.2'
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
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = readArgs(request.params.arguments)

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
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { data, source: { name: 'FeedMyAgent', url: 'https://feedmyagent.com' } },
          null,
          2
        )
      }
    ]
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
