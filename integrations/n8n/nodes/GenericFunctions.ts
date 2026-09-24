import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Shared constants + helpers for both FeedMyAgent nodes (Item resource +
// polling trigger). Kept in one place so the two nodes stay in lockstep with
// the REST API contract (specs/rest-api.md in the main techmeme-for-agents
// repo) and with the ranking semantics of query_security_feed
// (src/mcp-tools.ts), which this integration's Search operation mirrors.

export const FEED_MY_AGENT_BASE_URL = 'https://api.feedmyagent.com';

// Distinct per integration so adoption is attributable in analytics (per the
// w2b.19 epic: each integration sets a distinct User-Agent).
export const FEED_MY_AGENT_USER_AGENT = 'feedmyagent-n8n/0.1';

export const FEED_MY_AGENT_USE_CASES = ['security', 'engineering', 'compliance'] as const;

export type FeedMyAgentUseCase = (typeof FEED_MY_AGENT_USE_CASES)[number];

export interface FeedMyAgentItem {
	id: string;
	title: string;
	summary: string | null;
	url: string;
	tags: string[];
	score: number;
}

type FeedMyAgentCallContext = IExecuteFunctions | IPollFunctions;

/**
 * Low-level request helper shared by both nodes. Reads are anonymous — no
 * credential is required. When a FeedMyAgent API credential is attached and
 * carries a non-empty apiKey, the request is sent authenticated (Bearer
 * token, via the credential's `authenticate` rule); otherwise it is sent
 * plain. Report Incident (POST /items) requires the API to be reachable with
 * a key — the API itself rejects unauthenticated writes.
 */
export async function feedMyAgentApiRequest(
	this: FeedMyAgentCallContext,
	method: IHttpRequestMethods,
	endpoint: string,
	qs: IDataObject = {},
	body?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		baseURL: FEED_MY_AGENT_BASE_URL,
		url: endpoint,
		qs,
		json: true,
		arrayFormat: 'repeat',
		headers: {
			'User-Agent': FEED_MY_AGENT_USER_AGENT,
		},
	};

	if (body !== undefined) {
		options.body = body;
	}

	const apiKey = await getApiKey.call(this);

	if (apiKey.length > 0) {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'feedMyAgentApi',
			options,
		)) as IDataObject;
	}

	return (await this.helpers.httpRequest(options)) as IDataObject;
}

async function getApiKey(this: FeedMyAgentCallContext): Promise<string> {
	const credentials = await this.getCredentials('feedMyAgentApi').catch(() => undefined);
	const apiKey = credentials?.apiKey;
	return typeof apiKey === 'string' ? apiKey.trim() : '';
}

/** GET /items -> {"data": [...]}; returns the item array (never throws on empty). */
export async function feedMyAgentGetItems(
	this: FeedMyAgentCallContext,
	qs: IDataObject,
): Promise<FeedMyAgentItem[]> {
	const response = await feedMyAgentApiRequest.call(this, 'GET', '/items', qs);
	return Array.isArray(response.data) ? (response.data as FeedMyAgentItem[]) : [];
}

/** Comma-separated free-text field -> trimmed, non-empty tag list. */
export function parseTagsList(value: string): string[] {
	return value
		.split(',')
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

// --- Search ranking (mirrors query_security_feed in src/mcp-tools.ts, with
// the occurrence-count scoring the w2b.19.5 bead specifies) -----------------

export function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length >= 2);
}

function countOccurrences(haystack: string, term: string): number {
	if (term.length === 0) {
		return 0;
	}

	let count = 0;
	let index = haystack.indexOf(term);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(term, index + term.length);
	}

	return count;
}

/** Sum of term occurrences across title + summary + tags, lowercased. */
export function scoreQueryMatch(item: FeedMyAgentItem, terms: string[]): number {
	if (terms.length === 0) {
		return 0;
	}

	const title = item.title ?? '';
	const summary = item.summary ?? '';
	const tags = Array.isArray(item.tags) ? item.tags.join(' ') : '';
	const haystack = `${title} ${summary} ${tags}`.toLowerCase();

	let score = 0;
	for (const term of terms) {
		score += countOccurrences(haystack, term);
	}

	return score;
}

/** Sort by relevance (term occurrence count) desc, then item.score desc. */
export function rankBySearch(items: FeedMyAgentItem[], query: string): FeedMyAgentItem[] {
	const terms = tokenizeQuery(query);

	return items
		.map((item) => ({ item, relevance: scoreQueryMatch(item, terms) }))
		.sort((left, right) => {
			if (right.relevance !== left.relevance) {
				return right.relevance - left.relevance;
			}

			return (right.item.score ?? 0) - (left.item.score ?? 0);
		})
		.map((entry) => entry.item);
}

// --- Report Incident ---------------------------------------------------

export function generateIncidentId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `${timestamp}${random}`;
}

function tryParseUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

/** Validates a provided reference URL, or synthesizes one under /incidents/<id>. */
export function buildIncidentUrl(node: INode, providedUrl: string): string {
	const trimmed = providedUrl.trim();

	if (trimmed.length === 0) {
		return new URL(`/incidents/${generateIncidentId()}`, FEED_MY_AGENT_BASE_URL).toString();
	}

	const parsed = tryParseUrl(trimmed);
	if (parsed === null) {
		throw new NodeOperationError(node, 'url must be a valid URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new NodeOperationError(node, 'url must use http or https');
	}

	return parsed.toString();
}
