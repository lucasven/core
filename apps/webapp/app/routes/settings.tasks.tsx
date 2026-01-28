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
import { Check, Info, RotateCcw } from "lucide-react";
import { useState } from "react";

// Task types with descriptions
const TASK_TYPES = [
  {
    id: "normalization",
    name: "Normalization",
    description:
      "Cleans and enriches raw text into structured format with context and timestamps",
    complexity: "high",
  },
  {
    id: "entityExtraction",
    name: "Entity Extraction",
    description:
      "Identifies entities (people, projects, concepts, files) from episode content",
    complexity: "high",
  },
  {
    id: "statementExtraction",
    name: "Statement Extraction",
    description:
      "Creates subject-predicate-object triples from text for knowledge graph",
    complexity: "high",
  },
  {
    id: "sessionCompaction",
    name: "Session Compaction",
    description:
      "Generates rich summaries of conversation sessions for context retrieval",
    complexity: "high",
  },
  {
    id: "titleGeneration",
    name: "Title Generation",
    description: "Creates concise, descriptive titles for episodes",
    complexity: "low",
  },
  {
    id: "labelAssignment",
    name: "Label Assignment",
    description: "Assigns appropriate labels to episodes based on content",
    complexity: "high",
  },
] as const;

// Available chat models (same as settings.model.tsx but flattened)
const ALL_MODELS = [
  // OpenRouter - Budget
  {
    id: "deepseek/deepseek-chat-v3",
    name: "DeepSeek V3",
    price: "$0.14 / $0.28",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek R1",
    price: "$0.55 / $2.19",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    price: "$0.10 / $0.30",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "mistral/mistral-large-latest",
    name: "Mistral Large",
    price: "$2.00 / $6.00",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  // OpenRouter - Premium
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    price: "$3.00 / $15.00",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    price: "$2.00 / $8.00",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "google/gemini-2.0-flash-001",
    name: "Gemini 2.0 Flash",
    price: "$0.10 / $0.40",
    provider: "OpenRouter",
    requiresKey: "OPENROUTER_API_KEY",
  },
  // OpenAI Direct
  {
    id: "gpt-4.1-2025-04-14",
    name: "GPT-4.1",
    price: "$2.00 / $8.00",
    provider: "OpenAI",
    requiresKey: "OPENAI_API_KEY",
  },
  {
    id: "gpt-4.1-mini-2025-04-14",
    name: "GPT-4.1 Mini",
    price: "$0.40 / $1.60",
    provider: "OpenAI",
    requiresKey: "OPENAI_API_KEY",
  },
  // Anthropic Direct
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    price: "$3.00 / $15.00",
    provider: "Anthropic",
    requiresKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    price: "$0.80 / $4.00",
    provider: "Anthropic",
    requiresKey: "ANTHROPIC_API_KEY",
  },
  // Google Direct
  {
    id: "gemini-2.5-pro-preview-03-25",
    name: "Gemini 2.5 Pro",
    price: "$1.25 / $5.00",
    provider: "Google",
    requiresKey: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    price: "$0.10 / $0.40",
    provider: "Google",
    requiresKey: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
];

type TaskType = (typeof TASK_TYPES)[number]["id"];

interface LoaderData {
  currentModel: string;
  taskModels: Partial<Record<TaskType, string>>;
  availableKeys: string[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const metadata = workspace.metadata as {
    model?: string;
    taskModels?: Partial<Record<TaskType, string>>;
  } | null;

  const currentModel =
    metadata?.model || process.env.MODEL || "gpt-4.1-2025-04-14";
  const taskModels = metadata?.taskModels || {};

  // Check which API keys are available
  const availableKeys: string[] = [];
  if (process.env.OPENROUTER_API_KEY) availableKeys.push("OPENROUTER_API_KEY");
  if (process.env.OPENAI_API_KEY) availableKeys.push("OPENAI_API_KEY");
  if (process.env.ANTHROPIC_API_KEY) availableKeys.push("ANTHROPIC_API_KEY");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    availableKeys.push("GOOGLE_GENERATIVE_AI_API_KEY");

  return json({
    currentModel,
    taskModels,
    availableKeys,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();

  const taskType = formData.get("taskType") as TaskType | null;
  const model = formData.get("model") as string | null;
  const action = formData.get("action") as string | null;

  if (!taskType) {
    return json({ error: "No task type provided" }, { status: 400 });
  }

  const currentMetadata = (workspace.metadata as Record<string, any>) || {};
  const currentTaskModels = currentMetadata.taskModels || {};

  let updatedTaskModels: Record<string, string>;

  if (action === "reset") {
    // Remove the task-specific model (will use default)
    const { [taskType]: _, ...rest } = currentTaskModels;
    updatedTaskModels = rest;
  } else if (model) {
    // Set the task-specific model
    updatedTaskModels = { ...currentTaskModels, [taskType]: model };
  } else {
    return json({ error: "No model provided" }, { status: 400 });
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      metadata: { ...currentMetadata, taskModels: updatedTaskModels },
    },
  });

  return json({ success: true, taskType, model: model || "default" });
};

export default function TaskSettings() {
  const { currentModel, taskModels, availableKeys } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [selectedModels, setSelectedModels] = useState<
    Partial<Record<TaskType, string>>
  >(taskModels);

  const isSubmitting = fetcher.state === "submitting";

  // Filter models to only show available ones
  const availableModels = ALL_MODELS.filter((model) =>
    availableKeys.includes(model.requiresKey),
  );

  // Group models by provider
  const modelsByProvider = availableModels.reduce(
    (acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = [];
      }
      acc[model.provider].push(model);
      return acc;
    },
    {} as Record<string, typeof availableModels>,
  );

