import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ClaudeAgentApi implements ICredentialType {
	name = 'claudeAgentApi';

	displayName = 'Claude Agent API';

	documentationUrl = 'https://docs.anthropic.com/en/api/getting-started';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Anthropic API key',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials?.apiKey}}',
				'anthropic-version': '2023-06-01',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anthropic.com',
			url: '/v1/messages',
			method: 'POST',
			body: {
				model: 'claude-3-5-haiku-20241022',
				max_tokens: 10,
				messages: [{ role: 'user', content: 'Hi' }],
			},
		},
	};
}
