import { logger } from "~/services/logger.service";
import { getErrorMessage } from "~/utils/errors";
import { prisma } from "~/db.server";
import { getEmbedding, getWorkspaceEmbeddingModel } from "~/lib/model.server";

export interface ReembedPayload {
  workspaceId: string;
  userId: string;
  batchSize?: number; // Number of embeddings to process per batch (default: 100)
  skipStatements?: boolean;
  skipEpisodes?: boolean;
  skipEntities?: boolean;
  skipCompactedSessions?: boolean;
  dryRun?: boolean; // If true, log what would be migrated without writing
}

export interface ReembedResult {
  success: boolean;
  statementsReembedded: number;
  episodesReembedded: number;
  entitiesReembedded: number;
  compactedSessionsReembedded: number;
  newDimension: number;
  errors: string[];
}

/**
 * Drop HNSW indexes (before re-embedding)
 */
async function dropIndexes(): Promise<void> {
  const indexes = [
    "statement_embeddings_vector_idx",
    "episode_embeddings_vector_idx",
    "entity_embeddings_vector_idx",
    "compacted_session_embeddings_vector_idx",
  ];

  for (const name of indexes) {
    try {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS core.${name};`);
      logger.info(`Dropped index ${name}`);
    } catch (error) {
      logger.warn(`Could not drop index ${name}:`, { error });
      // Continue - index might not exist
    }
  }
}

/**
 * Create HNSW indexes with new dimension (after re-embedding)
 */
async function createIndexes(newDimension: number): Promise<void> {
  const indexes = [
    { table: "statement_embeddings", name: "statement_embeddings_vector_idx" },
    { table: "episode_embeddings", name: "episode_embeddings_vector_idx" },
    { table: "entity_embeddings", name: "entity_embeddings_vector_idx" },
    {
      table: "compacted_session_embeddings",
      name: "compacted_session_embeddings_vector_idx",
    },
  ];

  for (const { table, name } of indexes) {
    try {
      // Drop if exists first (in case partially created)
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS core.${name};`);

      // Create new index with correct dimension
      await prisma.$executeRawUnsafe(
        `CREATE INDEX ${name} ON core.${table} USING hnsw ((vector::vector(${newDimension})) vector_cosine_ops);`,
      );
      logger.info(`Created index ${name} with dimension ${newDimension}`);
    } catch (error) {
      logger.error(`Error creating index ${name}:`, { error });
      // Don't throw - indexes can be created later, app still works without them
    }
  }
}

/**
 * Re-embed statement embeddings with new model
 */
async function reembedStatements(
  userId: string,
  embeddingModel: string,
  batchSize: number,
  dryRun: boolean,
): Promise<{ reembedded: number; errors: string[] }> {
  const errors: string[] = [];
  let totalReembedded = 0;

  logger.info("Starting statement re-embedding", {
    userId,
    embeddingModel,
    dryRun,
  });

  // Count total records
  const totalRecords = await prisma.statementEmbedding.count({
    where: { userId },
  });

  logger.info(`Found ${totalRecords} statements to re-embed`);

  if (totalRecords === 0) {
    return { reembedded: 0, errors };
  }

  // Process in batches
  let skip = 0;
  while (skip < totalRecords) {
    const batch = await prisma.statementEmbedding.findMany({
      where: { userId },
      skip,
      take: batchSize,
      select: { id: true, fact: true, labelIds: true },
    });

    logger.info(
      `Processing statements batch ${Math.floor(skip / batchSize) + 1}`,
      {
        start: skip,
        end: Math.min(skip + batchSize, totalRecords),
        total: totalRecords,
      },
    );

    if (dryRun) {
      logger.info(`[DRY RUN] Would re-embed ${batch.length} statements`);
      totalReembedded += batch.length;
      skip += batchSize;
      continue;
    }

    try {
      // Generate new embeddings
      for (const record of batch) {
        try {
          const embedding = await getEmbedding(record.fact, embeddingModel);
          const vectorString = `[${embedding.join(",")}]`;

          await prisma.$executeRaw`
            UPDATE core.statement_embeddings
            SET vector = ${vectorString}::vector, "updatedAt" = NOW()
            WHERE id = ${record.id}
          `;

          totalReembedded++;
        } catch (error) {
          const errorMsg = `Error re-embedding statement ${record.id}: ${getErrorMessage(error)}`;
          logger.error(errorMsg, { error });
          errors.push(errorMsg);
        }
      }

      logger.info(
        `Successfully re-embedded batch of ${batch.length} statements`,
      );
    } catch (error) {
      const errorMsg = `Error processing statements batch: ${getErrorMessage(error)}`;
      logger.error(errorMsg, { error });
      errors.push(errorMsg);
    }

    skip += batchSize;
  }

  return { reembedded: totalReembedded, errors };
}

