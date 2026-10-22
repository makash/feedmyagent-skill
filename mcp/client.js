const SOURCE_VALUES = new Set(['reddit', 'x', 'rss', 'cve', 'hn', 'submitted'])
const PRODUCT_VALUES = new Set(['ainews', 'events'])
const EVENT_KIND_VALUES = new Set(['music', 'performance', 'meetup', 'conference', 'festival'])

export class AgentSecApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'AgentSecApiError'
    this.code = code
    this.status = status
  }
}

export class AgentSecMcpClient {
  constructor(options) {
    const baseUrl = options?.baseUrl
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      throw new Error('baseUrl is required')
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = typeof options?.apiKey === 'string' && options.apiKey.trim().length > 0 ? options.apiKey : null
    this.fetchImpl = options?.fetchImpl ?? fetch
    this.incidentIdFactory = options?.incidentIdFactory ?? defaultIncidentIdFactory
  }

  async getLatest(options = {}) {
    const limit = clampLimit(options.limit ?? 10)
    const source = parseOptionalSource(options.source)
    const product = parseOptionalProduct(options.product)
    const tags = parseOptionalTags(options.tags)

    const searchParams = new URLSearchParams()
    // The events product owns its sort param (starts_at|newest); date/score
    // are ainews sorts. Default ainews requests keep the historic values.
    searchParams.set('sort', product === 'events' ? 'newest' : 'date')
    searchParams.set('limit', String(limit))
    if (product !== null) {
      searchParams.set('product', product)
    }
    if (source !== null) {
      searchParams.set('source', source)
    }
    for (const tag of tags) {
      searchParams.append('tags', tag)
    }
    const section = parseOptionalSection(options.section)
    if (section !== null) {
      searchParams.set('section', section)
    }

    const items = await this.#requestItems(searchParams, false)
    return items.slice(0, limit).map((item) => toToolItem(item))
  }

  async querySecurityFeed(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new AgentSecApiError('invalid_request', 'query options must be an object', 400)
    }

    const query = parseRequiredString(options.query, 'query')
    const limit = clampLimit(options.limit ?? 5)
    const product = parseOptionalProduct(options.product)
    const tags = parseOptionalTags(options.tags)

    const candidateLimit = Math.max(20, Math.min(100, limit * 5))
    const searchParams = new URLSearchParams()
    // See getLatest: events owns its sort param, so use newest there.
    searchParams.set('sort', product === 'events' ? 'newest' : 'score')
    searchParams.set('limit', String(candidateLimit))
    if (product !== null) {
      searchParams.set('product', product)
    }
    for (const tag of tags) {
      searchParams.append('tags', tag)
    }
    const section = parseOptionalSection(options.section)
    if (section !== null) {
      searchParams.set('section', section)
    }

    const items = await this.#requestItems(searchParams, false)
    const queryTerms = tokenize(query)

    const scored = items
      .map((item) => ({ item, relevance: scoreQueryMatch(item, queryTerms) }))
      .sort((left, right) => {
        if (right.relevance !== left.relevance) {
          return right.relevance - left.relevance
        }

        if (right.item.score !== left.item.score) {
          return right.item.score - left.item.score
        }

        if (right.item.ingested_at !== left.item.ingested_at) {
          return right.item.ingested_at.localeCompare(left.item.ingested_at)
        }

        return right.item.id.localeCompare(left.item.id)
      })

