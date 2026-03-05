import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "~/components/ui/select";
import { SettingSection } from "~/components/setting-section";
import { prisma } from "~/db.server";
import { Check, Info, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Progress } from "~/components/ui/progress";

// Available chat models grouped by provider
const MODEL_GROUPS = [
  {
    provider: "OpenRouter - Budget",
    description: "Cost-effective models via OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "deepseek/deepseek-chat-v3",
        name: "DeepSeek V3",
        price: "$0.14 / $0.28",
        description: "Best value for most tasks",
      },
      {
        id: "deepseek/deepseek-reasoner",
        name: "DeepSeek R1",
        price: "$0.55 / $2.19",
        description: "Advanced reasoning capabilities",
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B",
        price: "$0.10 / $0.30",
        description: "Open source, fast inference",
      },
      {
        id: "mistral/mistral-large-latest",
        name: "Mistral Large",
        price: "$2.00 / $6.00",
        description: "Strong multilingual support",
      },
    ],
  },
  {
    provider: "OpenRouter - Premium",
    description: "Premium models via OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        price: "$3.00 / $15.00",
        description: "Best for coding and analysis",
      },
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        price: "$2.00 / $8.00",
        description: "OpenAI's latest model",
      },
      {
        id: "google/gemini-2.0-flash-001",
        name: "Gemini 2.0 Flash",
        price: "$0.10 / $0.40",
        description: "Fast and capable",
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        price: "$0.50 / $3.00",
        description: "High-speed thinking model for agentic workflows",
      },
      {
        id: "openai/gpt-5-nano",
        name: "GPT-5 Nano",
        price: "$0.05 / $0.40",
        description: "Ultra-fast, cheapest GPT-5 variant",
      },
      {
        id: "openai/gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        price: "$0.40 / $1.60",
        description: "Cost-effective GPT-4.1 variant",
      },
    ],
  },
  {
    provider: "OpenAI Direct",
    description: "Direct OpenAI API access",
    requiresKey: "OPENAI_API_KEY",
    models: [
      {
        id: "gpt-4.1-2025-04-14",
        name: "GPT-4.1",
        price: "$2.00 / $8.00",
        description: "Latest GPT-4 model",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        price: "$2.50 / $10.00",
        description: "Optimized for speed",
      },
      {
        id: "gpt-4.1-mini-2025-04-14",
        name: "GPT-4.1 Mini",
        price: "$0.40 / $1.60",
        description: "Cost-effective option",
      },
    ],
  },
  {
    provider: "Anthropic Direct",
    description: "Direct Anthropic API access",
    requiresKey: "ANTHROPIC_API_KEY",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        price: "$3.00 / $15.00",
        description: "Best for coding tasks",
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        price: "$0.80 / $4.00",
        description: "Fast and efficient",
      },
    ],
  },
  {
    provider: "Google Direct",
    description: "Direct Google AI API access",
    requiresKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: [
      {
        id: "gemini-2.5-pro-preview-03-25",
        name: "Gemini 2.5 Pro",
        price: "$1.25 / $5.00",
        description: "Most capable Gemini",
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        price: "$0.10 / $0.40",
        description: "Fast inference",
      },
    ],
  },
];

