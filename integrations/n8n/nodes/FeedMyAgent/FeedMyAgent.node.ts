import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	FEED_MY_AGENT_USE_CASES,
	buildIncidentUrl,
	feedMyAgentApiRequest,
	feedMyAgentGetItems,
	parseTagsList,
	rankBySearch,
} from '../GenericFunctions';

export class FeedMyAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FeedMyAgent',
		name: 'feedMyAgent',
		icon: { light: 'file:feedmyagent.svg', dark: 'file:feedmyagent.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Read and contribute to FeedMyAgent, the technology intelligence feed for AI agents',
		defaults: {
			name: 'FeedMyAgent',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'feedMyAgentApi',
				// Reads (Get Latest, Search) are anonymous; only Report Incident
				// needs a key, enforced by the API itself, not by n8n.
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Item', value: 'item' }],
				default: 'item',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['item'],
					},
				},
				options: [
					{
						name: 'Get Latest',
						value: 'getLatest',
						description: 'Fetch the most recent feed items',
						action: 'Get latest feed items',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search feed items, ranked by relevance to a query',
						action: 'Search feed items',
					},
					{
						name: 'Report Incident',
						value: 'reportIncident',
						description: 'Submit an incident or signal encountered by an agent',
						action: 'Report an incident',
					},
				],
				default: 'getLatest',
			},

			// ---------------------- Get Latest ----------------------
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'prompt-injection, tool-abuse',
				description: 'Comma-separated tag filters. An item must carry all of the given tags.',
				displayOptions: {
					show: {
						operation: ['getLatest'],
					},
				},
			},
			{
				displayName: 'Use Case',
				name: 'useCase',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					...FEED_MY_AGENT_USE_CASES.map((useCase) => ({
						name: useCase.charAt(0).toUpperCase() + useCase.slice(1),
						value: useCase,
					})),
				],
				description: 'Restrict to one of the curated use-case verticals',
				displayOptions: {
					show: {
						operation: ['getLatest'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: {
						operation: ['getLatest'],
					},
				},
			},

			// ------------------------ Search ------------------------
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				description: 'Natural-language description of what to search for',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'prompt-injection, tool-abuse',
				description:
					'Comma-separated tag filters applied before ranking. An item must carry all of the given tags.',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},

			// -------------------- Report Incident --------------------
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				description: 'Short incident title',
				displayOptions: {
					show: {
						operation: ['reportIncident'],
					},
				},
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				description: 'Incident details',
				displayOptions: {
					show: {
						operation: ['reportIncident'],
					},
				},
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				description:
					'Optional reference URL. When left empty, a placeholder incident URL is generated.',
				displayOptions: {
					show: {
						operation: ['reportIncident'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource !== 'item') {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
						itemIndex: i,
					});
				}

				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'getLatest') {
					const tags = parseTagsList(this.getNodeParameter('tags', i, '') as string);
					const useCase = this.getNodeParameter('useCase', i, '') as string;
					const limit = this.getNodeParameter('limit', i, 10) as number;

					const qs: IDataObject = { sort: 'date', limit };
					if (tags.length > 0) {
						qs.tags = tags;
					}
					if (useCase.length > 0) {
						qs.use_case = useCase;
					}

					const fetched = await feedMyAgentGetItems.call(this, qs);
					for (const item of fetched.slice(0, limit)) {
						returnData.push({
							json: item as unknown as IDataObject,
							pairedItem: { item: i },
						});
					}
				} else if (operation === 'search') {
					const query = this.getNodeParameter('query', i) as string;
					const tags = parseTagsList(this.getNodeParameter('tags', i, '') as string);
					const limit = this.getNodeParameter('limit', i, 5) as number;

					// Same candidate-pool sizing as query_security_feed
					// (src/mcp-tools.ts): fetch a wider, score-sorted pool, then
					// re-rank client-side by query relevance.
					const candidateLimit = Math.max(20, Math.min(100, limit * 5));
					const qs: IDataObject = { sort: 'score', limit: candidateLimit };
					if (tags.length > 0) {
						qs.tags = tags;
					}

					const fetched = await feedMyAgentGetItems.call(this, qs);
					const ranked = rankBySearch(fetched, query).slice(0, limit);
					for (const item of ranked) {
						returnData.push({
							json: item as unknown as IDataObject,
							pairedItem: { item: i },
						});
					}
				} else if (operation === 'reportIncident') {
					const title = this.getNodeParameter('title', i) as string;
					const description = this.getNodeParameter('description', i) as string;
					const providedUrl = this.getNodeParameter('url', i, '') as string;

					const incidentUrl = buildIncidentUrl(this.getNode(), providedUrl);
					const response = await feedMyAgentApiRequest.call(this, 'POST', '/items', {}, {
						url: incidentUrl,
						title,
						raw_content: description,
					});

					const created = (response.data ?? {}) as IDataObject;
					returnData.push({ json: created, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
