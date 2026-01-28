import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import {
  fireLifecycleHook,
  MCPLifecycleEvent,
} from "~/utils/mcp/lifecycle-hooks";
import { getWorkspaceByUser } from "~/models/workspace.server";

const SessionEndSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  source: z.string().optional().default("claude-code-hook"),
});

/**
 * API endpoint for triggering session end lifecycle hook
 * Called by Claude Code hooks when a session ends
 *
 * POST /api/v1/lifecycle/session-end
 * Body: { sessionId: string, source?: string }
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
    const result = SessionEndSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { sessionId, source } = result.data;

    logger.info(`Received session-end hook for session ${sessionId}`, {
      userId,
      workspaceId: workspace.id,
      source,
    });

    // Fire the session end lifecycle hook
    await fireLifecycleHook(MCPLifecycleEvent.SESSION_END, {
      sessionId,
      userId,
      workspaceId: workspace.id,
      source,
      timestamp: new Date(),
    });

    return json({
      success: true,
      message: "Session end hook triggered successfully",
      sessionId,
    });
  } catch (error) {
    logger.error("Error processing session-end hook:", { error });

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
    endpoint: "/api/v1/lifecycle/session-end",
    method: "POST",
    description: "Trigger session end lifecycle hook",
    body: {
      sessionId: "string (required)",
      source: "string (optional, default: 'claude-code-hook')",
    },
  });
};
