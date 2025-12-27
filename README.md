# n8n-nodes-claude-agent

An n8n community node that brings the power of the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) to your n8n workflows. This node allows you to run AI agents powered by Claude that can autonomously use tools to complete complex tasks.

## Features

- **Autonomous AI Agent**: Leverages the Claude Agent SDK to create agents that can reason, plan, and execute multi-step tasks
- **Restricted Tool Use**: Agent cannot read or write to the filesystem. Web search and web fetch can be optionally enabled.
- **Flexible Configuration**: Control agent behavior with options for max turns, custom context, and tool selection
- **Rich Output**: Captures agent response, execution metadata, tool usage details, etc.
- **Model Selection**: Dynamically choose from available models.

## Installation

### Community Nodes (Recommended)

1. Open your n8n instance
2. Go to **Settings** > **Community Nodes**
3. Click **Install**
4. Enter `n8n-nodes-claude-agent`
5. Click **Install**

### Manual Installation

For local development or self-hosted instances:

```bash
cd ~/.n8n/custom
npm install n8n-nodes-claude-agent
```

Then restart your n8n instance.

## Prerequisites

- n8n instance (self-hosted or cloud)
- Anthropic Claude Code installed and logged in. This will re-use the Claude Code credentials file.


## Usage

### Basic Example

**Prompt:**
```
Research the latest news about AI developments and summarize the top 3 stories.
```

The agent will:
1. Use the Web Search tool to find recent AI news
2. Fetch and read relevant articles
3. Synthesize a summary of the top stories
4. Return the response

### Advanced Configuration

**Options:**
- **Model**: Choose between Sonnet (recommended), Opus (most capable), or Haiku (fastest)
- **Max Turns**: Limit the number of agent iterations (default: 10)
- **Enable Web Search**: Allow the agent to search the web
- **Enable Web Fetch**: Allow the agent to fetch and parse web pages
- **Custom Context**: Add additional instructions or context
- **Include Tool Details**: Include detailed tool execution information in the output

### Output Format

The node outputs data in the following format:

```json
{
  "claudeAgent": {
    "response": "The agent's final response text",
    "model": "claude-sonnet-4-5-20250929",
    "turns": 5,
    "executionTime": 12500,
    "tokensUsed": 4523,
    "toolsUsed": [
      {
        "name": "WebSearch",
        "input": { "query": "latest AI developments 2025" },
        "output": { "results": [] },
        "timestamp": "2025-12-27T10:30:00.000Z"
      }
    ]
  }
}
```

## Example Workflows

### 1. Research Assistant

```
Input: Topic to research
Prompt: "Research [topic] and create a comprehensive summary with sources"
Tools: Web Search, Web Fetch
Output: Detailed research summary
```

### 2. Content Analyzer

```
Input: URL to analyze
Prompt: "Fetch the content from [URL] and analyze it for key insights"
Tools: Web Fetch
Output: Content analysis
```


## How It Works

The Claude Agent SDK provides a powerful framework for building autonomous AI agents:

1. **Task Understanding**: The agent analyzes your prompt to understand the task
2. **Planning**: It creates a plan of action, potentially breaking complex tasks into subtasks
3. **Tool Use**: The agent autonomously selects and uses tools to gather information or perform actions
4. **Iteration**: It continues working through the task across multiple turns until completion
5. **Response**: Finally, it provides a comprehensive response with all gathered information

## Limitations

- The agent requires an active internet connection for tool use
- Web Search and Web Fetch tools access public web content only
- API usage is subject to Anthropic's rate limits and pricing
- Complex tasks may require higher max turns limits
- The agent cannot execute arbitrary code or access your local filesystem

## Troubleshooting

### Node doesn't appear in n8n

- Restart your n8n instance after installation
- Check that the package is properly installed in `~/.n8n/custom/node_modules/`

### Authentication errors

- Verify the Claude Code credentials file (usually in ~/.claude/.credentials) has credentials and is accessible to N8N

## Development

### Setup

```bash
git clone https://github.com/your-org/n8n-nodes-claude-agent.git
cd n8n-nodes-claude-agent
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Local Development

To use within a locally running N8N instance for development:
```bash
npm install
npm run build
npm link
cd ~/.n8n/custom
npm init
npm link n8n-nodes-claude-agent
# Restart N8N
```

Remember to run `npm run build` and restart n8n to load changes in N8N.

## Resources

- [Claude Agent SDK Documentation](https://github.com/anthropics/claude-agent-sdk)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

- [Report Issues](https://github.com/your-org/n8n-nodes-claude-agent/issues)
- [n8n Community Forum](https://community.n8n.io/)

## License

[MIT](LICENSE.md)

## Changelog

### 0.1.0

- Initial release
- Claude Agent SDK integration
- Web Search and Web Fetch tools
- Model selection (Sonnet, Opus, Haiku)
- Configurable options for agent behavior
- Rich output with execution metadata