    const withMatches = scored.filter((entry) => entry.relevance > 0)
    const selected = (withMatches.length > 0 ? withMatches : scored).slice(0, limit)
    return selected.map((entry) => toToolItem(entry.item))
  }

  async reportIncident(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new AgentSecApiError('invalid_request', 'incident payload must be an object', 400)
    }

    this.#requireApiKey()

    const title = parseRequiredString(options.title, 'title')
    const description = parseRequiredString(options.description, 'description')
    const incidentUrl = buildIncidentUrl(this.baseUrl, options.url, this.incidentIdFactory)

    const created = await this.#requestJson('/items', {
      method: 'POST',
      requiresApiKey: true,
      body: {
        url: incidentUrl,
        title,
        raw_content: description
      }
    })

    return {
      id: created.id,
      status: created.status,
      url: created.url
    }
  }

  async requestCoverage(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new AgentSecApiError('invalid_request', 'coverage request payload must be an object', 400)
    }

    this.#requireApiKey()

    const body = {
      kind: parseRequiredString(options.kind, 'kind'),
      title: parseRequiredString(options.title, 'title')
    }
    for (const field of ['url', 'reason', 'product']) {
      if (options[field] !== undefined && options[field] !== null) {
        body[field] = options[field]
      }
    }

    const created = await this.#requestJson('/coverage-requests', {
      method: 'POST',
      requiresApiKey: true,
      body
    })

    return {
      id: created.id,
      status: created.status,
      votes: created.votes,
      duplicate: created.duplicate === true
    }
  }

  async findEvents(options = {}) {
    const limit = clampLimit(options.limit ?? 50)
    const kind = parseOptionalEventKind(options.kind)
    const genres = parseOptionalTags(options.genres, 'genres')
    const topics = parseOptionalTags(options.topics, 'topics')
    const from = parseOptionalStringParam(options.from, 'from')
    const to = parseOptionalStringParam(options.to, 'to')

    const searchParams = new URLSearchParams()
    searchParams.set('product', 'events')
    searchParams.set('sort', 'starts_at')
    searchParams.set('limit', String(limit))
    if (kind !== null) {
      searchParams.append('tags', kind)
    }
    for (const genre of genres) {
      searchParams.append('tags', genre)
    }
    for (const topic of topics) {
      searchParams.append('tags', topic)
    }
    if (from !== null) {
      searchParams.set('from', from)
    }
    if (to !== null) {
      searchParams.set('to', to)
    }

    const items = await this.#requestItems(searchParams, false)
    return items.slice(0, limit).map((item) => toEventToolItem(item))
  }

  async reportEvent(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new AgentSecApiError('invalid_request', 'event payload must be an object', 400)
    }

    this.#requireApiKey()

    const title = parseRequiredString(options.title, 'title')
    const description = parseRequiredString(options.description, 'description')
    const event = parseOptionalEvent(options.event)
    const eventUrl = buildIncidentUrl(this.baseUrl, options.url, this.incidentIdFactory)

    const created = await this.#requestJson('/items', {
      method: 'POST',
      requiresApiKey: true,
      body: {
        url: eventUrl,
        title,
        raw_content: description,
        product: 'events',
        product_data: event === null ? {} : { event }
      }
    })

    return {
      id: created.id,
      status: created.status,
      url: created.url
    }
  }

  async listProducts() {
    const data = await this.#requestJson('/products', { method: 'GET', requiresApiKey: false })
    if (!Array.isArray(data)) {
      throw new AgentSecApiError('internal', 'REST API returned an invalid products payload', 500)
    }
    return data
  }

  async #requestItems(searchParams, requiresApiKey) {
    const data = await this.#requestJson(`/items?${searchParams.toString()}`, {
      method: 'GET',
      requiresApiKey
    })

    if (!Array.isArray(data)) {
      throw new AgentSecApiError('internal', 'REST API returned an invalid items payload', 500)
    }

    return data
  }

  async #requestJson(path, options) {
    const headers = {
      accept: 'application/json'
    }

    if (options.requiresApiKey) {
      this.#requireApiKey()
      headers.authorization = `Bearer ${this.apiKey}`
    }

    let body
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body
      })
    } catch {
      throw new AgentSecApiError('internal', 'REST API request failed', 500)
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      if (
        payload !== null &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        'error' in payload &&
        payload.error !== null &&
        typeof payload.error === 'object' &&
        typeof payload.error.code === 'string' &&
        typeof payload.error.message === 'string'
      ) {
        throw new AgentSecApiError(payload.error.code, payload.error.message, response.status)
      }

      throw new AgentSecApiError('internal', `REST API request failed with status ${response.status}`, response.status)
    }

    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !('data' in payload)
    ) {
      throw new AgentSecApiError('internal', 'REST API returned an invalid success envelope', 500)
    }

    return payload.data
  }

  #requireApiKey() {
    if (this.apiKey !== null) {
      return
    }

    throw new AgentSecApiError(
      'unauthorized',
      'MCP server requires FEEDMYAGENT_API_KEY for this tool',
      401
    )
  }
}

function toEventToolItem(item) {
  const rawEvent =
    item.product_data !== null && typeof item.product_data === 'object' && !Array.isArray(item.product_data)
      ? item.product_data.event
      : null
  return {
    ...toToolItem(item),
    event: rawEvent !== null && typeof rawEvent === 'object' && !Array.isArray(rawEvent) ? rawEvent : {}
  }
}

