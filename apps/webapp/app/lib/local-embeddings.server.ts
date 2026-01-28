import { pipeline, env } from "@huggingface/transformers";

// Configure to use local cache
env.cacheDir = process.env.LOCAL_EMBEDDING_CACHE_DIR || "./.cache/transformers";

// Singleton extractor instances per model
const extractors: Map<string, any> = new Map();

export const LOCAL_EMBEDDING_MODELS = {
  "all-minilm": { id: "Xenova/all-MiniLM-L6-v2", dimensions: 384 },
  "nomic-embed-text": { id: "nomic-ai/nomic-embed-text-v1.5", dimensions: 768 },
  "bge-small": { id: "Xenova/bge-small-en-v1.5", dimensions: 384 },
  "gte-small": { id: "Xenova/gte-small", dimensions: 384 },
} as const;

export type LocalEmbeddingModelKey = keyof typeof LOCAL_EMBEDDING_MODELS;

export function isLocalEmbeddingModel(model: string): model is LocalEmbeddingModelKey {
  return model in LOCAL_EMBEDDING_MODELS;
}

export function getLocalModelDimensions(model: LocalEmbeddingModelKey): number {
  return LOCAL_EMBEDDING_MODELS[model].dimensions;
}

async function getExtractor(modelId: string): Promise<any> {
  if (!extractors.has(modelId)) {
    console.log(`[LocalEmbeddings] Loading model: ${modelId}`);
    const extractor = await pipeline("feature-extraction", modelId);
    extractors.set(modelId, extractor);
    console.log(`[LocalEmbeddings] Model loaded: ${modelId}`);
  }
  return extractors.get(modelId);
}

export async function getLocalEmbedding(
  text: string,
  model: LocalEmbeddingModelKey = "all-minilm"
): Promise<number[]> {
  const modelConfig = LOCAL_EMBEDDING_MODELS[model];
  const extractor = await getExtractor(modelConfig.id);

  const response = await extractor([text], {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(response.data) as number[];
}

export async function getLocalEmbeddingBatch(
  texts: string[],
  model: LocalEmbeddingModelKey = "all-minilm"
): Promise<number[][]> {
  const modelConfig = LOCAL_EMBEDDING_MODELS[model];
  const extractor = await getExtractor(modelConfig.id);

  const results: number[][] = [];

  // Process in batches to avoid memory issues
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });

    // Extract embeddings from response
    const dimensions = modelConfig.dimensions;
    for (let j = 0; j < batch.length; j++) {
      const start = j * dimensions;
      const embedding = Array.from(response.data.slice(start, start + dimensions)) as number[];
      results.push(embedding);
    }
  }

  return results;
}