/**
 * Re-embed episode embeddings with new model
 */
async function reembedEpisodes(
  userId: string,
  embeddingModel: string,
  batchSize: number,
  dryRun: boolean,
): Promise<{ reembedded: number; errors: string[] }> {
  const errors: string[] = [];
  let totalReembedded = 0;

  logger.info("Starting episode re-embedding", {
    userId,
    embeddingModel,
    dryRun,
  });

  const totalRecords = await prisma.episodeEmbedding.count({
    where: { userId },
  });

  logger.info(`Found ${totalRecords} episodes to re-embed`);

  if (totalRecords === 0) {
    return { reembedded: 0, errors };
  }

  let skip = 0;
  while (skip < totalRecords) {
    const batch = await prisma.episodeEmbedding.findMany({
      where: { userId },
      skip,
      take: batchSize,
      select: { id: true, content: true },
    });

    logger.info(
      `Processing episodes batch ${Math.floor(skip / batchSize) + 1}`,
      {
        start: skip,
        end: Math.min(skip + batchSize, totalRecords),
        total: totalRecords,
      },
    );

    if (dryRun) {
      logger.info(`[DRY RUN] Would re-embed ${batch.length} episodes`);
      totalReembedded += batch.length;
      skip += batchSize;
      continue;
    }

    try {
      for (const record of batch) {
        try {
          const embedding = await getEmbedding(record.content, embeddingModel);
          const vectorString = `[${embedding.join(",")}]`;

          await prisma.$executeRaw`
            UPDATE core.episode_embeddings
            SET vector = ${vectorString}::vector, "updatedAt" = NOW()
            WHERE id = ${record.id}
          `;

          totalReembedded++;
        } catch (error) {
          const errorMsg = `Error re-embedding episode ${record.id}: ${getErrorMessage(error)}`;
          logger.error(errorMsg, { error });
          errors.push(errorMsg);
        }
      }

      logger.info(`Successfully re-embedded batch of ${batch.length} episodes`);
    } catch (error) {
      const errorMsg = `Error processing episodes batch: ${getErrorMessage(error)}`;
      logger.error(errorMsg, { error });
      errors.push(errorMsg);
    }

    skip += batchSize;
  }

  return { reembedded: totalReembedded, errors };
}

/**
 * Re-embed entity embeddings with new model
 */
async function reembedEntities(
  userId: string,
  embeddingModel: string,
  batchSize: number,
  dryRun: boolean,
): Promise<{ reembedded: number; errors: string[] }> {
  const errors: string[] = [];
  let totalReembedded = 0;

  logger.info("Starting entity re-embedding", {
    userId,
    embeddingModel,
    dryRun,
  });

  const totalRecords = await prisma.entityEmbedding.count({
    where: { userId },
  });

  logger.info(`Found ${totalRecords} entities to re-embed`);

  if (totalRecords === 0) {
    return { reembedded: 0, errors };
  }

  let skip = 0;
  while (skip < totalRecords) {
    const batch = await prisma.entityEmbedding.findMany({
      where: { userId },
      skip,
      take: batchSize,
      select: { id: true, name: true },
    });

    logger.info(
      `Processing entities batch ${Math.floor(skip / batchSize) + 1}`,
      {
        start: skip,
        end: Math.min(skip + batchSize, totalRecords),
        total: totalRecords,
      },
    );

    if (dryRun) {
      logger.info(`[DRY RUN] Would re-embed ${batch.length} entities`);
      totalReembedded += batch.length;
      skip += batchSize;
      continue;
    }

    try {
      for (const record of batch) {
        try {
          const embedding = await getEmbedding(record.name, embeddingModel);
          const vectorString = `[${embedding.join(",")}]`;

          await prisma.$executeRaw`
            UPDATE core.entity_embeddings
            SET vector = ${vectorString}::vector, "updatedAt" = NOW()
            WHERE id = ${record.id}
          `;

          totalReembedded++;
        } catch (error) {
          const errorMsg = `Error re-embedding entity ${record.id}: ${getErrorMessage(error)}`;
          logger.error(errorMsg, { error });
          errors.push(errorMsg);
        }
      }

      logger.info(`Successfully re-embedded batch of ${batch.length} entities`);
    } catch (error) {
      const errorMsg = `Error processing entities batch: ${getErrorMessage(error)}`;
      logger.error(errorMsg, { error });
      errors.push(errorMsg);
    }

    skip += batchSize;
  }

  return { reembedded: totalReembedded, errors };
}