function toToolItem(item) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    tags: Array.isArray(item.tags) ? item.tags : [],
    score: typeof item.score === 'number' ? item.score : 0,
    url: item.url
  }
}

function parseOptionalSource(source) {
  if (source === undefined || source === null) {
    return null
  }

  if (typeof source !== 'string') {
    throw new AgentSecApiError('invalid_request', 'source must be a string', 400)
  }

  if (!SOURCE_VALUES.has(source)) {
    throw new AgentSecApiError(
      'invalid_request',
      'source must be one of: reddit, x, rss, cve, hn, submitted',
      400
    )
  }

  return source
}

function parseOptionalSection(value) {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string' || !['news', 'research', 'all'].includes(value)) {
    throw new AgentSecApiError('invalid_request', 'section must be one of: news, research, all', 400)
  }
  return value
}

function parseOptionalProduct(product) {
  if (product === undefined || product === null) {
    return null
  }

  if (typeof product !== 'string') {
    throw new AgentSecApiError('invalid_request', 'product must be a string', 400)
  }

  if (!PRODUCT_VALUES.has(product)) {
    throw new AgentSecApiError('invalid_request', 'product must be one of: ainews, events', 400)
  }

  return product
}

function parseOptionalTags(tags, fieldName = 'tags') {
  if (tags === undefined || tags === null) {
    return []
  }

  if (!Array.isArray(tags)) {
    throw new AgentSecApiError('invalid_request', `${fieldName} must be an array of strings`, 400)
  }

  const parsed = []
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      throw new AgentSecApiError('invalid_request', `${fieldName} must be an array of strings`, 400)
    }

    const trimmed = tag.trim()
    if (trimmed.length === 0) {
      throw new AgentSecApiError('invalid_request', `${fieldName} must not contain empty values`, 400)
    }
    parsed.push(trimmed)
  }

  return parsed
}

function parseOptionalEventKind(kind) {
  if (kind === undefined || kind === null) {
    return null
  }

  if (typeof kind !== 'string') {
    throw new AgentSecApiError('invalid_request', 'kind must be a string', 400)
  }

  if (!EVENT_KIND_VALUES.has(kind)) {
    throw new AgentSecApiError(
      'invalid_request',
      'kind must be one of: music, performance, meetup, conference, festival',
      400
    )
  }

  return kind
}

function parseOptionalEvent(event) {
  if (event === undefined || event === null) {
    return null
  }

  if (typeof event !== 'object' || Array.isArray(event)) {
    throw new AgentSecApiError('invalid_request', 'event must be an object', 400)
  }

  return event
}

function parseOptionalStringParam(value, fieldName) {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentSecApiError('invalid_request', `${fieldName} must be a non-empty string`, 400)
  }

  return value.trim()
}

function parseRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new AgentSecApiError('invalid_request', `${fieldName} is required`, 400)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new AgentSecApiError('invalid_request', `${fieldName} must not be empty`, 400)
  }

  return trimmed
}

function clampLimit(limit) {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    throw new AgentSecApiError('invalid_request', 'limit must be an integer', 400)
  }

  if (limit < 1 || limit > 100) {
    throw new AgentSecApiError('invalid_request', 'limit must be between 1 and 100', 400)
  }

  return limit
}

function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1)
}

function scoreQueryMatch(item, terms) {
  if (terms.length === 0) {
    return 0
  }

  const title = readString(item.title)
  const summary = readString(item.summary)
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => readString(tag)).join(' ') : ''
  const haystack = `${title} ${summary} ${tags}`.toLowerCase()

  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1
    }
  }

  return score
}

function readString(value) {
  return typeof value === 'string' ? value : ''
}

function buildIncidentUrl(baseUrl, providedUrl, incidentIdFactory) {
  if (providedUrl !== undefined && providedUrl !== null) {
    const value = parseRequiredString(providedUrl, 'url')
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new AgentSecApiError('invalid_request', 'url must be a valid URL', 400)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new AgentSecApiError('invalid_request', 'url must use http or https', 400)
    }

    return parsed.toString()
  }

  const generatedId = incidentIdFactory()
  return new URL(`/incidents/${generatedId}`, baseUrl).toString()
}

function defaultIncidentIdFactory() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${timestamp}${random}`
}
