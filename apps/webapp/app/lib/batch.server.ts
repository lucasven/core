import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
  type BatchResponse,
} from "./batch/types";
import { OpenAIBatchProvider } from "./batch/providers/openai";
import { AnthropicBatchProvider } from "./batch/providers/anthropic";
import { logger } from "~/services/logger.service";
import { generateObject } from "ai";
import { getModel } from "./model.server";
import { type CoreMessage } from "ai";

// Global provider instances (singleton pattern)
let openaiProvider: OpenAIBatchProvider | null = null;
let anthropicProvider: AnthropicBatchProvider | null = null;

// In-memory store for sequential batch results
const sequentialBatchStore = new Map<string, BatchJob>();

function isOpenRouterModel(modelId: string): boolean {
  return modelId.includes("/");
}

function getProvider(modelId: string) {
  // OpenAI models
  if (modelId.includes("gpt") || modelId.includes("o1")) {
    if (!openaiProvider) {
      openaiProvider = new OpenAIBatchProvider();
    }
    return openaiProvider;
  }

  // Anthropic models
  if (modelId.includes("claude")) {
    if (!anthropicProvider) {
      anthropicProvider = new AnthropicBatchProvider();
    }
    return anthropicProvider;
  }

  throw new Error(`No batch provider available for model: ${modelId}`);
}

/**
 * Process batch requests sequentially for models that don't support batch API (e.g. OpenRouter).
 * Mimics the batch API interface so callers don't need to change.
 */
async function processSequentialBatch<T = any>(
  params: CreateBatchParams<T>,
  modelId: string,
): Promise<{ batchId: string }> {
  const batchId = `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Store initial batch status
  sequentialBatchStore.set(batchId, {
    batchId,
    status: "processing",
    totalRequests: params.requests.length,
    completedRequests: 0,
    failedRequests: 0,
    createdAt: new Date(),
    results: [],
  });

  // Process all requests sequentially in the background
  (async () => {
    const results: BatchResponse[] = [];
    let completed = 0;
    let failed = 0;

    const model = getModel(modelId);

    for (const request of params.requests) {
      try {
        const messages: CoreMessage[] = [];
        if (request.systemPrompt) {
          messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...(request.messages as CoreMessage[]));

        if (params.outputSchema) {
          const { object } = await generateObject({
            model,
            messages,
            schema: params.outputSchema,
          });
          results.push({ customId: request.customId, response: object as T });
        } else {
          // Text generation fallback
          const { generateText } = await import("ai");
          const { text } = await generateText({ model, messages });
          results.push({
            customId: request.customId,
            response: { content: text } as any,
          });
        }
        completed++;
      } catch (error: any) {
        failed++;
        results.push({
          customId: request.customId,
          error: {
            code: "api_error",
            message: error.message || "Unknown error",
            type: "api_error",
          },
        });
        logger.warn(
          `Sequential batch request ${request.customId} failed: ${error.message}`,
        );
      }

      // Update progress
      const batch = sequentialBatchStore.get(batchId);
      if (batch) {
        batch.completedRequests = completed;
        batch.failedRequests = failed;
        batch.results = results;
      }
    }

    // Mark as completed
    const batch = sequentialBatchStore.get(batchId);
    if (batch) {
      batch.status = "completed";
      batch.completedAt = new Date();
      batch.results = results;
    }
  })();

  return { batchId };
}

/**
 * Create a new batch job for multiple AI requests
 * Similar to makeModelCall but for batch processing.
 * Falls back to sequential processing for OpenRouter models.
 */
export async function createBatch<T = any>(params: CreateBatchParams<T>) {
  try {
    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

    // OpenRouter models: process sequentially
    if (isOpenRouterModel(modelId)) {
      logger.info(
        `Using sequential processing for OpenRouter model ${modelId} (${params.requests.length} requests)`,
      );
      return await processSequentialBatch(params, modelId);
    }

    const provider = getProvider(modelId);
    logger.info(
      `Creating batch with ${provider.providerName} provider for model ${modelId}`,
    );

    return await provider.createBatch(params);
  } catch (error) {
    logger.error("Batch creation failed:", { error });
    throw error;
  }
}

/**
 * Get the status and results of a batch job
 */
export async function getBatch<T = any>(
  params: GetBatchParams,
): Promise<BatchJob> {
  try {
    // Check sequential batch store first
    if (params.batchId.startsWith("seq-")) {
      const batch = sequentialBatchStore.get(params.batchId);
      if (!batch) {
        throw new Error(`Sequential batch not found: ${params.batchId}`);
      }
      // Clean up completed batches after retrieval
      if (batch.status === "completed" || batch.status === "failed") {
        sequentialBatchStore.delete(params.batchId);
      }
      return batch;
    }

    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

    const provider = getProvider(modelId);
    return await provider.getBatch<T>(params);
  } catch (error) {
    logger.error("Failed to get batch:", { error });
    throw error;
  }
}

/**
 * Cancel a running batch job (if supported by provider)
 */
export async function cancelBatch(
  params: GetBatchParams,
): Promise<{ success: boolean }> {
  try {
    // Sequential batches can't be cancelled
    if (params.batchId.startsWith("seq-")) {
      return { success: false };
    }

    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

    const provider = getProvider(modelId);
    if (provider.cancelBatch) {
      return await provider.cancelBatch(params);
    }

    logger.warn(
      `Cancel batch not supported by ${provider.providerName} provider`,
    );
    return { success: false };
  } catch (error) {
    logger.error("Failed to cancel batch:", { error });
    return { success: false };
  }
}

/**
 * Utility function to create batch requests from simple text prompts
 */
export function createBatchRequests(
  prompts: Array<{ customId: string; prompt: string; systemPrompt?: string }>,
) {
  return prompts.map(({ customId, prompt, systemPrompt }) => ({
    customId,
    messages: [{ role: "user" as const, content: prompt }],
    systemPrompt,
  }));
}

/**
 * Get all supported models for batch processing
 */
export function getSupportedBatchModels() {
  const models: Record<string, string[]> = {};

  if (process.env.OPENAI_API_KEY) {
    models.openai = new OpenAIBatchProvider().supportedModels;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    models.anthropic = new AnthropicBatchProvider().supportedModels;
  }

  return models;
}

// Export types for use in other modules
export type {
  CreateBatchParams,
  GetBatchParams,
  BatchJob,
  BatchRequest,
  BatchResponse,
  BatchError,
  BatchStatus,
} from "./batch/types";