/**
 * Re-embed compacted session embeddings with new model
 */
async function reembedCompactedSessions(
  userId: string,
  embeddingModel: string,
  batchSize: number,
  dryRun: boolean,
): Promise<{ reembedded: number; errors: string[] }> {
  const errors: string[] = [];
  let totalReembedded = 0;

  logger.info("Starting compacted session re-embedding", {
    userId,
    embeddingModel,
    dryRun,
  });

  const totalRecords = await prisma.compactedSessionEmbedding.count({
    where: { userId },
  });

  logger.info(`Found ${totalRecords} compacted sessions to re-embed`);

  if (totalRecords === 0) {
    return { reembedded: 0, errors };
  }

  let skip = 0;
  while (skip < totalRecords) {
    const batch = await prisma.compactedSessionEmbedding.findMany({
      where: { userId },
      skip,
      take: batchSize,
      select: { id: true, summary: true },
    });

    logger.info(
      `Processing compacted sessions batch ${Math.floor(skip / batchSize) + 1}`,
      {
        start: skip,
        end: Math.min(skip + batchSize, totalRecords),
        total: totalRecords,
      },
    );

    if (dryRun) {
      logger.info(
        `[DRY RUN] Would re-embed ${batch.length} compacted sessions`,
      );
      totalReembedded += batch.length;
      skip += batchSize;
      continue;
    }

    try {
      for (const record of batch) {
        try {
          const embedding = await getEmbedding(record.summary, embeddingModel);
          const vectorString = `[${embedding.join(",")}]`;

          await prisma.$executeRaw`
            UPDATE core.compacted_session_embeddings
            SET vector = ${vectorString}::vector, "updatedAt" = NOW()
            WHERE id = ${record.id}
          `;

          totalReembedded++;
        } catch (error) {
          const errorMsg = `Error re-embedding compacted session ${record.id}: ${getErrorMessage(error)}`;
          logger.error(errorMsg, { error });
          errors.push(errorMsg);
        }
      }

      logger.info(
        `Successfully re-embedded batch of ${batch.length} compacted sessions`,
      );
    } catch (error) {
      const errorMsg = `Error processing compacted sessions batch: ${getErrorMessage(error)}`;
      logger.error(errorMsg, { error });
      errors.push(errorMsg);
    }

    skip += batchSize;
  }

  return { reembedded: totalReembedded, errors };
}

/**
 * Get embedding counts for a user
 */
export async function getEmbeddingCounts(userId: string): Promise<{
  statements: number;
  episodes: number;
  entities: number;
  compactedSessions: number;
  total: number;
}> {
  const [statements, episodes, entities, compactedSessions] = await Promise.all(
    [
      prisma.statementEmbedding.count({ where: { userId } }),
      prisma.episodeEmbedding.count({ where: { userId } }),
      prisma.entityEmbedding.count({ where: { userId } }),
      prisma.compactedSessionEmbedding.count({ where: { userId } }),
    ],
  );

  return {
    statements,
    episodes,
    entities,
    compactedSessions,
    total: statements + episodes + entities + compactedSessions,
  };
}

/**
 * Main re-embedding task
 *
 * This task re-generates all embeddings using the workspace's configured
 * embedding model. Use this when:
 * - Changing embedding models (different dimensions)
 * - Upgrading to a better embedding model
 * - Fixing corrupted embeddings
 *
 * IMPORTANT: This is a long-running task. For large datasets, consider
 * running in a background job queue (Trigger.dev).
 *
 * Usage:
 *   await reembedTask({ workspaceId: "ws123", userId: "user123" });
 *   await reembedTask({ workspaceId: "ws123", userId: "user123", dryRun: true });
 *   await reembedTask({ workspaceId: "ws123", userId: "user123", skipStatements: true });
 */
