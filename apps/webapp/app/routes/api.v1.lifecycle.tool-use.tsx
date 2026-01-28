import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import { getWorkspaceByUser } from "~/models/workspace.server";

const ToolUseSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  project: z.string().optional(),
  cwd: z.string().optional(),
  toolName: z.string().min(1, "toolName is required"),
  toolInput: z.string().optional(),
  toolResponse: z.string().optional(),
  source: z.string().optional().default("claude-code-hook"),
});

/**
 * API endpoint for capturing tool usage from Claude Code
 * Called by the PostToolUse hook after every tool execution
 *
 * Note: Currently this endpoint just acknowledges receipt.
 * Tool observations are captured but not stored persistently yet.
 * The main ingestion happens via the Stop hook which captures
 * the full conversation from the transcript.
 *
 * POST /api/v1/lifecycle/tool-use
 * Body: { sessionId, toolName, toolInput, toolResponse, ... }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Authenticate the request
    const auth = await requireApiAuth(request);
    const userId = auth.userId;

    // Get workspace
    const workspace = await getWorkspaceByUser(userId);
    if (!workspace) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    // Parse and validate body
    const body = await request.json();
    const result = ToolUseSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { sessionId, project, toolName } = result.data;

    // Log tool usage for debugging (could be stored in future)
    logger.debug(`Tool use received: ${toolName}`, {
      sessionId,
      project,
      toolName,
      workspaceId: workspace.id,
    });

    // For now, just acknowledge receipt
    // Future: could store in a SessionObservation table for richer context
    return json({
      success: true,
      message: "Tool use acknowledged",
      sessionId,
      toolName,
    });
  } catch (error) {
    // Log but don't fail - we don't want to block Claude Code
    logger.error("Error processing tool use:", { error });

    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};

// Health check
export const loader = async () => {
  return json({
    endpoint: "/api/v1/lifecycle/tool-use",
    method: "POST",
    description: "Capture tool usage from Claude Code PostToolUse hook",
    body: {
      sessionId: "string (required)",
      toolName: "string (required)",
      toolInput: "string (optional)",
      toolResponse: "string (optional)",
      project: "string (optional)",
      cwd: "string (optional)",
      source: "string (optional)",
    },
  });
};
