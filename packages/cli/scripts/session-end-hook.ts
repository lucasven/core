#!/usr/bin/env node
/**
 * CORE Memory - Session End Hook
 *
 * Called by Claude Code when a session ends.
 * Receives JSON via stdin with: { session_id, reason }
 *
 * Finalizes the session and triggers final ingestion.
 */

import { stdin, stdout } from "process";

interface SessionEndInput {
  session_id: string;
  reason?: string;
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

async function handleSessionEnd(input: SessionEndInput): Promise<void> {
  const { session_id, reason } = input;

  const apiUrl = process.env.CORE_MEMORY_URL || "http://localhost:3033";
  const apiKey = process.env.CORE_MEMORY_API_KEY;

  if (!apiKey) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/lifecycle/session-end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sessionId: session_id,
        reason,
        source: "claude-code-hook",
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[core-memory] Session end failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[core-memory] Error in session-end hook:`, error);
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
    await handleSessionEnd(parsed);
  } catch (error) {
    console.error("[core-memory] Failed to parse input:", error);
    stdout.write(JSON.stringify(createResponse()));
  }
});

// Handle TTY mode
if (stdin.isTTY) {
  handleSessionEnd({ session_id: "test", reason: "user_exit" });
}