// Available embedding models from OpenRouter
// See: https://openrouter.ai/models?fmt=table&output_modalities=embeddings
const EMBEDDING_MODEL_GROUPS = [
  {
    provider: "Local (Free)",
    description: "Runs locally in Node.js - no API costs",
    requiresKey: null, // Always available
    models: [
      {
        id: "all-minilm",
        name: "All-MiniLM-L6-v2",
        dimensions: 384,
        price: "Free",
        description: "Fast and efficient, good quality for most use cases",
      },
      {
        id: "nomic-embed-text",
        name: "Nomic Embed Text v1.5",
        dimensions: 768,
        price: "Free",
        description: "Higher quality embeddings, larger model",
      },
      {
        id: "bge-small",
        name: "BGE Small EN v1.5",
        dimensions: 384,
        price: "Free",
        description: "Optimized for English, balanced performance",
      },
      {
        id: "gte-small",
        name: "GTE Small",
        dimensions: 384,
        price: "Free",
        description: "General text embeddings, efficient",
      },
    ],
  },
  {
    provider: "OpenRouter - Premium",
    description: "High-quality embedding models",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "openai/text-embedding-3-small",
        name: "OpenAI Text Embedding 3 Small",
        dimensions: 1536,
        price: "$0.02",
        description: "Best balance of quality and cost, 8K context",
      },
      {
        id: "openai/text-embedding-3-large",
        name: "OpenAI Text Embedding 3 Large",
        dimensions: 2000,
        price: "$0.13",
        description: "Highest quality OpenAI embeddings, 8K context (MRL truncated from 3072)",
      },
      {
        id: "openai/text-embedding-ada-002",
        name: "OpenAI Ada 002",
        dimensions: 1536,
        price: "$0.10",
        description: "Legacy OpenAI model, 8K context",
      },
      {
        id: "google/gemini-embedding-001",
        name: "Gemini Embedding 001",
        dimensions: 768,
        price: "$0.15",
        description: "Top MTEB multilingual, 20K context",
      },
      {
        id: "mistralai/mistral-embed-2312",
        name: "Mistral Embed",
        dimensions: 1024,
        price: "$0.10",
        description: "Optimized for semantic search, 8K context",
      },
      {
        id: "mistralai/codestral-embed-2505",
        name: "Codestral Embed",
        dimensions: 1024,
        price: "$0.15",
        description: "Specialized for code embeddings, 8K context",
      },
    ],
  },
  {
    provider: "OpenRouter - Qwen",
    description: "Qwen embedding models with long context",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "qwen/qwen3-embedding-8b",
        name: "Qwen3 Embedding 8B",
        dimensions: 2000,
        price: "$0.01",
        description: "Best quality Qwen, 32K context (MRL truncated from 4096)",
      },
      {
        id: "qwen/qwen3-embedding-4b",
        name: "Qwen3 Embedding 4B",
        dimensions: 2000,
        price: "$0.02",
        description: "Balanced quality/speed, 32K context",
      },
    ],
  },
  {
    provider: "OpenRouter - Budget",
    description: "Cost-effective embedding models",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "baai/bge-m3",
        name: "BGE-M3",
        dimensions: 1024,
        price: "$0.01",
        description: "Multilingual, long context 8K",
      },
      {
        id: "baai/bge-large-en-v1.5",
        name: "BGE Large EN v1.5",
        dimensions: 1024,
        price: "$0.01",
        description: "High quality English, 512 context",
      },
      {
        id: "baai/bge-base-en-v1.5",
        name: "BGE Base EN v1.5",
        dimensions: 768,
        price: "$0.005",
        description: "Fast English embeddings, 512 context",
      },
      {
        id: "intfloat/e5-large-v2",
        name: "E5 Large v2",
        dimensions: 1024,
        price: "$0.01",
        description: "High accuracy English, 512 context",
      },
      {
        id: "intfloat/e5-base-v2",
        name: "E5 Base v2",
        dimensions: 768,
        price: "$0.005",
        description: "Efficient English, 512 context",
      },
      {
        id: "intfloat/multilingual-e5-large",
        name: "Multilingual E5 Large",
        dimensions: 1024,
        price: "$0.01",
        description: "90+ languages, 512 context",
      },
      {
        id: "thenlper/gte-large",
        name: "GTE Large",
        dimensions: 1024,
        price: "$0.01",
        description: "General text embeddings, 512 context",
      },
      {
        id: "thenlper/gte-base",
        name: "GTE Base",
        dimensions: 768,
        price: "$0.005",
        description: "Fast general embeddings, 512 context",
      },
    ],
  },
  {
    provider: "OpenRouter - Sentence Transformers",
    description: "Lightweight sentence embedding models",
    requiresKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "sentence-transformers/all-mpnet-base-v2",
        name: "all-mpnet-base-v2",
        dimensions: 768,
        price: "$0.005",
        description: "Best quality sentence transformer, 512 context",
      },
      {
        id: "sentence-transformers/multi-qa-mpnet-base-dot-v1",
        name: "multi-qa-mpnet-base-dot-v1",
        dimensions: 768,
        price: "$0.005",
        description: "Optimized for QA retrieval, 512 context",
      },
      {
        id: "sentence-transformers/all-minilm-l12-v2",
        name: "all-MiniLM-L12-v2",
        dimensions: 384,
        price: "$0.005",
        description: "Good quality, fast, 512 context",
      },
      {
        id: "sentence-transformers/all-minilm-l6-v2",
        name: "all-MiniLM-L6-v2",
        dimensions: 384,
        price: "$0.005",
        description: "Fastest, lowest cost, 512 context",
      },
      {
        id: "sentence-transformers/paraphrase-minilm-l6-v2",
        name: "paraphrase-MiniLM-L6-v2",
        dimensions: 384,
        price: "$0.005",
        description: "Paraphrase detection, 512 context",
      },
    ],
  },
  {
    provider: "OpenAI Direct",
    description: "Direct OpenAI API access",
    requiresKey: "OPENAI_API_KEY",
    models: [
      {
        id: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
        dimensions: 1536,
        price: "$0.02",
        description: "Recommended for most use cases",
      },
      {
        id: "text-embedding-3-large",
        name: "Text Embedding 3 Large",
        dimensions: 2000,
        price: "$0.13",
        description: "Best quality OpenAI embeddings (MRL truncated from 3072)",
      },
    ],
  },
];

