import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";

/**
 * MCP Lifecycle Events that can trigger hooks
 */
export enum MCPLifecycleEvent {
  SESSION_START = "session_start",
  SESSION_END = "session_end",
  PROMPT_SUBMIT = "prompt_submit",
  STOP = "stop",
}

/**
 * Configuration for lifecycle hooks stored in workspace metadata
 */
export interface LifecycleHookConfig {
  enabled: boolean;
  autoSummaryOnEnd: boolean;
  autoSummaryOnStop: boolean;
  contextSearchOnStart: boolean;
  contextSearchOnPrompt: boolean;
}

/**
 * Default lifecycle hook configuration
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleHookConfig = {
  enabled: true,
  autoSummaryOnEnd: true,
  autoSummaryOnStop: false, // Don't auto-summarize on every stop by default
  contextSearchOnStart: true,
  contextSearchOnPrompt: true,
};

/**
 * Context passed to lifecycle hook handlers
 */
export interface LifecycleHookContext {
  sessionId: string;
  userId: string;
  workspaceId: string;
  source?: string;
  timestamp: Date;
  // Additional context fields
  additionalContext?: string;
  prompt?: string;
  reason?: string;
}

/**
 * Result returned from lifecycle hook handlers
 */
export interface LifecycleHookResult {
  message?: string;
  suggestions?: string[];
  context?: string;
}

/**
 * Get lifecycle hook configuration from workspace metadata
 */
export async function getLifecycleConfig(
  workspaceId: string,
): Promise<LifecycleHookConfig> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    const metadata = workspace?.metadata as Record<string, any> | undefined;
    const hookConfig = metadata?.lifecycleHooks || {};

    return {
      enabled: hookConfig.enabled ?? DEFAULT_LIFECYCLE_CONFIG.enabled,
      autoSummaryOnEnd:
        hookConfig.autoSummaryOnEnd ??
        DEFAULT_LIFECYCLE_CONFIG.autoSummaryOnEnd,
      autoSummaryOnStop:
        hookConfig.autoSummaryOnStop ??
        DEFAULT_LIFECYCLE_CONFIG.autoSummaryOnStop,
      contextSearchOnStart:
        hookConfig.contextSearchOnStart ??
        DEFAULT_LIFECYCLE_CONFIG.contextSearchOnStart,
      contextSearchOnPrompt:
        hookConfig.contextSearchOnPrompt ??
        DEFAULT_LIFECYCLE_CONFIG.contextSearchOnPrompt,
    };
  } catch (error) {
    logger.error("Error fetching lifecycle config:", { error });
    return DEFAULT_LIFECYCLE_CONFIG;
  }
}

/**
 * Fire a lifecycle hook for the given event
 * This is called by the MCP server when session events occur
 */
export async function fireLifecycleHook(
  event: MCPLifecycleEvent,
  context: LifecycleHookContext,
): Promise<LifecycleHookResult | void> {
  try {
    const config = await getLifecycleConfig(context.workspaceId);

    if (!config.enabled) {
      logger.debug(
        `Lifecycle hooks disabled for workspace ${context.workspaceId}`,
      );
      return;
    }

    logger.info(
      `Firing lifecycle hook: ${event} for session ${context.sessionId}`,
    );

    switch (event) {
      case MCPLifecycleEvent.SESSION_START:
        return await handleSessionStart(context, config);

      case MCPLifecycleEvent.SESSION_END:
        return await handleSessionEnd(context, config);

      case MCPLifecycleEvent.PROMPT_SUBMIT:
        return await handlePromptSubmit(context, config);

      case MCPLifecycleEvent.STOP:
        return await handleStop(context, config);

      default:
        logger.warn(`Unknown lifecycle event: ${event}`);
    }
  } catch (error) {
    logger.error(`Error firing lifecycle hook ${event}:`, { error });
    // Don't throw - lifecycle hooks should not break the main flow
  }
}

/**
 * Handle session start event
 * Performs initial context search to provide relevant information
 */
async function handleSessionStart(
  context: LifecycleHookContext,
  config: LifecycleHookConfig,
): Promise<LifecycleHookResult> {
  logger.info(
    `Session started: ${context.sessionId} for user ${context.userId}`,
  );

  const result: LifecycleHookResult = {
    message: "Session start hook triggered successfully",
  };

  // Perform context search if enabled
  if (config.contextSearchOnStart && context.additionalContext) {
    try {
      // TODO: Implement context search using SearchService
      // This would search memory for relevant context based on what the user is working on
      logger.info(`Context search requested for session ${context.sessionId}`, {
        context: context.additionalContext,
      });
      result.suggestions = [
        "Search memory for relevant context",
        "Load previous session summaries",
      ];
    } catch (error) {
      logger.error("Error during session start context search:", { error });
    }
  }

  return result;
}

/**
 * Handle session end event
 */
async function handleSessionEnd(
  context: LifecycleHookContext,
  config: LifecycleHookConfig,
): Promise<LifecycleHookResult> {
  logger.info(`Session ended: ${context.sessionId} for user ${context.userId}`);

  // Trigger auto-summary if enabled
  if (config.autoSummaryOnEnd) {
    await triggerSessionEndSummary(context);
  }

  return {
    message: "Session end hook triggered successfully",
  };
}

/**
 * Handle prompt submit event
 * Performs context search based on the user's prompt
 */
async function handlePromptSubmit(
  context: LifecycleHookContext,
  config: LifecycleHookConfig,
): Promise<LifecycleHookResult> {
  logger.info(
    `Prompt submitted in session ${context.sessionId} for user ${context.userId}`,
  );

  const result: LifecycleHookResult = {
    message: "Prompt submit hook triggered successfully",
  };

  // Perform context search if enabled and prompt is provided
  if (config.contextSearchOnPrompt && context.prompt) {
    try {
      // TODO: Implement context search using SearchService
      // This would search memory for relevant context based on the user's prompt
      logger.info(
        `Context search requested for prompt in session ${context.sessionId}`,
        { promptLength: context.prompt.length },
      );
      // result.context = searchResults;
    } catch (error) {
      logger.error("Error during prompt submit context search:", { error });
    }
  }

  return result;
}

/**
 * Handle stop event
 * Optionally generates a summary when the assistant stops responding
 */
async function handleStop(
  context: LifecycleHookContext,
  config: LifecycleHookConfig,
): Promise<LifecycleHookResult> {
  logger.info(
    `Assistant stopped in session ${context.sessionId} for user ${context.userId}`,
    { reason: context.reason },
  );

  // Trigger auto-summary if enabled
  if (config.autoSummaryOnStop) {
    await triggerSessionEndSummary(context);
  }

  return {
    message: "Stop hook triggered successfully",
  };
}

/**
 * Trigger session compaction/summary when session ends
 * Uses a lower threshold than normal compaction to ensure summary is generated
 */
export async function triggerSessionEndSummary(
  context: LifecycleHookContext,
): Promise<void> {
  try {
    logger.info(
      `Triggering session end summary for session ${context.sessionId}`,
    );

    // Import dynamically to avoid circular dependencies
    const { triggerSessionCompaction } = await import(
      "~/jobs/session/session-compaction.logic"
    );

    // Trigger compaction with session_end flag for lower threshold
    await triggerSessionCompaction(
      context.sessionId,
      context.userId,
      context.workspaceId,
      "session_end", // Special trigger source for lower threshold
    );

    logger.info(
      `Session end summary triggered for session ${context.sessionId}`,
    );
  } catch (error) {
    logger.error(
      `Error triggering session end summary for ${context.sessionId}:`,
      { error },
    );
    // Don't throw - this is a best-effort operation
  }
}