export async function reembedTask(
  payload: ReembedPayload,
): Promise<ReembedResult> {
  const batchSize = payload.batchSize || 100;
  const dryRun = payload.dryRun || false;

  logger.info("Starting re-embedding task", {
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    batchSize,
    dryRun,
    skipStatements: payload.skipStatements,
    skipEpisodes: payload.skipEpisodes,
    skipEntities: payload.skipEntities,
    skipCompactedSessions: payload.skipCompactedSessions,
  });

  const result: ReembedResult = {
    success: true,
    statementsReembedded: 0,
    episodesReembedded: 0,
    entitiesReembedded: 0,
    compactedSessionsReembedded: 0,
    newDimension: 0,
    errors: [],
  };

  try {
    // Get workspace to determine embedding model
    const workspace = await prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      throw new Error(`Workspace ${payload.workspaceId} not found`);
    }

    const metadata = workspace.metadata as Record<string, any> | undefined;
    const embeddingModel = getWorkspaceEmbeddingModel(metadata);
    const newDimension =
      metadata?.embeddingDimensions ||
      parseInt(process.env.EMBEDDING_MODEL_SIZE || "1024", 10);

    result.newDimension = newDimension;

    logger.info(
      `Using embedding model: ${embeddingModel} with dimension ${newDimension}`,
    );

    // Step 1: Drop indexes BEFORE re-embedding (they reference old dimensions)
    if (!dryRun) {
      logger.info("Dropping HNSW indexes before re-embedding...");
      await dropIndexes();
    } else {
      logger.info(`[DRY RUN] Would drop HNSW indexes`);
    }

    // Step 2: Re-embed all data with new model
    // Re-embed statements
    if (!payload.skipStatements) {
      const statementResult = await reembedStatements(
        payload.userId,
        embeddingModel,
        batchSize,
        dryRun,
      );
      result.statementsReembedded = statementResult.reembedded;
      result.errors.push(...statementResult.errors);
    }

    // Re-embed episodes
    if (!payload.skipEpisodes) {
      const episodeResult = await reembedEpisodes(
        payload.userId,
        embeddingModel,
        batchSize,
        dryRun,
      );
      result.episodesReembedded = episodeResult.reembedded;
      result.errors.push(...episodeResult.errors);
    }

    // Re-embed entities
    if (!payload.skipEntities) {
      const entityResult = await reembedEntities(
        payload.userId,
        embeddingModel,
        batchSize,
        dryRun,
      );
      result.entitiesReembedded = entityResult.reembedded;
      result.errors.push(...entityResult.errors);
    }

    // Re-embed compacted sessions
    if (!payload.skipCompactedSessions) {
      const compactedSessionResult = await reembedCompactedSessions(
        payload.userId,
        embeddingModel,
        batchSize,
        dryRun,
      );
      result.compactedSessionsReembedded = compactedSessionResult.reembedded;
      result.errors.push(...compactedSessionResult.errors);
    }

    // Step 3: Create indexes AFTER re-embedding with new dimension
    if (!dryRun) {
      logger.info(
        `Creating HNSW indexes with new dimension ${newDimension}...`,
      );
      await createIndexes(newDimension);
    } else {
      logger.info(
        `[DRY RUN] Would create HNSW indexes with dimension ${newDimension}`,
      );
    }

    if (result.errors.length > 0) {
      result.success = false;
      logger.error(
        `Re-embedding completed with ${result.errors.length} errors`,
      );
    } else {
      logger.info("Re-embedding completed successfully", {
        statementsReembedded: result.statementsReembedded,
        episodesReembedded: result.episodesReembedded,
        entitiesReembedded: result.entitiesReembedded,
        compactedSessionsReembedded: result.compactedSessionsReembedded,
        newDimension: result.newDimension,
      });
    }

    return result;
  } catch (error) {
    logger.error("Fatal error during re-embedding", {
      error: getErrorMessage(error),
    });
    result.success = false;
    result.errors.push(getErrorMessage(error));
    return result;
  }
}