interface EmbeddingCounts {
  statements: number;
  episodes: number;
  entities: number;
  compactedSessions: number;
  total: number;
}

interface LoaderData {
  currentModel: string;
  currentEmbeddingModel: string;
  currentEmbeddingDimensions: number;
  availableKeys: string[];
  embeddingCounts: EmbeddingCounts;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const currentModel =
    (workspace.metadata as any)?.model ||
    process.env.MODEL ||
    "gpt-4.1-2025-04-14";

  const currentEmbeddingModel =
    (workspace.metadata as any)?.embeddingModel ||
    process.env.EMBEDDING_MODEL ||
    "text-embedding-3-small";

  const currentEmbeddingDimensions =
    (workspace.metadata as any)?.embeddingDimensions ||
    parseInt(process.env.EMBEDDING_MODEL_SIZE || "2000", 10);

  // Check which API keys are available
  const availableKeys: string[] = [];
  if (process.env.OPENROUTER_API_KEY) availableKeys.push("OPENROUTER_API_KEY");
  if (process.env.OPENAI_API_KEY) availableKeys.push("OPENAI_API_KEY");
  if (process.env.ANTHROPIC_API_KEY) availableKeys.push("ANTHROPIC_API_KEY");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    availableKeys.push("GOOGLE_GENERATIVE_AI_API_KEY");

  // Get embedding counts
  const [statements, episodes, entities, compactedSessions] = await Promise.all(
    [
      prisma.statementEmbedding.count({ where: { userId: user.id } }),
      prisma.episodeEmbedding.count({ where: { userId: user.id } }),
      prisma.entityEmbedding.count({ where: { userId: user.id } }),
      prisma.compactedSessionEmbedding.count({ where: { userId: user.id } }),
    ],
  );

