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
import { betaMemoryTool, type MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory';
import type { BetaMemoryTool20250818Command } from '@anthropic-ai/sdk/resources/beta';

interface CapturedData {
	todos: Array<{ content: string; status: string; activeForm: string }>;
	toolsUsed: Array<{ name: string; input: any; output: any; timestamp: string }>;
	subagents: Array<{ type: string; prompt: string; result: string }>;
}

interface NodeOptions {
	enableWebSearch?: boolean;
	enableWebFetch?: boolean;
	enableTask?: boolean;
	enableMemory?: boolean;
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

/**
 * In-memory implementation of the Memory Tool for n8n
 * Stores memory in a JSON-serializable structure instead of filesystem
 */
export class InMemoryMemoryTool implements MemoryToolHandlers {
	private files: Map<string, string> = new Map();

	constructor(memoryState?: string) {
		if (memoryState) {
			try {
				const state = JSON.parse(memoryState);
				this.files = new Map(Object.entries(state));
				console.log(this.files)
			} catch (error) {
				// Invalid state, start fresh
			}
		}
	}

	/** Serialize the current memory state to JSON */
	serialize(): string {
		return JSON.stringify(Object.fromEntries(this.files));
	}

	/** Check if there is any memory stored */
	hasMemory(): boolean {
		return this.files.size > 0;
	}

	private validatePath(memoryPath: string): string {
		if (!memoryPath.startsWith('/memories')) {
			throw new Error(`Path must start with /memories, got: ${memoryPath}`);
		}

		// Remove /memories prefix and normalize
		const relativePath = memoryPath.slice('/memories'.length).replace(/^\//, '');
		return relativePath || '';
	}

	async view(command: Extract<BetaMemoryTool20250818Command, { command: 'view' }>): Promise<string> {
		console.log('Viewing memory')
		const path = this.validatePath(command.path);

		// Handle directory listing
		if (command.path === '/memories' || command.path === '/memories/') {
			const pathSet = new Set<string>();

			for (const filePath of this.files.keys()) {
				if (filePath === '') continue; // Skip root

				const parts = filePath.split('/');
				if (parts.length > 0) {
					pathSet.add(parts[0] + (parts.length > 1 ? '/' : ''));
				}
			}

			const sortedItems = Array.from(pathSet).sort();
			return `Directory: ${command.path}\n` + sortedItems.map(item => `- ${item}`).join('\n');
		}

		// Check if it's a directory (has children)
		const children: string[] = [];
		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(path + '/')) {
				const remaining = filePath.slice(path.length + 1);
				const nextPart = remaining.split('/')[0];
				if (nextPart && !children.includes(nextPart)) {
					children.push(nextPart);
				}
			}
		}

		if (children.length > 0) {
			// It's a directory
			return `Directory: ${command.path}\n` + children.sort().map(item => {
				const fullPath = path ? `${path}/${item}` : item;
				const hasChildren = Array.from(this.files.keys()).some(p => p.startsWith(fullPath + '/'));
				return `- ${item}${hasChildren ? '/' : ''}`;
			}).join('\n');
		}

		// It's a file
		if (!this.files.has(path)) {
			throw new Error(`Path not found: ${command.path}`);
		}

		const content = this.files.get(path)!;
		const lines = content.split('\n');

		let displayLines = lines;
		let startNum = 1;

		if (command.view_range && command.view_range.length === 2) {
			const startLine = Math.max(1, command.view_range[0]!) - 1;
			const endLine = command.view_range[1] === -1 ? lines.length : command.view_range[1];
			displayLines = lines.slice(startLine, endLine);
			startNum = startLine + 1;
		}

		const numberedLines = displayLines.map(
			(line, i) => `${String(i + startNum).padStart(4, ' ')}: ${line}`
		);

		return numberedLines.join('\n');
	}

	async create(command: Extract<BetaMemoryTool20250818Command, { command: 'create' }>): Promise<string> {
		console.log('Creating memory')
		const path = this.validatePath(command.path);
		this.files.set(path, command.file_text);
		return `File created successfully at ${command.path}`;
	}

	async str_replace(command: Extract<BetaMemoryTool20250818Command, { command: 'str_replace' }>): Promise<string> {
		const path = this.validatePath(command.path);

		if (!this.files.has(path)) {
			throw new Error(`File not found: ${command.path}`);
		}

		const content = this.files.get(path)!;
		const count = content.split(command.old_str).length - 1;

		if (count === 0) {
			throw new Error(`Text not found in ${command.path}`);
		} else if (count > 1) {
			throw new Error(`Text appears ${count} times in ${command.path}. Must be unique.`);
		}

		const newContent = content.replace(command.old_str, command.new_str);
		this.files.set(path, newContent);
		return `File ${command.path} has been edited`;
	}

	async insert(command: Extract<BetaMemoryTool20250818Command, { command: 'insert' }>): Promise<string> {
		const path = this.validatePath(command.path);

		if (!this.files.has(path)) {
			throw new Error(`File not found: ${command.path}`);
		}

		const content = this.files.get(path)!;
		const lines = content.split('\n');

		if (command.insert_line < 0 || command.insert_line > lines.length) {
			throw new Error(`Invalid insert_line ${command.insert_line}. Must be 0-${lines.length}`);
		}

		lines.splice(command.insert_line, 0, command.insert_text.replace(/\n$/, ''));
		this.files.set(path, lines.join('\n'));
		return `Text inserted at line ${command.insert_line} in ${command.path}`;
	}

	async delete(command: Extract<BetaMemoryTool20250818Command, { command: 'delete' }>): Promise<string> {
		const path = this.validatePath(command.path);

		if (command.path === '/memories' || command.path === '/memories/') {
			throw new Error('Cannot delete the /memories directory itself');
		}

		if (!this.files.has(path)) {
			// Check if it's a directory
			let hasChildren = false;
			for (const filePath of this.files.keys()) {
				if (filePath.startsWith(path + '/')) {
					hasChildren = true;
					this.files.delete(filePath);
				}
			}

			if (!hasChildren) {
				throw new Error(`Path not found: ${command.path}`);
			}

			return `Directory deleted: ${command.path}`;
		}

		this.files.delete(path);
		return `File deleted: ${command.path}`;
	}

	async rename(command: Extract<BetaMemoryTool20250818Command, { command: 'rename' }>): Promise<string> {
		const oldPath = this.validatePath(command.old_path);
		const newPath = this.validatePath(command.new_path);

		if (!this.files.has(oldPath)) {
			throw new Error(`Source path not found: ${command.old_path}`);
		}

		if (this.files.has(newPath)) {
			throw new Error(`Destination already exists: ${command.new_path}`);
		}

		const content = this.files.get(oldPath)!;
		this.files.delete(oldPath);
		this.files.set(newPath, content);
		return `Renamed ${command.old_path} to ${command.new_path}`;
	}
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
		inputs: [
			NodeConnectionTypes.Main,
			{
				displayName: 'Memory (Optional)',
				type: NodeConnectionTypes.Main,
				required: false,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		inputNames: ['Main Input', 'Memory'],
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
						displayName: 'Enable Memory',
						name: 'enableMemory',
						type: 'boolean',
						default: true,
						description: 'Whether to allow the agent to maintain memory (stored in workflow static data)',
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
	 * Parse memory string from the memory input connection
	 * Returns the memory JSON string, or undefined if no memory input
	 */
	private static parseMemoryInput(memoryItems: INodeExecutionData[]): string | undefined {
		if (memoryItems.length === 0) {
			return undefined;
		}

		// Get memory from the first item
		const item = memoryItems[0];
		const json = item.json;

		// Support multiple formats:
		// 1. Direct memory string: { memory: "..." }
		if (typeof json.memory === 'string') {
			return json.memory;
		}

		// 2. claudeAgent output format: { claudeAgent: { memory: "..." } }
		if (json.claudeAgent && typeof json.claudeAgent === 'object') {
			const agent = json.claudeAgent as any;
			if (typeof agent.memory === 'string') {
				return agent.memory;
			}
		}

		return undefined;
	}

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
		captureHook: (input_data: HookInput) => Promise<{}>,
		memoryTool?: any
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

		// Add memory tool if provided
		if (memoryTool) {
			(agentOptions as any).tools = [memoryTool];
		}

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
		memoryState: string | undefined,
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
					...(memoryState && { memory: memoryState }),
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

		// Read memory input from second connection (if provided)
		let memoryInputItems: INodeExecutionData[];
		try {
			memoryInputItems = this.getInputData(1);
		} catch (error) {
			// No memory input connected, which is fine
			memoryInputItems = [];
		}

		// Parse memory string from input
		const initialMemoryState = ClaudeAgent.parseMemoryInput(memoryInputItems);

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

				// Setup memory tool if enabled
				let memoryTool: any = undefined;
				let inMemoryTool: InMemoryMemoryTool | undefined = undefined;

				if (options.enableMemory) {
					console.log('Creating memory tool')
					// Create in-memory storage with initial state
					inMemoryTool = new InMemoryMemoryTool(initialMemoryState);
					// Create the beta memory tool
					memoryTool = betaMemoryTool(inMemoryTool);
				}

				// Build configuration
				const allowedTools = ClaudeAgent.buildAllowedTools(options);
				const captureHook = ClaudeAgent.createCaptureHook(capturedData, options);
				const finalPrompt = ClaudeAgent.buildFinalPrompt(prompt, options);
				const agentOptions = ClaudeAgent.buildAgentOptions(
					allowedTools,
					model,
					options,
					captureHook,
					memoryTool
				);

				// Execute the agent
				const executionResult = await ClaudeAgent.processAgentMessages(finalPrompt, agentOptions);

				// Serialize memory state if memory tool was used
				const finalMemoryState = (inMemoryTool && inMemoryTool.hasMemory()) ? inMemoryTool.serialize() : undefined;

				// Build and add output item
				const outputItem = ClaudeAgent.buildOutputItem(
					items[itemIndex],
					executionResult,
					capturedData,
					finalMemoryState,
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
