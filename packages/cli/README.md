# @core-memory/cli

CLI tool for setting up and managing CORE Memory integrations with Claude Code.

## Installation

```bash
npm install -g @core-memory/cli
# or
npx @core-memory/cli <command>
```

## Commands

### `setup-hooks`

Configure Claude Code hooks for automatic session tracking and memory integration.

```bash
npx @core-memory/cli setup-hooks
```

**Options:**
- `-u, --url <url>` - CORE Memory API URL (default: `https://api.getcore.ai`)
- `-k, --api-key <key>` - Your CORE Memory API key
- `-f, --force` - Overwrite existing hooks without prompting
- `--dry-run` - Show what would be changed without modifying files

**What it does:**
1. Locates your Claude Code configuration (`~/.claude/settings.json`)
2. Adds hooks for all lifecycle events:
   - **SessionStart** - Initialize session, search for relevant context
   - **UserPromptSubmit** - Search memory when you submit a prompt
   - **Stop** - Generate summary when assistant stops responding
   - **SessionEnd** - Generate session summary and store for future retrieval

### `remove-hooks`

Remove all CORE Memory hooks from Claude Code configuration.

```bash
npx @core-memory/cli remove-hooks
```

**Options:**
- `--dry-run` - Show what would be changed without modifying files

### `status`

Check the current status of CORE Memory hooks.

```bash
npx @core-memory/cli status
```

Shows:
- Configuration file location
- Installed hooks for each event type
- API key configuration status

## Configuration

### API Key

You can configure your API key in two ways:

1. **During setup** - Enter it when prompted, it will be embedded in the hook commands
2. **Environment variable** - Set `CORE_MEMORY_API_KEY` in your shell profile:

```bash
export CORE_MEMORY_API_KEY=your_api_key_here
```

Get your API key from: https://getcore.ai/settings/api-keys

### Custom API URL

For self-hosted CORE Memory instances:

```bash
npx @core-memory/cli setup-hooks --url https://your-instance.com
# or for local Docker deployment
npx @core-memory/cli setup-hooks --url http://localhost:3033
```

## How It Works

CORE Memory hooks into Claude Code's lifecycle events:

### SessionStart
When you start a Claude Code session:
```
POST /api/v1/lifecycle/session-start
{
  "sessionId": "<mcp-session-id>",
  "source": "claude-code-hook"
}
```

### UserPromptSubmit
When you submit a prompt:
```
POST /api/v1/lifecycle/prompt-submit
{
  "sessionId": "<mcp-session-id>",
  "source": "claude-code-hook"
}
```

### Stop
When the assistant stops responding:
```
POST /api/v1/lifecycle/stop
{
  "sessionId": "<mcp-session-id>",
  "source": "claude-code-hook"
}
```

### SessionEnd
When you close the session:
```
POST /api/v1/lifecycle/session-end
{
  "sessionId": "<mcp-session-id>",
  "source": "claude-code-hook"
}
```

This triggers:
1. Session compaction with a lower threshold (captures even short sessions)
2. Summary generation from all session episodes
3. Storage for future context retrieval

## Troubleshooting

### Hooks not firing

1. Check status: `npx @core-memory/cli status`
2. Ensure `CORE_MEMORY_API_KEY` is set if using environment variable mode
3. Check Claude Code logs for hook execution errors

### Permission errors

Ensure you have write access to `~/.claude/settings.json`

### Manual configuration

If the CLI doesn't work, you can manually add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 'https://api.getcore.ai/api/v1/lifecycle/session-start' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '{\"sessionId\": \"$MCP_SESSION_ID\", \"source\": \"claude-code-hook\"}'",
            "timeout": 30
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 'https://api.getcore.ai/api/v1/lifecycle/prompt-submit' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '{\"sessionId\": \"$MCP_SESSION_ID\", \"source\": \"claude-code-hook\"}'",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 'https://api.getcore.ai/api/v1/lifecycle/stop' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '{\"sessionId\": \"$MCP_SESSION_ID\", \"source\": \"claude-code-hook\"}'",
            "timeout": 60
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 'https://api.getcore.ai/api/v1/lifecycle/session-end' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '{\"sessionId\": \"$MCP_SESSION_ID\", \"source\": \"claude-code-hook\"}'",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

> **Note:** Claude Code hooks use a format with `matcher` and `hooks` array. The `matcher` field is optional and can be used to filter when hooks run.
