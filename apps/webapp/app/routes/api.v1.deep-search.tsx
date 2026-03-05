import { z } from "zod";
import { json } from "@remix-run/node";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { trackFeatureUsage } from "~/services/telemetry.server";

import {
  generateText,
  type LanguageModel,
  streamText,
} from "ai";
import { logger } from "~/services/logger.service";
import { getModel, getWorkspaceChatModel } from "~/lib/model.server";
import { searchMemoryWithAgent } from "~/services/agent/memory";
import { getErrorMessage } from "~/utils/errors";
import { prisma } from "~/db.server";

const DeepSearchBodySchema = z.object({
  content: z.string().min(1, "Content is required"),
  intentOverride: z.string().optional(),
  stream: z.boolean().default(false),
  metadata: z
    .object({
      source: z.enum(["chrome", "obsidian", "mcp"]).optional(),
      url: z.string().optional(),
      pageTitle: z.string().optional(),
    })
    .optional(),
});

const { action, loader } = createActionApiRoute(
  {
    body: DeepSearchBodySchema,
    method: "POST",
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    // Track deep search
    trackFeatureUsage("deep_search_performed", authentication.userId).catch(
      console.error,
    );

    try {
      // Fetch workspace to get model configuration
      const workspace = authentication.workspaceId
        ? await prisma.workspace.findUnique({
            where: { id: authentication.workspaceId },
            select: { metadata: true },
          })
        : null;
      const chatModel = getWorkspaceChatModel(
        workspace?.metadata as { model?: string } | undefined,
      );

      // First, search for relevant information
      const results = await searchMemoryWithAgent(
        body.content,
        authentication.userId,
        authentication.workspaceId!,
        body.metadata?.source || "api",
        {
          limit: 10,
        }
      );

      // Extract only episodes and invalidated facts
      const episodes = results.episodes || [];
      const invalidatedFacts = results.invalidatedFacts || [];

      // Create a prompt with the search results
      const systemPrompt = `You are a helpful assistant that summarizes and synthesizes information from the user's memory.

CRITICAL RULES:
1. ONLY use information provided within the <memory></memory> tags
2. NEVER hallucinate or add information not present in the memory
3. If the memory doesn't contain enough information to fully answer the question, acknowledge what's missing
4. Be concise but preserve all important context and details
${body.intentOverride ? `Intent: ${body.intentOverride}` : ""}`;

      const userPrompt = `Answer the following question using ONLY the information provided in the memory below.

QUESTION: ${body.content}

<memory>
${episodes.length > 0 ? `EPISODES:\n${episodes.map((e: any) => `- ${e.content || e.text || JSON.stringify(e)}`).join("\n")}\n` : ""}
${invalidatedFacts.length > 0 ? `INVALIDATED FACTS (outdated information):\n${invalidatedFacts.map((f: any) => `- ${f.content || f.text || JSON.stringify(f)}`).join("\n")}\n` : ""}
</memory>

Provide a clear, helpful summary based ONLY on the memory above. Do not add any information not present in the memory.`;

      if (body.stream) {
        const result = streamText({
          model: getModel(chatModel) as LanguageModel,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        });

        return result.toUIMessageStreamResponse({});
      } else {
        const { text } = await generateText({
          model: getModel(chatModel) as LanguageModel,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        });


        return json({ text });
      }
    } catch (error) {
      logger.error(`Deep search error: ${getErrorMessage(error)}`, { error });

      return json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

export { action, loader };