  return json({
    currentModel,
    currentEmbeddingModel,
    currentEmbeddingDimensions,
    availableKeys,
    embeddingCounts: {
      statements,
      episodes,
      entities,
      compactedSessions,
      total: statements + episodes + entities + compactedSessions,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();
  const actionType = formData.get("_action") as string | null;
  const model = formData.get("model") as string | null;
  const embeddingModel = formData.get("embeddingModel") as string | null;
  const embeddingDimensions = formData.get("embeddingDimensions") as
    | string
    | null;

  // Handle re-embedding action
  if (actionType === "reembed") {
    const { reembedTask } = await import("~/migration/reembed-migration");

    const result = await reembedTask({
      workspaceId: workspace.id,
      userId: user.id,
      batchSize: 50,
    });

    return json({
      success: result.success,
      reembed: true,
      totalReembedded:
        result.statementsReembedded +
        result.episodesReembedded +
        result.entitiesReembedded +
        result.compactedSessionsReembedded,
      errors: result.errors,
    });
  }

  const updates: Record<string, any> = {};

  if (model) {
    updates.model = model;
  }

  if (embeddingModel) {
    updates.embeddingModel = embeddingModel;
    if (embeddingDimensions) {
      updates.embeddingDimensions = parseInt(embeddingDimensions, 10);
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: "No changes provided" }, { status: 400 });
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      metadata: { ...(workspace.metadata as object), ...updates },
    },
  });

  return json({ success: true, ...updates });
};

