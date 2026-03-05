import {
  embed,
  generateText,
  generateObject,
  streamText,
  type ModelMessage,
} from "ai";
import { type z } from "zod";
import {
  createOpenAI,
  openai,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";

import { createOllama } from "ollama-ai-provider-v2";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import {
  getLocalEmbedding,
  isLocalEmbeddingModel,
  LOCAL_EMBEDDING_MODELS,
  type LocalEmbeddingModelKey,
} from "./local-embeddings.server";

export type ModelComplexity = "high" | "low";

/**
 * Get the appropriate model for a given complexity level.
 * HIGH complexity uses the configured MODEL.
 * LOW complexity automatically downgrades to cheaper variants if possible.
 */
export function getModelForTask(complexity: ModelComplexity = "high"): string {
  // Smart default: use OpenRouter format if OpenRouter key is available
  const defaultModel = process.env.OPENROUTER_API_KEY
    ? "openai/gpt-4.1"
    : "gpt-4.1-2025-04-14";
  const baseModel = process.env.MODEL || defaultModel;

  // HIGH complexity - always use the configured model
  if (complexity === "high") {
    return baseModel;
  }

  // LOW complexity - automatically downgrade expensive models to cheaper variants
  // If already using a cheap model, keep it
  const downgrades: Record<string, string> = {
    // OpenAI downgrades
    "gpt-5.2-2025-12-11": "gpt-5-mini-2025-08-07",
    "gpt-5.1-2025-11-13": "gpt-5-mini-2025-08-07",
    "gpt-5-2025-08-07": "gpt-5-mini-2025-08-07",
    "gpt-4.1-2025-04-14": "gpt-4.1-mini-2025-04-14",

    // Anthropic downgrades
    "claude-sonnet-4-5": "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219": "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229": "claude-3-5-haiku-20241022",

    // Google downgrades
    "gemini-2.5-pro-preview-03-25": "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash": "gemini-2.0-flash-lite",

    // AWS Bedrock downgrades (keep same model - already cost-optimized)
    "us.amazon.nova-premier-v1:0": "us.amazon.nova-premier-v1:0",

    // OpenRouter downgrades
    "deepseek/deepseek-chat-v3": "deepseek/deepseek-chat-v3", // already cheap
    "deepseek/deepseek-reasoner": "deepseek/deepseek-chat-v3",
    "meta-llama/llama-3.3-70b-instruct": "meta-llama/llama-3.1-8b-instruct",
    "mistral/mistral-large-latest": "mistral/mistral-small-latest",
    "google/gemini-2.0-flash-001": "google/gemini-2.0-flash-lite-001",
    "anthropic/claude-sonnet-4": "anthropic/claude-3-5-haiku",
    "openai/gpt-4.1": "openai/gpt-4.1-mini",
    "openai/gpt-4.1-mini": "openai/gpt-5-nano",
    "openai/gpt-5-nano": "openai/gpt-5-nano", // already cheap
    "google/gemini-3-flash-preview": "google/gemini-2.0-flash-lite-001",
  };

  return downgrades[baseModel] || baseModel;
}

/**
 * Get the model to use for batch API calls.
 * Some models (e.g. gpt-5.2) don't work well with batch API,
 * so we downgrade to a known-working variant.
 */
export function getModelForBatch(): string {
  const baseModel = process.env.MODEL || "gpt-4.1-2025-04-14";

  const batchDowngrades: Record<string, string> = {
    "gpt-5.2-2025-12-11": "gpt-5-2025-08-07",
    "gpt-5.1-2025-11-13": "gpt-5-2025-08-07",
  };

  return batchDowngrades[baseModel] || baseModel;
}

export const getModel = (takeModel?: string) => {
  let model = takeModel;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  let ollamaUrl = process.env.OLLAMA_URL;
  model = model || process.env.MODEL || "gpt-4.1-2025-04-14";

  let modelInstance;
  let modelTemperature = Number(process.env.MODEL_TEMPERATURE) || 1;
  ollamaUrl = undefined;

  // First check if Ollama URL exists and use Ollama
  if (ollamaUrl) {
    const ollama = createOllama({
      baseURL: ollamaUrl,
    });
    modelInstance = ollama(model || "llama2"); // Default to llama2 if no model specified
  } else {
    // If no Ollama, check other models

    // Check for OpenRouter models (format: provider/model, e.g., deepseek/deepseek-chat-v3)
    if (model.includes("/")) {
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) {
        throw new Error("No OpenRouter API key found. Set OPENROUTER_API_KEY");
      }
      const openrouter = createOpenRouter({ apiKey: openrouterKey });
      return openrouter.chat(model);
    }

    if (model.includes("claude")) {
      if (!anthropicKey) {
        throw new Error("No Anthropic API key found. Set ANTHROPIC_API_KEY");
      }
      modelInstance = anthropic(model);
      modelTemperature = 0.5;
    } else if (model.includes("gemini")) {
      if (!googleKey) {
        throw new Error("No Google API key found. Set GOOGLE_API_KEY");
      }
      modelInstance = google(model);
    } else {
      if (!openaiKey) {
        throw new Error("No OpenAI API key found. Set OPENAI_API_KEY");
      }
      modelInstance = openai.responses(model);
    }

    return modelInstance;
  }
};

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export async function makeModelCall(
  stream: boolean,
  messages: ModelMessage[],
  onFinish: (text: string, model: string, usage?: TokenUsage) => void,
  options?: any,
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  reasoningEffort?: "low" | "medium" | "high",
) {
  let model = getModelForTask(complexity);
  logger.info(`complexity: ${complexity}, model: ${model}`);

  const modelInstance = getModel(model);
  const generateTextOptions: any = {};

  // Add OpenAI provider options for prompt caching and disable web search
  // Only for direct OpenAI models, NOT OpenRouter (which doesn't support these options)
  if (model.includes("gpt") && !model.includes("/")) {
    const openaiOptions: OpenAIResponsesProviderOptions = {
      promptCacheKey: cacheKey || `ingestion-${complexity}`,
    };

    // 24h retention and reasoning options only available for non-mini gpt-5 models
    if (model.startsWith("gpt-5")) {
      if (model.includes("mini")) {
        openaiOptions.reasoningEffort = "low";
      } else {
        openaiOptions.promptCacheRetention = "24h";
        openaiOptions.reasoningEffort = "none";
        if (reasoningEffort) {
          openaiOptions.reasoningEffort = reasoningEffort;
        }
      }
    }

    generateTextOptions.providerOptions = {
      openai: openaiOptions,
    };
  }

  if (!modelInstance) {
    throw new Error(`Unsupported model type: ${model}`);
  }

  if (stream) {
    return streamText({
      model: modelInstance,
      messages,
      ...options,
      ...generateTextOptions,
      onFinish: async ({ text, usage }) => {
        const tokenUsage = usage
          ? {
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined;

        if (tokenUsage) {
          logger.log(
            `[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens})`,
          );
        }

        onFinish(text, model, tokenUsage);
      },
    });
  }

  const { text, usage } = await generateText({
    model: modelInstance,
    messages,
    ...generateTextOptions,
  });

  const tokenUsage = usage
    ? {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
      }
    : undefined;

  if (tokenUsage) {
    logger.log(
      `[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens}, cached: ${tokenUsage.cachedInputTokens})`,
    );
  }

  onFinish(text, model, tokenUsage);

  return text;
}

/**
 * Make a model call that returns structured data using a Zod schema.
 * Uses AI SDK's generateObject for guaranteed structured output.
 */
export async function makeStructuredModelCall<T extends z.ZodType>(
  schema: T,
  messages: ModelMessage[],
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  temperature?: number,
): Promise<{ object: z.infer<T>; usage: TokenUsage | undefined }> {
  const model = getModelForTask(complexity);
  logger.info(`[Structured] complexity: ${complexity}, model: ${model}`);

  const modelInstance = getModel(model);
  const generateObjectOptions: any = {};

  if (temperature !== undefined) {
    generateObjectOptions.temperature = temperature;
  }

  // Add OpenAI provider options for prompt caching
  // Only for direct OpenAI models, NOT OpenRouter (which doesn't support these options)
  if (model.includes("gpt") && !model.includes("/")) {
    const openaiOptions: OpenAIResponsesProviderOptions = {
      promptCacheKey: cacheKey || `structured-${complexity}`,
      strictJsonSchema: false,
    };

    if (model.startsWith("gpt-5")) {
      if (model.includes("mini")) {
        openaiOptions.reasoningEffort = "low";
      } else {
        openaiOptions.promptCacheRetention = "24h";
        openaiOptions.reasoningEffort = "none";
      }
    }

    generateObjectOptions.providerOptions = {
      openai: openaiOptions,
    };
  }

  if (!modelInstance) {
    throw new Error(`Unsupported model type: ${model}`);
  }

  const { object, usage } = await generateObject({
    model: modelInstance,
    schema,
    messages,
    ...generateObjectOptions,
  });

  const tokenUsage = usage
    ? {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
      }
    : undefined;

  if (tokenUsage) {
    logger.log(
      `[Structured/${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens}, cached: ${tokenUsage.cachedInputTokens})`,
    );
  }

  return { object: object as any, usage: tokenUsage };
}

/**
 * Determines if a given model is proprietary (OpenAI, Anthropic, Google, Grok)
 * or open source (accessed via Bedrock, Ollama, etc.)
 */
export function isProprietaryModel(
  modelName?: string,
  complexity: ModelComplexity = "high",
): boolean {
  const model = modelName || getModelForTask(complexity);
  if (!model) return false;

  // OpenRouter models - check the model part after provider/
  if (model.includes("/")) {
    const modelPart = model.split("/")[1] || "";
    // Open source models on OpenRouter
    const openSourcePatterns = [
      /^llama/,
      /^mistral/,
      /^deepseek/,
      /^qwen/,
      /^phi/,
    ];
    return !openSourcePatterns.some((pattern) => pattern.test(modelPart));
  }

  // Direct API proprietary patterns
  const proprietaryPatterns = [
    /^gpt-/, // OpenAI models
    /^claude-/, // Anthropic models
    /^gemini-/, // Google models
    /^grok-/, // xAI models
  ];

  return proprietaryPatterns.some((pattern) => pattern.test(model));
}

/**
 * Task types that can have per-task model configuration.
 */
export type TaskType =
  | "normalization"
  | "entityExtraction"
  | "statementExtraction"
  | "sessionCompaction"
  | "titleGeneration"
  | "labelAssignment";

/**
 * Get the model for a specific task type, respecting workspace overrides.
 * Falls back to: taskModels[taskType] -> workspace model -> env MODEL -> default
 */
export function getModelForTaskType(
  taskType: TaskType,
  workspaceMetadata?: {
    taskModels?: Partial<Record<TaskType, string>>;
    model?: string;
  },
  complexity: ModelComplexity = "high",
): string {
  // Check task-specific override first
  if (workspaceMetadata?.taskModels?.[taskType]) {
    return workspaceMetadata.taskModels[taskType]!;
  }

  // Fall back to workspace default model
  if (workspaceMetadata?.model) {
    return workspaceMetadata.model;
  }

  // Fall back to complexity-based routing
  return getModelForTask(complexity);
}

/**
 * Get the chat model configuration from workspace metadata or environment.
 * This helper allows callers with workspace context to use workspace-specific models.
 */
export function getWorkspaceChatModel(workspaceMetadata?: {
  model?: string;
}): string {
  if (workspaceMetadata?.model) {
    return workspaceMetadata.model;
  }

  if (process.env.MODEL) {
    return process.env.MODEL;
  }

  // Smart default: use OpenRouter format if OpenRouter key is available,
  // otherwise fall back to OpenAI format (requires OPENAI_API_KEY)
  if (process.env.OPENROUTER_API_KEY) {
    return "openai/gpt-4.1";
  }

  return "gpt-4.1-2025-04-14";
}

/**
 * Get the embedding model configuration from workspace metadata or environment.
 * This helper allows callers with workspace context to pass the model to getEmbedding.
 */
export function getWorkspaceEmbeddingModel(workspaceMetadata?: {
  embeddingModel?: string;
}): string {
  if (workspaceMetadata?.embeddingModel) {
    return workspaceMetadata.embeddingModel;
  }

  if (process.env.EMBEDDING_MODEL) {
    return process.env.EMBEDDING_MODEL;
  }

  // Smart default: use OpenRouter format if OpenRouter key is available,
  // otherwise fall back to OpenAI format (requires OPENAI_API_KEY)
  if (process.env.OPENROUTER_API_KEY) {
    return "openai/text-embedding-3-small";
  }

  return "text-embedding-3-small";
}

/**
 * Generate embeddings for text.
 * @param text The text to embed
 * @param embeddingModel Optional embedding model to use (from workspace settings)
 *                       If not provided, falls back to EMBEDDING_MODEL env var
 */
export async function getEmbedding(text: string, embeddingModel?: string) {
  const ollamaUrl = process.env.OLLAMA_URL;
  const model = embeddingModel || process.env.EMBEDDING_MODEL;
  const maxRetries = 3;
  const maxDimensions = parseInt(process.env.EMBEDDING_MODEL_SIZE || "2000", 10);
  let lastEmbedding: number[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Local embeddings (free, runs in Node.js via @huggingface/transformers)
      if (model && isLocalEmbeddingModel(model)) {
        logger.info(`[LocalEmbeddings] Using local model: ${model}`);
        lastEmbedding = await getLocalEmbedding(text, model);
        if (lastEmbedding.length > 0) {
          return lastEmbedding;
        }
        if (attempt < maxRetries) {
          logger.warn(
            `Attempt ${attempt}/${maxRetries}: Got empty local embedding, retrying...`,
          );
        }
        continue;
      }

      // OpenRouter embeddings (format: provider/model, e.g., openai/text-embedding-3-small)
      if (model?.includes("/")) {
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterKey) {
          throw new Error(
            "No OpenRouter API key found for embeddings. Set OPENROUTER_API_KEY",
          );
        }
        // Use OpenAI-compatible client pointed at OpenRouter's API
        // This avoids @openrouter/ai-sdk-provider's v2 spec compatibility issues
        // that cause empty embeddings with some models (e.g., Qwen3)
        const openrouterClient = createOpenAI({
          apiKey: openrouterKey,
          baseURL: "https://openrouter.ai/api/v1",
        });
        const { embedding } = await embed({
          model: openrouterClient.embedding(model),
          value: text,
        });
        lastEmbedding = embedding;
      } else if (
        model === "text-embedding-3-small" ||
        model === "text-embedding-3-large" ||
        model === "text-embedding-ada-002"
      ) {
        // Use OpenAI embedding model when explicitly requested
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          throw new Error(
            `No OpenAI API key found for embedding model "${model}". Set OPENAI_API_KEY or use OpenRouter format (e.g., openai/text-embedding-3-small)`,
          );
        }
        const { embedding } = await embed({
          model: openai.embedding(model),
          value: text,
        });
        lastEmbedding = embedding;
      } else {
        // Ollama embeddings (local models like mxbai-embed-large)
        if (!ollamaUrl) {
          throw new Error(
            `No Ollama URL found for embedding model "${model}". Set OLLAMA_URL or use a different embedding model`,
          );
        }
        const ollama = createOllama({
          baseURL: ollamaUrl,
        });
        const { embedding } = await embed({
          model: ollama.embedding(model as string),
          value: text,
        });
        lastEmbedding = embedding;
      }

      // If embedding is not empty, truncate (MRL) and return
      if (lastEmbedding.length > 0) {
        return truncateEmbedding(lastEmbedding, maxDimensions);
      }

      // If empty, log and retry (unless it's the last attempt)
      if (attempt < maxRetries) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries}: Got empty embedding, retrying...`,
        );
      }
    } catch (error) {
      logger.error(
        `Embedding attempt ${attempt}/${maxRetries} failed: ${error}`,
      );
    }
  }

  // Return last embedding even if empty after all retries
  logger.warn(
    `All ${maxRetries} attempts returned empty embedding, returning last response`,
  );
  return truncateEmbedding(lastEmbedding, maxDimensions);
}

/**
 * Truncate embedding to target dimensions using Matryoshka Representation Learning (MRL).
 * Slices to the first N dimensions and re-normalizes to unit length.
 */
function truncateEmbedding(
  embedding: number[],
  maxDimensions: number,
): number[] {
  if (embedding.length <= maxDimensions) {
    return embedding;
  }
  const truncated = embedding.slice(0, maxDimensions);
  // L2 normalize after truncation
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return truncated;
  return truncated.map((v) => v / norm);
}
