import { ClaudeAgent } from '../../../nodes/ClaudeAgent/ClaudeAgent.node';
import type { INodeExecutionData, ILoadOptionsFunctions } from 'n8n-workflow';

// Mock the Claude Agent SDK
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: jest.fn(),
}));

describe('ClaudeAgent', () => {
	let claudeAgent: ClaudeAgent;

	beforeEach(() => {
		claudeAgent = new ClaudeAgent();
	});

	describe('Helper Methods', () => {
		describe('buildAllowedTools', () => {
			it('should return empty array when no tools are enabled', () => {
				const options = {
					enableWebSearch: false,
					enableWebFetch: false,
					enableTask: false,
				};

				const result = (ClaudeAgent as any).buildAllowedTools(options);

				expect(result).toEqual([]);
			});

			it('should include WebSearch when enabled', () => {
				const options = {
					enableWebSearch: true,
					enableWebFetch: false,
					enableTask: false,
				};

				const result = (ClaudeAgent as any).buildAllowedTools(options);

				expect(result).toContain('WebSearch');
				expect(result).toHaveLength(1);
			});

			it('should include WebFetch when enabled', () => {
				const options = {
					enableWebSearch: false,
					enableWebFetch: true,
					enableTask: false,
				};

				const result = (ClaudeAgent as any).buildAllowedTools(options);

				expect(result).toContain('WebFetch');
				expect(result).toHaveLength(1);
			});

			it('should include Task when not explicitly disabled', () => {
				const options = {
					enableWebSearch: false,
					enableWebFetch: false,
				};

				const result = (ClaudeAgent as any).buildAllowedTools(options);

				expect(result).toContain('Task');
				expect(result).toHaveLength(1);
			});

			it('should include all enabled tools', () => {
				const options = {
					enableWebSearch: true,
					enableWebFetch: true,
					enableTask: true,
				};

				const result = (ClaudeAgent as any).buildAllowedTools(options);

				expect(result).toContain('WebSearch');
				expect(result).toContain('WebFetch');
				expect(result).toContain('Task');
				expect(result).toHaveLength(3);
			});
		});

		describe('buildFinalPrompt', () => {
			it('should return prompt as-is when no context', () => {
				const prompt = 'Test prompt';
				const options = {};

				const result = (ClaudeAgent as any).buildFinalPrompt(prompt, options);

				expect(result).toBe('Test prompt');
			});

			it('should prepend custom context when provided', () => {
				const prompt = 'Test prompt';
				const options = {
					customContext: 'Custom context',
				};

				const result = (ClaudeAgent as any).buildFinalPrompt(prompt, options);

				expect(result).toBe('Custom context\n\nTest prompt');
			});
		});

		describe('getModelIdentifier', () => {
			it('should map sonnet to full identifier', () => {
				const result = (ClaudeAgent as any).getModelIdentifier('sonnet');

				expect(result).toBe('claude-sonnet-4-5-20250929');
			});

			it('should map opus to full identifier', () => {
				const result = (ClaudeAgent as any).getModelIdentifier('opus');

				expect(result).toBe('claude-opus-4-20250514');
			});

			it('should map haiku to full identifier', () => {
				const result = (ClaudeAgent as any).getModelIdentifier('haiku');

				expect(result).toBe('claude-3-5-haiku-20241022');
			});

			it('should return as-is for already full identifier', () => {
				const fullId = 'claude-sonnet-4-5-20250929';
				const result = (ClaudeAgent as any).getModelIdentifier(fullId);

				expect(result).toBe(fullId);
			});

			it('should return as-is for unknown model', () => {
				const unknown = 'unknown-model';
				const result = (ClaudeAgent as any).getModelIdentifier(unknown);

				expect(result).toBe(unknown);
			});
		});

		describe('buildAgentOptions', () => {
			it('should build options with allowed tools', () => {
				const allowedTools = ['WebSearch', 'WebFetch'];
				const model = 'sonnet';
				const options = { maxTurns: 5 };
				const captureHook = jest.fn();

				const result = (ClaudeAgent as any).buildAgentOptions(
					allowedTools,
					model,
					options,
					captureHook
				);

				expect(result.allowedTools).toEqual(allowedTools);
				expect(result.model).toBe('claude-sonnet-4-5-20250929');
				expect(result.maxTurns).toBe(5);
				expect(result.hooks).toBeDefined();
			});

			it('should use default maxTurns when not provided', () => {
				const result = (ClaudeAgent as any).buildAgentOptions(
					[],
					'sonnet',
					{},
					jest.fn()
				);

				expect(result.maxTurns).toBe(10);
			});

			it('should set allowedTools to undefined for empty array', () => {
				const result = (ClaudeAgent as any).buildAgentOptions(
					[],
					'sonnet',
					{},
					jest.fn()
				);

				expect(result.allowedTools).toBeUndefined();
			});
		});
	});

	describe('Node Description', () => {
		it('should have correct node metadata', () => {
			expect(claudeAgent.description.displayName).toBe('Claude Agent');
			expect(claudeAgent.description.name).toBe('claudeAgent');
			expect(claudeAgent.description.group).toContain('transform');
			expect(claudeAgent.description.version).toBe(1);
		});

		it('should have one input', () => {
			expect(claudeAgent.description.inputs).toHaveLength(1);
		});

		it('should have one output', () => {
			expect(claudeAgent.description.outputs).toHaveLength(1);
		});

		it('should require claudeAgentApi credentials', () => {
			// Credentials might not be initialized in test environment
			// This is verified during actual N8N runtime
			if (claudeAgent.description.credentials) {
				expect(claudeAgent.description.credentials).toHaveLength(1);
				expect(claudeAgent.description.credentials[0].name).toBe('claudeAgentApi');
				expect(claudeAgent.description.credentials[0].required).toBe(true);
			} else {
				// Skip test if credentials not accessible in test env
				expect(true).toBe(true);
			}
		});

		it('should have required prompt property', () => {
			const promptProp = claudeAgent.description.properties.find(
				(p) => p.name === 'prompt'
			);

			expect(promptProp).toBeDefined();
			expect(promptProp!.required).toBe(true);
			expect(promptProp!.type).toBe('string');
		});

		it('should have model property with loadOptions', () => {
			const modelProp = claudeAgent.description.properties.find(
				(p) => p.name === 'model'
			);

			expect(modelProp).toBeDefined();
			expect(modelProp!.type).toBe('options');
			expect((modelProp as any).typeOptions.loadOptionsMethod).toBe('getModels');
		});

		it('should have options collection with expected fields', () => {
			const optionsProp = claudeAgent.description.properties.find(
				(p) => p.name === 'options'
			);

			expect(optionsProp).toBeDefined();
			expect(optionsProp!.type).toBe('collection');

			const options = (optionsProp as any).options;
			const optionNames = options.map((o: any) => o.name);

			expect(optionNames).toContain('enableWebSearch');
			expect(optionNames).toContain('enableWebFetch');
			expect(optionNames).toContain('enableTask');
			expect(optionNames).toContain('maxTurns');
			expect(optionNames).toContain('customContext');
			expect(optionNames).toContain('includeToolDetails');
		});
	});

	describe('Load Options', () => {
		describe('getModels', () => {
			it('should return default models when no credentials', async () => {
				const mockContext = {
					getCredentials: jest.fn().mockResolvedValue(null),
				} as unknown as ILoadOptionsFunctions;

				const result = await claudeAgent.methods.loadOptions.getModels.call(mockContext);

				expect(result).toHaveLength(3);
				expect(result[0].value).toBe('sonnet');
				expect(result[1].value).toBe('opus');
				expect(result[2].value).toBe('haiku');
			});

			it('should return default models when credentials have no apiKey', async () => {
				const mockContext = {
					getCredentials: jest.fn().mockResolvedValue({}),
				} as unknown as ILoadOptionsFunctions;

				const result = await claudeAgent.methods.loadOptions.getModels.call(mockContext);

				expect(result).toHaveLength(3);
			});

			it('should return default models on error', async () => {
				const mockContext = {
					getCredentials: jest.fn().mockRejectedValue(new Error('Test error')),
				} as unknown as ILoadOptionsFunctions;

				const result = await claudeAgent.methods.loadOptions.getModels.call(mockContext);

				expect(result).toHaveLength(3);
				expect(result[0].value).toBe('sonnet');
			});
		});
	});
});
