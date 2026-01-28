import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import {
  fireLifecycleHook,
  MCPLifecycleEvent,
} from "~/utils/mcp/lifecycle-hooks";
import { getWorkspaceByUser } from "~/models/workspace.server";

const SessionStartSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  source: z.string().optional().default("claude-code-hook"),
  context: z.string().optional(), // Optional context about what the user is working on
});

/**
 * API endpoint for triggering session start lifecycle hook
 * Called by Claude Code hooks when a session starts
 *
 * POST /api/v1/lifecycle/session-start
 * Body: { sessionId: string, source?: string, context?: string }
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
    const result = SessionStartSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { sessionId, source, context } = result.data;

    logger.info(`Received session-start hook for session ${sessionId}`, {
      userId,
      workspaceId: workspace.id,
      source,
    });

    // Fire the session start lifecycle hook
    const hookResult = await fireLifecycleHook(MCPLifecycleEvent.SESSION_START, {
      sessionId,
      userId,
      workspaceId: workspace.id,
      source,
      timestamp: new Date(),
      additionalContext: context,
    });

    return json({
      success: true,
      message: hookResult?.message || "Session start hook triggered successfully",
      sessionId,
      // Return any context or suggestions from the hook
      suggestions: hookResult?.suggestions,
    });
  } catch (error) {
    logger.error("Error processing session-start hook:", { error });

    if (error instanceof Response) {
      throw error;
    }

    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};

// Also support GET for health check
export const loader = async () => {
  return json({
    endpoint: "/api/v1/lifecycle/session-start",
    method: "POST",
    description: "Trigger session start lifecycle hook",
    body: {
      sessionId: "string (required)",
      source: "string (optional, default: 'claude-code-hook')",
      context: "string (optional, context about what user is working on)",
    },
  });
};
