import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { EpisodeTypeEnum } from "@core/types";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import {
  fireLifecycleHook,
  MCPLifecycleEvent,
} from "~/utils/mcp/lifecycle-hooks";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { addToQueue } from "~/lib/ingest.server";
import { hasCredits } from "~/services/billing.server";

const StopSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  source: z.string().optional().default("claude-code-hook"),
  reason: z.string().optional(), // Why the assistant stopped (completed, interrupted, etc.)
  // New fields for conversation ingestion
  project: z.string().optional(),
  lastUserMessage: z.string().optional(),
  lastAssistantMessage: z.string().optional(),
  transcriptPath: z.string().optional(),
});

/**
 * API endpoint for triggering stop lifecycle hook
 * Called by Claude Code hooks when the assistant stops responding
 *
 * POST /api/v1/lifecycle/stop
 * Body: { sessionId: string, source?: string, reason?: string }
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
    const result = StopSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const {
      sessionId,
      source,
      reason,
      project,
      lastUserMessage,
      lastAssistantMessage,
    } = result.data;

    logger.info(`Received stop hook for session ${sessionId}`, {
      userId,
      workspaceId: workspace.id,
      source,
      reason,
      hasUserMessage: !!lastUserMessage,
      hasAssistantMessage: !!lastAssistantMessage,
    });

    // Fire the stop lifecycle hook
    const hookResult = await fireLifecycleHook(MCPLifecycleEvent.STOP, {
      sessionId,
      userId,
      workspaceId: workspace.id,
      source,
      timestamp: new Date(),
      reason,
    });

    // If we have conversation content, ingest it automatically
    let ingestionResult = null;
    if (lastUserMessage || lastAssistantMessage) {
      // Check credits first
      const hasSufficientCredits = await hasCredits(workspace.id, "addEpisode");

      if (hasSufficientCredits) {
        // Build the conversation content
        const conversationParts: string[] = [];

        if (project) {
          conversationParts.push(`Project: ${project}`);
        }

        if (lastUserMessage) {
          conversationParts.push(`[USER]\n${lastUserMessage}`);
        }

        if (lastAssistantMessage) {
          // Truncate very long assistant messages
          const truncatedAssistant =
            lastAssistantMessage.length > 50000
              ? lastAssistantMessage.substring(0, 50000) + "\n... (truncated)"
              : lastAssistantMessage;
          conversationParts.push(`[ASSISTANT]\n${truncatedAssistant}`);
        }

        const episodeBody = conversationParts.join("\n\n");

        try {
          ingestionResult = await addToQueue(
            {
              episodeBody,
              referenceTime: new Date().toISOString(),
              source: source || "claude-code",
              type: EpisodeTypeEnum.CONVERSATION,
              sessionId,
            },
            userId,
          );

          logger.info(`Auto-ingested conversation for session ${sessionId}`, {
            ingestionId: ingestionResult.id,
            project,
          });
        } catch (ingestionError) {
          logger.error("Failed to auto-ingest conversation:", {
            error: ingestionError,
            sessionId,
          });
        }
      } else {
        logger.warn(`Skipping auto-ingestion: insufficient credits`, {
          sessionId,
          workspaceId: workspace.id,
        });
      }
    }

    return json({
      success: true,
      message: hookResult?.message || "Stop hook triggered successfully",
      sessionId,
      ingested: !!ingestionResult,
      ingestionId: ingestionResult?.id,
    });
  } catch (error) {
    logger.error("Error processing stop hook:", { error });

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
    endpoint: "/api/v1/lifecycle/stop",
    method: "POST",
    description:
      "Trigger stop lifecycle hook (when assistant stops responding)",
    body: {
      sessionId: "string (required)",
      source: "string (optional, default: 'claude-code-hook')",
      reason: "string (optional, why the assistant stopped)",
    },
  });
};
