import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import {
  fireLifecycleHook,
  MCPLifecycleEvent,
} from "~/utils/mcp/lifecycle-hooks";
import { getWorkspaceByUser } from "~/models/workspace.server";

const PromptSubmitSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  source: z.string().optional().default("claude-code-hook"),
  prompt: z.string().optional(), // The user's prompt (for context search)
});

/**
 * API endpoint for triggering user prompt submit lifecycle hook
 * Called by Claude Code hooks when a user submits a prompt
 *
 * POST /api/v1/lifecycle/prompt-submit
 * Body: { sessionId: string, source?: string, prompt?: string }
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
    const result = PromptSubmitSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { sessionId, source, prompt } = result.data;

    logger.info(`Received prompt-submit hook for session ${sessionId}`, {
      userId,
      workspaceId: workspace.id,
      source,
      promptLength: prompt?.length,
    });

    // Fire the prompt submit lifecycle hook
    const hookResult = await fireLifecycleHook(MCPLifecycleEvent.PROMPT_SUBMIT, {
      sessionId,
      userId,
      workspaceId: workspace.id,
      source,
      timestamp: new Date(),
      prompt,
    });

    return json({
      success: true,
      message: hookResult?.message || "Prompt submit hook triggered successfully",
      sessionId,
      // Return any relevant context found
      context: hookResult?.context,
    });
  } catch (error) {
    logger.error("Error processing prompt-submit hook:", { error });

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
    endpoint: "/api/v1/lifecycle/prompt-submit",
    method: "POST",
    description: "Trigger user prompt submit lifecycle hook",
    body: {
      sessionId: "string (required)",
      source: "string (optional, default: 'claude-code-hook')",
      prompt: "string (optional, the user's prompt for context search)",
    },
  });
};
