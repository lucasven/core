import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireApiAuth } from "~/services/apiAuth.server";
import { logger } from "~/services/logger.service";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { reembedTask, getEmbeddingCounts } from "~/migration/reembed-migration";

const ReembedSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  batchSize: z.number().optional().default(100),
  skipStatements: z.boolean().optional().default(false),
  skipEpisodes: z.boolean().optional().default(false),
  skipEntities: z.boolean().optional().default(false),
  skipCompactedSessions: z.boolean().optional().default(false),
});

/**
 * API endpoint for triggering embedding regeneration
 * Use this when changing embedding models or dimensions
 *
 * POST /api/v1/reembed
 * Body: { dryRun?: boolean, batchSize?: number, skip*?: boolean }
 *
 * GET /api/v1/reembed - Get embedding counts for current user
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
    const result = ReembedSchema.safeParse(body);

    if (!result.success) {
      return json(
        { error: "Invalid request", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { dryRun, batchSize, skipStatements, skipEpisodes, skipEntities, skipCompactedSessions } =
      result.data;

    logger.info(`Starting re-embedding for user ${userId}`, {
      workspaceId: workspace.id,
      dryRun,
      batchSize,
    });

    // Run the re-embedding task
    const reembedResult = await reembedTask({
      workspaceId: workspace.id,
      userId,
      dryRun,
      batchSize,
      skipStatements,
      skipEpisodes,
      skipEntities,
      skipCompactedSessions,
    });

    return json({
      success: reembedResult.success,
      message: dryRun
        ? "Dry run completed - no changes were made"
        : "Re-embedding completed",
      result: {
        statementsReembedded: reembedResult.statementsReembedded,
        episodesReembedded: reembedResult.episodesReembedded,
        entitiesReembedded: reembedResult.entitiesReembedded,
        compactedSessionsReembedded: reembedResult.compactedSessionsReembedded,
        newDimension: reembedResult.newDimension,
        totalReembedded:
          reembedResult.statementsReembedded +
          reembedResult.episodesReembedded +
          reembedResult.entitiesReembedded +
          reembedResult.compactedSessionsReembedded,
      },
      errors: reembedResult.errors.length > 0 ? reembedResult.errors : undefined,
    });
  } catch (error) {
    logger.error("Error processing reembed request:", { error });

    if (error instanceof Response) {
      throw error;
    }

    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

/**
 * GET - Get embedding counts for current user
 */
export const loader = async ({ request }: ActionFunctionArgs) => {
  try {
    const auth = await requireApiAuth(request);
    const userId = auth.userId;

    const workspace = await getWorkspaceByUser(userId);
    if (!workspace) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    const counts = await getEmbeddingCounts(userId);
    const metadata = workspace.metadata as Record<string, any> | undefined;

    return json({
      endpoint: "/api/v1/reembed",
      method: "POST",
      description: "Trigger embedding regeneration for dimension changes",
      currentConfig: {
        embeddingModel: metadata?.embeddingModel || process.env.EMBEDDING_MODEL,
        embeddingDimensions:
          metadata?.embeddingDimensions ||
          parseInt(process.env.EMBEDDING_MODEL_SIZE || "2000", 10),
      },
      embeddingCounts: counts,
      body: {
        dryRun: "boolean (optional, default: false) - Preview without making changes",
        batchSize: "number (optional, default: 100) - Embeddings per batch",
        skipStatements: "boolean (optional) - Skip statement embeddings",
        skipEpisodes: "boolean (optional) - Skip episode embeddings",
        skipEntities: "boolean (optional) - Skip entity embeddings",
        skipCompactedSessions: "boolean (optional) - Skip compacted session embeddings",
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    return json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};
