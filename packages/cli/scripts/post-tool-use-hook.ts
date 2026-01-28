#!/usr/bin/env node
/**
 * CORE Memory - Post Tool Use Hook
 *
 * Called by Claude Code after every tool execution.
 * Receives JSON via stdin with: { session_id, cwd, tool_name, tool_input, tool_response }
 *
 * Captures tool usage as observations for later analysis.
 */

import { stdin, stdout } from "process";
import * as path from "path";

interface PostToolUseInput {
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: string;
  tool_response: string;
}

interface HookResponse {
  continue: boolean;
  suppressOutput?: boolean;
}

// Tools to skip - these don't provide valuable context
const SKIP_TOOLS = new Set([
  "TodoWrite",
  "AskUserQuestion",
  "SlashCommand",
  "Skill",
  "ListMcpResourcesTool",
]);

function createResponse(): HookResponse {
  return {
    continue: true,
    suppressOutput: true,
  };
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "... (truncated)";
}

async function handlePostToolUse(input: PostToolUseInput): Promise<void> {
  const { session_id, cwd, tool_name, tool_input, tool_response } = input;

  // Skip certain tools
  if (SKIP_TOOLS.has(tool_name)) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  const apiUrl = process.env.CORE_MEMORY_URL || "http://localhost:3033";
  const apiKey = process.env.CORE_MEMORY_API_KEY;

  if (!apiKey) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  const project = path.basename(cwd);

  try {
    const response = await fetch(`${apiUrl}/api/v1/lifecycle/tool-use`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sessionId: session_id,
        project,
        cwd,
        toolName: tool_name,
        // Truncate to avoid huge payloads
        toolInput: truncate(tool_input, 10000),
        toolResponse: truncate(tool_response, 50000),
        source: "claude-code-hook",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[core-memory] Tool use capture failed: ${response.status}`);
    }
  } catch (error) {
    // Silently fail - don't block Claude Code
    console.error(`[core-memory] Error in post-tool-use hook:`, error);
  }

  stdout.write(JSON.stringify(createResponse()));
}

// Read from stdin
let input = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  input += chunk;
});
stdin.on("end", async () => {
  try {
    const parsed = input ? JSON.parse(input) : {};
    await handlePostToolUse(parsed);
  } catch (error) {
    console.error("[core-memory] Failed to parse input:", error);
    stdout.write(JSON.stringify(createResponse()));
  }
});

// Handle TTY mode
if (stdin.isTTY) {
  handlePostToolUse({
    session_id: "test",
    cwd: process.cwd(),
    tool_name: "Read",
    tool_input: '{"file_path": "/test/file.ts"}',
    tool_response: "file content here",
  });
}
