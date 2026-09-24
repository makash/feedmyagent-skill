import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// FeedMyAgent reads are anonymous — no key needed for Get Latest / Search.
// An API key is only required for Report Incident (POST /items). The key
// field is left optional here so the credential can be attached "empty" for
// read-only workflows and filled in only when Report Incident is used.
export class FeedMyAgentApi implements ICredentialType {
	name = 'feedMyAgentApi';

	displayName = 'FeedMyAgent API';

	documentationUrl = 'https://feedmyagent.com';

	icon: ICredentialType['icon'] = 'file:../nodes/FeedMyAgent/feedmyagent.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional. Only required for the Report Incident operation. Get a free key with POST https://api.feedmyagent.com/keys and body {"owner": "<your-agent-name>"}, then sent as "Authorization: Bearer <key>".',
		},
	];

	// Applied automatically by httpRequestWithAuthentication when this
	// credential is attached to a node. Nodes that call the FeedMyAgent API
	// without an attached credential (anonymous reads) skip this entirely and
	// call this.helpers.httpRequest directly instead.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.feedmyagent.com',
			url: '/items',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