  const handleSaveTask = (taskId: TaskType) => {
    const model = selectedModels[taskId];
    if (model) {
      fetcher.submit({ taskType: taskId, model }, { method: "POST" });
    }
  };

  const handleResetTask = (taskId: TaskType) => {
    fetcher.submit({ taskType: taskId, action: "reset" }, { method: "POST" });
    setSelectedModels((prev) => {
      const { [taskId]: _, ...rest } = prev;
      return rest;
    });
  };

  const getEffectiveModel = (taskId: TaskType): string => {
    return selectedModels[taskId] || taskModels[taskId] || currentModel;
  };

  const hasChanges = (taskId: TaskType): boolean => {
    const current = taskModels[taskId];
    const selected = selectedModels[taskId];
    return selected !== undefined && selected !== current;
  };

  const isUsingDefault = (taskId: TaskType): boolean => {
    return !taskModels[taskId] && !selectedModels[taskId];
  };

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Task Model Configuration"
        description="Configure different AI models for specific processing tasks. Each task can use a different model to optimize cost and quality."
      >
        <>
          {/* Default Model Info */}
          <Card className="mb-6 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Default Model</p>
                <p className="text-muted-foreground text-sm">
                  Tasks without a specific model will use this
                </p>
              </div>
              <div className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm">
                {availableModels.find((m) => m.id === currentModel)?.name ||
                  currentModel}
              </div>
            </div>
          </Card>

          {/* Task-specific Model Configuration */}
          <div className="space-y-4">
            {TASK_TYPES.map((task) => {
              const effectiveModel = getEffectiveModel(task.id);
              const effectiveModelInfo = availableModels.find(
                (m) => m.id === effectiveModel,
              );
              const usingDefault = isUsingDefault(task.id);

              return (
                <Card key={task.id} className="p-4">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{task.name}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              task.complexity === "high"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                            }`}
                          >
                            {task.complexity === "high" ? "High" : "Low"}{" "}
                            complexity
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {task.description}
                        </p>
                      </div>
                      {!usingDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResetTask(task.id)}
                          disabled={isSubmitting}
                          title="Reset to default"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <Select
                          value={selectedModels[task.id] || ""}
                          onValueChange={(value) =>
                            setSelectedModels((prev) => ({
                              ...prev,
                              [task.id]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full" showIcon={true}>
                            <SelectValue
                              placeholder={
                                usingDefault
                                  ? `Using default (${effectiveModelInfo?.name || effectiveModel})`
                                  : effectiveModelInfo?.name || effectiveModel
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(modelsByProvider).map(
                              ([provider, models]) => (
                                <SelectGroup key={provider}>
                                  <SelectLabel className="text-xs tracking-wide uppercase">
                                    {provider}
                                  </SelectLabel>
                                  {models.map((model) => (
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
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        onClick={() => handleSaveTask(task.id)}
                        disabled={!hasChanges(task.id) || isSubmitting}
                        size="sm"
                      >
                        {isSubmitting ? "Saving..." : "Save"}
                      </Button>
                    </div>

                    {usingDefault && (
                      <p className="text-muted-foreground text-xs">
                        Currently using workspace default model
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Help text */}
          <div className="bg-muted/30 mt-6 flex items-start gap-2 rounded-md p-3">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-muted-foreground text-sm">
              <p>
                <strong>High complexity</strong> tasks (normalization, entity
                extraction, statement extraction) benefit from more capable
                models.
              </p>
              <p className="mt-1">
                <strong>Low complexity</strong> tasks (title generation) can use
                smaller, faster models to reduce costs.
              </p>
            </div>
          </div>
        </>
      </SettingSection>
    </div>
  );
}
