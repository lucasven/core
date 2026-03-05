import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SearchService } from "~/services/search.server";
import { json } from "@remix-run/node";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { prisma } from "~/db.server";
import { getWorkspaceEmbeddingModel } from "~/lib/model.server";

export const SearchBodyRequest = z.object({
  query: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),

  // These are not supported yet, but need to support these
  labelIds: z.array(z.string()).default([]),
  limit: z.number().optional(),
  maxBfsDepth: z.number().optional(),
  includeInvalidated: z.boolean().optional(),
  entityTypes: z.array(z.string()).optional(),
  scoreThreshold: z.number().optional(),
  minResults: z.number().optional(),
  adaptiveFiltering: z.boolean().default(true),
  structured: z.boolean().default(true),
  sortBy: z.enum(["relevance", "recency"]).optional(),
  broadSearch: z.boolean().default(false), // Enable broad search mode for more comprehensive results
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: SearchBodyRequest,
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    // Fetch workspace to get embedding model configuration and search settings
    const workspace = authentication.workspaceId
      ? await prisma.workspace.findUnique({
          where: { id: authentication.workspaceId },
          select: { metadata: true },
        })
      : null;
    const metadata = workspace?.metadata as
      | Record<string, any>
      | undefined;
    const embeddingModel = getWorkspaceEmbeddingModel(metadata);

    // Extract workspace search settings
    const workspaceSettings = {
      searchLimit: metadata?.searchLimit,
      scoreThreshold: metadata?.scoreThreshold,
      broadSearch: metadata?.broadSearch,
      maxBfsDepth: metadata?.maxBfsDepth,
      includeInvalidated: metadata?.includeInvalidated,
      useLLMValidation: metadata?.useLLMValidation,
    };

    const searchService = new SearchService({
      embeddingModel,
      workspaceSettings,
    });

    const results = await searchService.search(
      body.query,
      authentication.userId,
      authentication.workspaceId!,
      {
        startTime: body.startTime ? new Date(body.startTime) : undefined,
        endTime: body.endTime ? new Date(body.endTime) : undefined,
        limit: body.limit,
        maxBfsDepth: body.maxBfsDepth,
        includeInvalidated: body.includeInvalidated,
        entityTypes: body.entityTypes,
        scoreThreshold: body.scoreThreshold,
        minResults: body.minResults,
        labelIds: body.labelIds,
        adaptiveFiltering: body.adaptiveFiltering,
        structured: body.structured,
        sortBy: body.sortBy,
        broadSearch: body.broadSearch,
      },
    );

    // Track search
    trackFeatureUsage("search_performed", authentication.userId).catch(
      console.error,
    );

    return json(results);
  },
);

export { action, loader };
