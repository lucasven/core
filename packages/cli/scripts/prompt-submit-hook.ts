#!/usr/bin/env node
/**
 * CORE Memory - User Prompt Submit Hook
 *
 * Called by Claude Code when user submits a prompt.
 * Receives JSON via stdin with: { session_id, cwd, prompt }
 *
 * Stores the user prompt for later ingestion.
 */

import { stdin, stdout } from "process";
import * as path from "path";

interface PromptSubmitInput {
  session_id: string;
  cwd: string;
  prompt: string;
}

interface HookResponse {
  continue: boolean;
  suppressOutput?: boolean;
}

function createResponse(): HookResponse {
  return {
    continue: true,
    suppressOutput: true,
  };
}

async function handlePromptSubmit(input: PromptSubmitInput): Promise<void> {
  const { session_id, cwd, prompt } = input;
  const project = path.basename(cwd);

  const apiUrl = process.env.CORE_MEMORY_URL || "http://localhost:3033";
  const apiKey = process.env.CORE_MEMORY_API_KEY;

  if (!apiKey) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  // Skip slash commands
  if (prompt?.startsWith("/")) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/lifecycle/prompt-submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sessionId: session_id,
        project,
        cwd,
        prompt,
        source: "claude-code-hook",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[core-memory] Prompt submit failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[core-memory] Error in prompt-submit hook:`, error);
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
    await handlePromptSubmit(parsed);
  } catch (error) {
    console.error("[core-memory] Failed to parse input:", error);
    stdout.write(JSON.stringify(createResponse()));
  }
});

// Handle TTY mode
if (stdin.isTTY) {
  handlePromptSubmit({ session_id: "test", cwd: process.cwd(), prompt: "test prompt" });
}
