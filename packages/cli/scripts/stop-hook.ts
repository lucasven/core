#!/usr/bin/env node
/**
 * CORE Memory - Stop Hook
 *
 * Called by Claude Code when the assistant stops responding.
 * Receives JSON via stdin with: { session_id, transcript_path }
 *
 * Reads the transcript and ingests the conversation into CORE Memory.
 */

import { stdin, stdout } from "process";
import * as fs from "fs";
import * as path from "path";

interface StopInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
}

interface TranscriptMessage {
  type: "user" | "assistant";
  message?: {
    content: string | Array<{ type: string; text?: string }>;
  };
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

function extractMessageContent(
  transcriptPath: string,
  role: "user" | "assistant",
  stripSystemReminders: boolean = false
): string {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return "";
  }

  try {
    const content = fs.readFileSync(transcriptPath, "utf-8").trim();
    if (!content) return "";

    const lines = content.split("\n");

    // Find the last message of the specified role
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const msg: TranscriptMessage = JSON.parse(lines[i]);
        if (msg.type === role && msg.message?.content) {
          let text = "";
          const msgContent = msg.message.content;

          if (typeof msgContent === "string") {
            text = msgContent;
          } else if (Array.isArray(msgContent)) {
            text = msgContent
              .filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join("\n");
          }

          if (stripSystemReminders) {
            text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
            text = text.replace(/\n{3,}/g, "\n\n").trim();
          }

          return text;
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error("[core-memory] Failed to read transcript:", error);
  }

  return "";
}

async function handleStop(input: StopInput): Promise<void> {
  const { session_id, transcript_path, cwd } = input;

  const apiUrl = process.env.CORE_MEMORY_URL || "http://localhost:3033";
  const apiKey = process.env.CORE_MEMORY_API_KEY;

  if (!apiKey) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  // Extract last user and assistant messages from transcript
  const lastUserMessage = extractMessageContent(transcript_path || "", "user");
  const lastAssistantMessage = extractMessageContent(transcript_path || "", "assistant", true);

  if (!lastUserMessage && !lastAssistantMessage) {
    stdout.write(JSON.stringify(createResponse()));
    return;
  }

  const project = cwd ? path.basename(cwd) : "unknown";

  try {
    // Send to stop endpoint for processing/summarization
    const response = await fetch(`${apiUrl}/api/v1/lifecycle/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sessionId: session_id,
        project,
        lastUserMessage,
        lastAssistantMessage,
        transcriptPath: transcript_path,
        source: "claude-code-hook",
      }),
      signal: AbortSignal.timeout(30000), // Longer timeout for ingestion
    });

    if (!response.ok) {
      console.error(`[core-memory] Stop hook failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[core-memory] Error in stop hook:`, error);
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
    await handleStop(parsed);
  } catch (error) {
    console.error("[core-memory] Failed to parse input:", error);
    stdout.write(JSON.stringify(createResponse()));
  }
});

// Handle TTY mode
if (stdin.isTTY) {
  handleStop({ session_id: "test" });
}
