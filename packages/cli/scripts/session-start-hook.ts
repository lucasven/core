#!/usr/bin/env node
/**
 * CORE Memory - Session Start Hook
 *
 * Called by Claude Code when a new session starts.
 * Receives JSON via stdin with: { session_id, cwd }
 *
 * Initializes the session and searches for relevant context.
 */

import { stdin, stdout } from "process";
import * as path from "path";

interface SessionStartInput {
  session_id: string;
  cwd: string;
}

interface HookResponse {
  continue: boolean;
  suppressOutput?: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
}

function createResponse(success: boolean, context?: string): HookResponse {
  return {
    continue: true,
    suppressOutput: true,
    ...(context && {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context,
      },
    }),
  };
}

async function handleSessionStart(input: SessionStartInput): Promise<void> {
  const { session_id, cwd } = input;
  const project = path.basename(cwd);

  const apiUrl = process.env.CORE_MEMORY_URL || "http://localhost:3033";
  const apiKey = process.env.CORE_MEMORY_API_KEY;

  if (!apiKey) {
    console.error("[core-memory] Warning: CORE_MEMORY_API_KEY not set");
    stdout.write(JSON.stringify(createResponse(true)));
    return;
  }

  try {
    // Initialize session
    const response = await fetch(`${apiUrl}/api/v1/lifecycle/session-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sessionId: session_id,
        project,
        cwd,
        source: "claude-code-hook",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[core-memory] Session start failed: ${response.status}`);
    }

    // Search for relevant context
    const searchResponse = await fetch(`${apiUrl}/api/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `project:${project} recent conversations and context`,
        limit: 5,
      }),
      signal: AbortSignal.timeout(10000),
    });

    let context = "";
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.results && searchData.results.length > 0) {
        context = `Previous context from CORE Memory:\n${searchData.results
          .map((r: any) => `- ${r.content?.substring(0, 200) || r.summary || ""}`)
          .join("\n")}`;
      }
    }

    stdout.write(JSON.stringify(createResponse(true, context)));
  } catch (error) {
    console.error(`[core-memory] Error in session-start hook:`, error);
    stdout.write(JSON.stringify(createResponse(true)));
  }
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
    await handleSessionStart(parsed);
  } catch (error) {
    console.error("[core-memory] Failed to parse input:", error);
    stdout.write(JSON.stringify(createResponse(true)));
  }
});

// Handle TTY mode (direct execution)
if (stdin.isTTY) {
  handleSessionStart({ session_id: "test", cwd: process.cwd() });
}