export default function ModelSettings() {
  const {
    currentModel,
    currentEmbeddingModel,
    currentEmbeddingDimensions,
    availableKeys,
    embeddingCounts,
  } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(
    currentEmbeddingModel,
  );
  const [reembedResult, setReembedResult] = useState<{
    success?: boolean;
    message?: string;
    totalReembedded?: number;
  } | null>(null);

  const isSubmitting = fetcher.state === "submitting";
  const hasModelChanges = selectedModel !== currentModel;
  const hasEmbeddingChanges = selectedEmbeddingModel !== currentEmbeddingModel;

  // Find current model info
  const findModelInfo = (modelId: string) => {
    for (const group of MODEL_GROUPS) {
      const model = group.models.find((m) => m.id === modelId);
      if (model) return { ...model, provider: group.provider };
    }
    return null;
  };

  // Find embedding model info
  const findEmbeddingModelInfo = (modelId: string) => {
    for (const group of EMBEDDING_MODEL_GROUPS) {
      const model = group.models.find((m) => m.id === modelId);
      if (model) return { ...model, provider: group.provider };
    }
    return null;
  };

  const currentModelInfo = findModelInfo(currentModel);
  const currentEmbeddingInfo = findEmbeddingModelInfo(currentEmbeddingModel);
  const selectedEmbeddingInfo = findEmbeddingModelInfo(selectedEmbeddingModel);

  // Filter groups to only show those with available API keys
  const availableGroups = MODEL_GROUPS.filter((group) =>
    availableKeys.includes(group.requiresKey),
  );

  const availableEmbeddingGroups = EMBEDDING_MODEL_GROUPS.filter(
    (group) =>
      group.requiresKey === null || availableKeys.includes(group.requiresKey),
  );

  const handleSaveModel = () => {
    fetcher.submit({ model: selectedModel }, { method: "POST" });
  };

  const handleSaveEmbedding = () => {
    const embeddingInfo = findEmbeddingModelInfo(selectedEmbeddingModel);
    fetcher.submit(
      {
        embeddingModel: selectedEmbeddingModel,
        embeddingDimensions: embeddingInfo?.dimensions?.toString() || "1536",
      },
      { method: "POST" },
    );
  };

  const handleReembed = () => {
    fetcher.submit({ _action: "reembed" }, { method: "POST" });
  };

  // Track reembed state from fetcher
  const isReembeddingFromFetcher =
    fetcher.state !== "idle" && fetcher.formData?.get("_action") === "reembed";

  // Use effect to update reembed result when fetcher completes
  useEffect(() => {
    if (fetcher.state === "idle" && (fetcher.data as any)?.reembed) {
      const data = fetcher.data as any;
      setReembedResult({
        success: data.success,
        message: data.success
          ? `Successfully regenerated embeddings`
          : data.errors?.join(", ") || "Failed to re-embed",
        totalReembedded: data.totalReembedded,
      });
    }
  }, [fetcher.state, fetcher.data]);

  // Check if embedding dimension change would require re-indexing
  const dimensionMismatch =
    selectedEmbeddingInfo &&
    currentEmbeddingDimensions !== selectedEmbeddingInfo.dimensions;

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Model Configuration"
        description="Configure AI models for your workspace. Pricing shown per 1M tokens."
      >
        <>
          {/* Chat Model Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-medium">Chat Model</h2>

            {/* Current Model Display */}
            <Card className="mb-4 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {currentModelInfo?.name || currentModel}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {currentModelInfo?.provider} • {currentModelInfo?.price}
                  </p>
                </div>
                <div className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm">
                  Active
                </div>
              </div>
            </Card>

            {/* Model Selection */}
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="model-select" className="mb-2 block">
                    Choose a chat model
                  </Label>
                  <Select
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                  >
                    <SelectTrigger className="w-full" showIcon={true}>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups.map((group) => (
                        <SelectGroup key={group.provider}>
                          <SelectLabel className="text-xs tracking-wide uppercase">
                            {group.provider}
                          </SelectLabel>
                          {group.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              <div className="flex items-center gap-2">
                                <span>{model.name}</span>
                                <span className="text-muted-foreground text-xs">
                                  {model.price}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedModel && findModelInfo(selectedModel) && (
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-sm">
                      {findModelInfo(selectedModel)?.description}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveModel}
                    disabled={!hasModelChanges || isSubmitting}
                  >
                    {isSubmitting ? "Saving..." : "Save Chat Model"}
                  </Button>
                  {fetcher.data?.success && hasModelChanges === false && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <Check className="h-4 w-4" />
                      Saved
                    </span>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Embedding Model Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-medium">Embedding Model</h2>

            {/* Current Embedding Model Display */}
            <Card className="mb-4 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {currentEmbeddingInfo?.name || currentEmbeddingModel}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {currentEmbeddingInfo?.provider} •{" "}
                    {currentEmbeddingInfo?.price}/1M tokens •{" "}
                    {currentEmbeddingDimensions} dimensions
                  </p>
                </div>
                <div className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm">
                  Active
                </div>
              </div>
            </Card>

            {/* Embedding Model Selection */}
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="embedding-select" className="mb-2 block">
                    Choose an embedding model
                  </Label>
                  <Select
                    value={selectedEmbeddingModel}
                    onValueChange={setSelectedEmbeddingModel}
                  >
                    <SelectTrigger className="w-full" showIcon={true}>
                      <SelectValue placeholder="Select an embedding model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEmbeddingGroups.map((group) => (
                        <SelectGroup key={group.provider}>
                          <SelectLabel className="text-xs tracking-wide uppercase">
                            {group.provider}
                          </SelectLabel>
                          {group.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              <div className="flex items-center gap-2">
                                <span>{model.name}</span>
                                <span className="text-muted-foreground text-xs">
                                  {model.dimensions}d • {model.price}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedEmbeddingModel && selectedEmbeddingInfo && (
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-sm">
                      {selectedEmbeddingInfo.description}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Dimensions: {selectedEmbeddingInfo.dimensions}
                    </p>
                  </div>
                )}

                {/* Warning about dimension changes */}
                {dimensionMismatch && (
                  <div className="flex gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                        Dimension Change Detected
                      </p>
                      <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                        Changing from {currentEmbeddingDimensions} to{" "}
                        {selectedEmbeddingInfo?.dimensions} dimensions. Existing
                        embeddings will need to be regenerated for vector search
                        to work correctly.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveEmbedding}
                    disabled={!hasEmbeddingChanges || isSubmitting}
                    variant={dimensionMismatch ? "destructive" : "default"}
                  >
                    {isSubmitting
                      ? "Saving..."
                      : dimensionMismatch
                        ? "Save & Regenerate"
                        : "Save Embedding Model"}
                  </Button>
                  {fetcher.data?.success && hasEmbeddingChanges === false && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <Check className="h-4 w-4" />
                      Saved
                    </span>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Re-embedding Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-medium">Embedding Management</h2>
            <Card className="p-4">
              <div className="space-y-4">
                {/* Embedding Stats */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="bg-muted/50 rounded-md p-3 text-center">
                    <p className="text-2xl font-bold">
                      {embeddingCounts.statements}
                    </p>
                    <p className="text-muted-foreground text-xs">Statements</p>
                  </div>
                  <div className="bg-muted/50 rounded-md p-3 text-center">
                    <p className="text-2xl font-bold">
                      {embeddingCounts.episodes}
                    </p>
                    <p className="text-muted-foreground text-xs">Episodes</p>
                  </div>
                  <div className="bg-muted/50 rounded-md p-3 text-center">
                    <p className="text-2xl font-bold">
                      {embeddingCounts.entities}
                    </p>
                    <p className="text-muted-foreground text-xs">Entities</p>
                  </div>
                  <div className="bg-muted/50 rounded-md p-3 text-center">
                    <p className="text-2xl font-bold">
                      {embeddingCounts.compactedSessions}
                    </p>
                    <p className="text-muted-foreground text-xs">Sessions</p>
                  </div>
                </div>

                <div className="text-muted-foreground text-sm">
                  Total:{" "}
                  <span className="font-medium">{embeddingCounts.total}</span>{" "}
                  embeddings stored at{" "}
                  <span className="font-medium">
                    {currentEmbeddingDimensions}
                  </span>{" "}
                  dimensions
                </div>

                {/* Re-embed Button */}
                <div className="border-t pt-4">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Regenerate Embeddings</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Re-generate all embeddings using the current embedding
                        model. Use this after changing embedding models or if
                        vector search isn't working correctly.
                      </p>

                      {embeddingCounts.total > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Button
                            onClick={handleReembed}
                            disabled={
                              isReembeddingFromFetcher ||
                              embeddingCounts.total === 0
                            }
                            variant="outline"
                            className="gap-2"
                          >
                            {isReembeddingFromFetcher ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Re-embedding...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-4 w-4" />
                                Regenerate All ({embeddingCounts.total})
                              </>
                            )}
                          </Button>

                          {reembedResult && (
                            <span
                              className={`text-sm ${
                                reembedResult.success
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {reembedResult.success ? (
                                <span className="flex items-center gap-1">
                                  <Check className="h-4 w-4" />
                                  {reembedResult.totalReembedded} embeddings
                                  regenerated
                                </span>
                              ) : (
                                reembedResult.message
                              )}
                            </span>
                          )}
                        </div>
                      )}

                      {embeddingCounts.total === 0 && (
                        <p className="text-muted-foreground mt-2 text-sm italic">
                          No embeddings to regenerate yet. Start by ingesting
                          some content.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* API Keys Info */}
          <div className="mb-6">
            <h2 className="mb-4 text-lg font-medium">Available Providers</h2>
            <Card className="p-4">
              <div className="space-y-3">
                {[
                  {
                    key: null,
                    name: "Local Embeddings",
                    models: "Free, runs in Node.js",
                  },
                  {
                    key: "OPENROUTER_API_KEY",
                    name: "OpenRouter",
                    models: "300+ chat & embedding models",
                  },
                  {
                    key: "OPENAI_API_KEY",
                    name: "OpenAI",
                    models: "GPT-4, embeddings",
                  },
                  {
                    key: "ANTHROPIC_API_KEY",
                    name: "Anthropic",
                    models: "Claude models",
                  },
                  {
                    key: "GOOGLE_GENERATIVE_AI_API_KEY",
                    name: "Google",
                    models: "Gemini models",
                  },
                ].map((provider) => (
                  <div
                    key={provider.key || provider.name}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{provider.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {provider.models}
                      </p>
                    </div>
                    <div
                      className={`rounded-full px-2 py-1 text-xs ${
                        provider.key === null ||
                        availableKeys.includes(provider.key)
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {provider.key === null
                        ? "Always Available"
                        : availableKeys.includes(provider.key)
                          ? "Configured"
                          : "Not configured"}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Help text */}
          <div className="bg-muted/30 flex items-start gap-2 rounded-md p-3">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">
              OpenRouter gives you access to 300+ models with a single API key,
              including embedding models from OpenAI, Qwen, and Cohere.
            </p>
          </div>
        </>
      </SettingSection>
    </div>
  );
}
