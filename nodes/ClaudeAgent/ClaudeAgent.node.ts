import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, HookCallbackMatcher, HookInput } from '@anthropic-ai/claude-agent-sdk';

interface CapturedData {
	todos: Array<{ content: string; status: string; activeForm: string }>;
	toolsUsed: Array<{ name: string; input: any; output: any; timestamp: string }>;
	subagents: Array<{ type: string; prompt: string; result: string }>;
}

interface NodeOptions {
	enableWebSearch?: boolean;
	enableWebFetch?: boolean;
	enableTask?: boolean;
	maxTurns?: number;
	customContext?: string;
	includeToolDetails?: boolean;
}

interface AgentExecutionResult {
	response: string;
	turns: number;
	tokensUsed: number;
	executionTime: number;
}

// Default fallback models when API is unavailable
const DEFAULT_MODEL_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Sonnet (Recommended)',
		value: 'sonnet',
		description: 'Most capable model for complex tasks',
	},
	{
		name: 'Opus',
		value: 'opus',
		description: 'Highest performance for advanced reasoning',
	},
	{
		name: 'Haiku',
		value: 'haiku',
		description: 'Fastest model for simple tasks',
	},
];

export class ClaudeAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Claude Agent',
		name: 'claudeAgent',
		icon: 'file:claude.svg',
		group: ['transform'],
		version: 1,
		description: 'AI agent powered by Claude Agent SDK that can use tools to complete tasks',
		defaults: {
			name: 'Claude Agent',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				placeholder: 'What task should the agent perform?',
				description: 'The task or question for the Claude Agent to complete',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: 'sonnet',
				description: 'The Claude model to use for the agent',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Enable Web Search',
						name: 'enableWebSearch',
						type: 'boolean',
						default: false,
						description: 'Whether to allow the agent to search the web for information',
					},
					{
						displayName: 'Enable Web Fetch',
						name: 'enableWebFetch',
						type: 'boolean',
						default: false,
						description: 'Whether to allow the agent to fetch and parse web pages',
					},
					{
						displayName: 'Enable Task Tool',
						name: 'enableTask',
						type: 'boolean',
						default: false,
						description: 'Whether to allow the agent to spawn subagents for complex tasks',
					},
					{
						displayName: 'Max Turns',
						name: 'maxTurns',
						type: 'number',
						default: 10,
						description: 'Maximum number of agent iterations (tool use cycles)',
						typeOptions: {
							minValue: 1,
							maxValue: 50,
						},
					},
					{
						displayName: 'Custom Context',
						name: 'customContext',
						type: 'string',
						typeOptions: {
							rows: 3,
						},
						default: '',
						placeholder: 'Additional instructions or context...',
						description: 'Additional context or instructions to provide to the agent',
					},
					{
						displayName: 'Include Tool Details',
						name: 'includeToolDetails',
						type: 'boolean',
						default: false,
						description: 'Whether to include detailed tool execution information in the output',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					try {
						// Create a minimal query session to fetch models
						const querySession = query({
							prompt: '', // Empty prompt, we just need the session
							options: {
								maxTurns: 0, // Don't actually execute
							},
						});


						// Fetch available models
						const models = await querySession.supportedModels();
						// Convert to N8N options format
						return models.map(model => ({
							name: model.displayName,
							value: model.value,
							description: model.description,
						}));
					} catch (error) {
						return DEFAULT_MODEL_OPTIONS;
					}
				} catch (error) {
					return DEFAULT_MODEL_OPTIONS;
				}
			},
		},
	};

	/**
	 * Build the array of allowed tools based on node options
	 */
	private static buildAllowedTools(options: NodeOptions): string[] {
		const allowedTools: string[] = [];

		// Conditionally enable tools based on configuration
		if (options.enableWebSearch) {
			allowedTools.push('WebSearch');
		}
		if (options.enableWebFetch) {
			allowedTools.push('WebFetch');
		}
		if (options.enableTask !== false) {
			allowedTools.push('Task');
		}

		// Note: File system tools (Read, Write, Edit, Glob, Grep, Bash) are intentionally excluded
		// as N8N workflows don't have access to the file system

		return allowedTools;
	}

	/**
	 * Create a hook callback for capturing tool outputs
	 */
	private static createCaptureHook(capturedData: CapturedData, options: NodeOptions) {
		return async (input_data: HookInput) => {
			console.log('Tool use:', input_data)
			if (input_data.hook_event_name === 'PostToolUse') {
				const toolName = input_data.tool_name;
				const toolInput = input_data.tool_input;
				const toolResponse = input_data.tool_response;

				// Capture tool usage
				if (options.includeToolDetails) {
					capturedData.toolsUsed.push({
						name: toolName,
						input: toolInput,
						output: toolResponse,
						timestamp: new Date().toISOString(),
					});
				}

				// Handle TodoWrite - capture todos
				if (toolName === 'TodoWrite' && typeof toolInput === 'object' && toolInput !== null && 'todos' in toolInput) {
					capturedData.todos = (toolInput as any).todos;
				}

				// Handle Task tool - capture subagent results
				if (toolName === 'Task' && typeof toolInput === 'object' && toolInput !== null && 'subagent_type' in toolInput) {
					const taskInput = toolInput as any;
					capturedData.subagents.push({
						type: taskInput.subagent_type,
						prompt: taskInput.prompt,
						result: toolResponse as string || 'Running...',
					});
				}

			}
			return {};
		};
	}

	/**
	 * Build the final prompt with optional custom context
	 */
	private static buildFinalPrompt(prompt: string, options: NodeOptions): string {
		let finalPrompt = prompt;

		// Add custom context if provided
		if (options.customContext) {
			finalPrompt = `${options.customContext}\n\n${finalPrompt}`;
		}

		return finalPrompt;
	}

	/**
	 * Map model shorthand to full model identifier
	 */
	private static getModelIdentifier(model: string): string | undefined {
		const modelMap: Record<string, string> = {
			'sonnet': 'claude-sonnet-4-5-20250929',
			'opus': 'claude-opus-4-20250514',
			'haiku': 'claude-3-5-haiku-20241022',
		};
		return modelMap[model] || model; // Return as-is if already a full identifier
	}

	/**
	 * Build the agent options configuration
	 */
	private static buildAgentOptions(
		allowedTools: string[],
		model: string,
		options: NodeOptions,
		captureHook: (input_data: HookInput) => Promise<{}>
	): Options {
		const agentOptions: Options = {
			allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
			model: ClaudeAgent.getModelIdentifier(model),
			maxTurns: options.maxTurns || 10,
			hooks: {
				PostToolUse: [
					{
						hooks: [captureHook],
					} as HookCallbackMatcher,
				],
			},
		};

		return agentOptions;
	}

	/**
	 * Process agent message stream and extract response data
	 */
	private static async processAgentMessages(
		finalPrompt: string,
		agentOptions: Options
	): Promise<AgentExecutionResult> {
		let agentResponse = '';
		let turns = 0;
		let tokensUsed = 0;
		const startTime = Date.now();

		// Stream agent messages
		for await (const message of query({
			prompt: finalPrompt,
			options: agentOptions,
		})) {
			// Track turns
			if ((message as any).type === 'agent_turn') {
				turns++;
			}

			// Capture final response
			if ((message as any).type === 'text' && (message as any).content) {
				for (const block of (message as any).content) {
					if (block.type === 'text') {
						agentResponse += block.text;
					}
				}
			}

			// Check for result in message
			if ((message as any).result) {
				agentResponse = (message as any).result;
			}

			// Track token usage if available
			if ((message as any).usage) {
				tokensUsed = (message as any).usage.total_tokens || 0;
			}
		}

		const executionTime = Date.now() - startTime;

		return {
			response: agentResponse,
			turns,
			tokensUsed,
			executionTime,
		};
	}

	/**
	 * Build the output item with agent results and captured data
	 */
	private static buildOutputItem(
		inputItem: INodeExecutionData,
		executionResult: AgentExecutionResult,
		capturedData: CapturedData,
		model: string,
		options: NodeOptions,
		itemIndex: number
	): INodeExecutionData {
		return {
			json: {
				...inputItem.json,
				claudeAgent: {
					response: executionResult.response,
					model,
					turns: executionResult.turns,
					executionTime: executionResult.executionTime,
					tokensUsed: executionResult.tokensUsed,
					...(capturedData.todos.length > 0 && { todos: capturedData.todos }),
					...(capturedData.subagents.length > 0 && { subagents: capturedData.subagents }),
					...(options.includeToolDetails &&
						capturedData.toolsUsed.length > 0 && { toolsUsed: capturedData.toolsUsed }),
				},
			},
			pairedItem: itemIndex,
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Get node parameters
				const prompt = this.getNodeParameter('prompt', itemIndex) as string;
				const model = this.getNodeParameter('model', itemIndex, 'sonnet') as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as NodeOptions;

				// Prepare captured data structure
				const capturedData: CapturedData = {
					todos: [],
					toolsUsed: [],
					subagents: [],
				};

				// Build configuration
				const allowedTools = ClaudeAgent.buildAllowedTools(options);
				const captureHook = ClaudeAgent.createCaptureHook(capturedData, options);
				const finalPrompt = ClaudeAgent.buildFinalPrompt(prompt, options);
				const agentOptions = ClaudeAgent.buildAgentOptions(
					allowedTools,
					model,
					options,
					captureHook
				);

				// Execute the agent
				const executionResult = await ClaudeAgent.processAgentMessages(finalPrompt, agentOptions);

				// Build and add output item
				const outputItem = ClaudeAgent.buildOutputItem(
					items[itemIndex],
					executionResult,
					capturedData,
					model,
					options,
					itemIndex
				);

				returnData.push(outputItem);
			} catch (error) {
				// Handle errors
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							...items[itemIndex].json,
							error: error.message,
						},
						pairedItem: itemIndex,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [returnData];
	}
}
