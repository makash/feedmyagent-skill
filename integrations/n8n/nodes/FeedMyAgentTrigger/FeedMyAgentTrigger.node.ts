import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	FEED_MY_AGENT_USE_CASES,
	feedMyAgentGetItems,
	parseTagsList,
	type FeedMyAgentItem,
} from '../GenericFunctions';

// How many of the most recent items to look at on each poll. Watermarking is
// id-based (not time-based), so this only bounds how far back a single poll
// can look for items it hasn't seen yet.
const MAX_ITEMS_PER_POLL = 50;

// How many item ids to remember between polls, so the seen-set doesn't grow
// unbounded on a long-lived, always-active workflow.
const MAX_SEEN_IDS = 500;

interface FeedMyAgentTriggerStaticData {
	seenIds?: string[];
}

export class FeedMyAgentTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FeedMyAgent Trigger',
		name: 'feedMyAgentTrigger',
		icon: { light: 'file:feedmyagent.svg', dark: 'file:feedmyagent.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'New items',
		description: 'Starts a workflow when new FeedMyAgent feed items are published',
		defaults: {
			name: 'FeedMyAgent Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'feedMyAgentApi',
				// Polling only ever reads (GET /items), which is anonymous.
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'prompt-injection, tool-abuse',
				description: 'Comma-separated tag filters. An item must carry all of the given tags.',
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
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const staticData = this.getWorkflowStaticData('node') as FeedMyAgentTriggerStaticData;
		const tags = parseTagsList(this.getNodeParameter('tags', '') as string);
		const useCase = this.getNodeParameter('useCase', '') as string;

		const qs: IDataObject = { sort: 'date', limit: MAX_ITEMS_PER_POLL };
		if (tags.length > 0) {
			qs.tags = tags;
		}
		if (useCase.length > 0) {
			qs.use_case = useCase;
		}

		// Newest first, per GET /items?sort=date.
		const fetched = await feedMyAgentGetItems.call(this, qs);

		// Manual test runs ("execute step" in the editor) always show the
		// current latest items, independent of the stored watermark, so users
		// can see real data before activating the trigger.
		if (this.getMode() === 'manual') {
			return fetched.length > 0 ? [this.helpers.returnJsonArray(toJson(fetched))] : null;
		}

		const previouslySeen = staticData.seenIds ?? [];
		const isFirstPoll = staticData.seenIds === undefined;
		const seenIds = new Set(previouslySeen);

		const newItems = fetched.filter((item) => !seenIds.has(item.id));

		// Refresh the watermark: newest fetched ids first, then whatever we
		// still remembered, deduplicated and capped.
		staticData.seenIds = Array.from(
			new Set([...fetched.map((item) => item.id), ...previouslySeen]),
		).slice(0, MAX_SEEN_IDS);

		// Seed state on the very first poll (e.g. right after activation)
		// instead of emitting the entire existing backlog as "new".
		if (isFirstPoll) {
			return null;
		}

		if (newItems.length === 0) {
			return null;
		}

		// Emit oldest-first so downstream nodes see a stable chronological order.
		const ordered = [...newItems].reverse();
		return [this.helpers.returnJsonArray(toJson(ordered))];
	}
}

function toJson(items: FeedMyAgentItem[]): IDataObject[] {
	return items as unknown as IDataObject[];
}
