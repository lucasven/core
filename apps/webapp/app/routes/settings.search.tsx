import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireWorkpace } from "~/services/session.server";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { SettingSection } from "~/components/setting-section";
import { prisma } from "~/db.server";
import {
  Check,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";

// Default values for search settings
const DEFAULTS = {
  searchLimit: 25,
  scoreThreshold: 0.4,
  broadSearch: false,
  maxBfsDepth: 3,
  includeInvalidated: true,
  useLLMValidation: true,
  // Progressive retrieval defaults
  defaultRetrievalMode: "full" as "index" | "details" | "full",
  showTokenCosts: true,
  // Lifecycle hooks defaults
  lifecycleHooksEnabled: true,
  autoSummaryOnEnd: true,
};

interface LoaderData {
  searchLimit: number;
  scoreThreshold: number;
  broadSearch: boolean;
  maxBfsDepth: number;
  includeInvalidated: boolean;
  useLLMValidation: boolean;
  defaultRetrievalMode: "index" | "details" | "full";
  showTokenCosts: boolean;
  lifecycleHooksEnabled: boolean;
  autoSummaryOnEnd: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const workspace = await requireWorkpace(request);
  const metadata = (workspace.metadata as Record<string, any>) || {};
  const progressiveSettings = metadata.progressiveRetrieval || {};
  const lifecycleSettings = metadata.lifecycleHooks || {};

  return json<LoaderData>({
    searchLimit: metadata.searchLimit ?? DEFAULTS.searchLimit,
    scoreThreshold: metadata.scoreThreshold ?? DEFAULTS.scoreThreshold,
    broadSearch: metadata.broadSearch ?? DEFAULTS.broadSearch,
    maxBfsDepth: metadata.maxBfsDepth ?? DEFAULTS.maxBfsDepth,
    includeInvalidated:
      metadata.includeInvalidated ?? DEFAULTS.includeInvalidated,
    useLLMValidation: metadata.useLLMValidation ?? DEFAULTS.useLLMValidation,
    defaultRetrievalMode:
      progressiveSettings.defaultMode ?? DEFAULTS.defaultRetrievalMode,
    showTokenCosts:
      progressiveSettings.showTokenCosts ?? DEFAULTS.showTokenCosts,
    lifecycleHooksEnabled:
      lifecycleSettings.enabled ?? DEFAULTS.lifecycleHooksEnabled,
    autoSummaryOnEnd:
      lifecycleSettings.autoSummaryOnEnd ?? DEFAULTS.autoSummaryOnEnd,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "reset") {
    // Reset to defaults
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        metadata: {
          ...(workspace.metadata as object),
          searchLimit: DEFAULTS.searchLimit,
          scoreThreshold: DEFAULTS.scoreThreshold,
          broadSearch: DEFAULTS.broadSearch,
          maxBfsDepth: DEFAULTS.maxBfsDepth,
          includeInvalidated: DEFAULTS.includeInvalidated,
          useLLMValidation: DEFAULTS.useLLMValidation,
          progressiveRetrieval: {
            defaultMode: DEFAULTS.defaultRetrievalMode,
            showTokenCosts: DEFAULTS.showTokenCosts,
          },
          lifecycleHooks: {
            enabled: DEFAULTS.lifecycleHooksEnabled,
            autoSummaryOnEnd: DEFAULTS.autoSummaryOnEnd,
          },
        },
      },
    });
    return json({ success: true, reset: true });
  }

  const updates = {
    searchLimit:
      parseInt(formData.get("searchLimit") as string) || DEFAULTS.searchLimit,
    scoreThreshold:
      parseFloat(formData.get("scoreThreshold") as string) ||
      DEFAULTS.scoreThreshold,
    broadSearch: formData.get("broadSearch") === "true",
    maxBfsDepth:
      parseInt(formData.get("maxBfsDepth") as string) || DEFAULTS.maxBfsDepth,
    includeInvalidated: formData.get("includeInvalidated") === "true",
    useLLMValidation: formData.get("useLLMValidation") === "true",
    progressiveRetrieval: {
      defaultMode:
        (formData.get("defaultRetrievalMode") as string) ||
        DEFAULTS.defaultRetrievalMode,
      showTokenCosts: formData.get("showTokenCosts") === "true",
    },
    lifecycleHooks: {
      enabled: formData.get("lifecycleHooksEnabled") === "true",
      autoSummaryOnEnd: formData.get("autoSummaryOnEnd") === "true",
    },
  };

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      metadata: { ...(workspace.metadata as object), ...updates },
    },
  });

  return json({ success: true });
};

export default function SearchSettings() {
  const data = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success?: boolean; reset?: boolean }>();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Local state for form values
  const [searchLimit, setSearchLimit] = useState(data.searchLimit);
  const [scoreThreshold, setScoreThreshold] = useState(data.scoreThreshold);
  const [broadSearch, setBroadSearch] = useState(data.broadSearch);
  const [maxBfsDepth, setMaxBfsDepth] = useState(data.maxBfsDepth);
  const [includeInvalidated, setIncludeInvalidated] = useState(
    data.includeInvalidated,
  );
  const [useLLMValidation, setUseLLMValidation] = useState(
    data.useLLMValidation,
  );
  const [defaultRetrievalMode, setDefaultRetrievalMode] = useState(
    data.defaultRetrievalMode,
  );
  const [showTokenCosts, setShowTokenCosts] = useState(data.showTokenCosts);
  const [lifecycleHooksEnabled, setLifecycleHooksEnabled] = useState(
    data.lifecycleHooksEnabled,
  );
  const [autoSummaryOnEnd, setAutoSummaryOnEnd] = useState(
    data.autoSummaryOnEnd,
  );

  const isSubmitting = fetcher.state === "submitting";
  const hasChanges =
    searchLimit !== data.searchLimit ||
    scoreThreshold !== data.scoreThreshold ||
    broadSearch !== data.broadSearch ||
    maxBfsDepth !== data.maxBfsDepth ||
    includeInvalidated !== data.includeInvalidated ||
    useLLMValidation !== data.useLLMValidation ||
    defaultRetrievalMode !== data.defaultRetrievalMode ||
    showTokenCosts !== data.showTokenCosts ||
    lifecycleHooksEnabled !== data.lifecycleHooksEnabled ||
    autoSummaryOnEnd !== data.autoSummaryOnEnd;

  const handleSave = () => {
    fetcher.submit(
      {
        searchLimit: searchLimit.toString(),
        scoreThreshold: scoreThreshold.toString(),
        broadSearch: broadSearch.toString(),
        maxBfsDepth: maxBfsDepth.toString(),
        includeInvalidated: includeInvalidated.toString(),
        useLLMValidation: useLLMValidation.toString(),
        defaultRetrievalMode: defaultRetrievalMode,
        showTokenCosts: showTokenCosts.toString(),
        lifecycleHooksEnabled: lifecycleHooksEnabled.toString(),
        autoSummaryOnEnd: autoSummaryOnEnd.toString(),
      },
      { method: "POST" },
    );
  };

  const handleReset = () => {
    fetcher.submit({ _action: "reset" }, { method: "POST" });
    // Reset local state to defaults
    setSearchLimit(DEFAULTS.searchLimit);
    setScoreThreshold(DEFAULTS.scoreThreshold);
    setBroadSearch(DEFAULTS.broadSearch);
    setMaxBfsDepth(DEFAULTS.maxBfsDepth);
    setIncludeInvalidated(DEFAULTS.includeInvalidated);
    setUseLLMValidation(DEFAULTS.useLLMValidation);
    setLifecycleHooksEnabled(DEFAULTS.lifecycleHooksEnabled);
    setAutoSummaryOnEnd(DEFAULTS.autoSummaryOnEnd);
    setDefaultRetrievalMode(DEFAULTS.defaultRetrievalMode);
    setShowTokenCosts(DEFAULTS.showTokenCosts);
  };

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Search Configuration"
        description="Configure how memory search works for your workspace. These settings affect all search queries through API and MCP tools."
      >
        <>
          {/* Search Result Limit */}
          <div className="mb-6">
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label
                    htmlFor="limit-select"
                    className="mb-2 block font-medium"
                  >
                    Maximum Results
                  </Label>
                  <Select
                    value={searchLimit.toString()}
                    onValueChange={(val) => setSearchLimit(parseInt(val))}
                  >
                    <SelectTrigger className="w-full" showIcon={true}>
                      <SelectValue placeholder="Select limit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 results</SelectItem>
                      <SelectItem value="15">15 results</SelectItem>
                      <SelectItem value="25">
                        25 results (recommended)
                      </SelectItem>
                      <SelectItem value="35">35 results</SelectItem>
                      <SelectItem value="50">50 results</SelectItem>
                      <SelectItem value="75">75 results</SelectItem>
                      <SelectItem value="100">100 results</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground">
                    How many episodes/memories to return per search.
                  </p>
                  <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
                    <li>
                      <strong>10-15:</strong> Fast, focused results (best for
                      specific queries)
                    </li>
                    <li>
                      <strong>25-35:</strong> Balanced (recommended for most use
                      cases)
                    </li>
                    <li>
                      <strong>50+:</strong> Comprehensive results (slower, but
                      complete picture)
                    </li>
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          {/* Relevance Threshold */}
          <div className="mb-6">
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label
                    htmlFor="threshold-select"
                    className="mb-2 block font-medium"
                  >
                    Relevance Threshold
                  </Label>
                  <Select
                    value={scoreThreshold.toString()}
                    onValueChange={(val) => setScoreThreshold(parseFloat(val))}
                  >
                    <SelectTrigger className="w-full" showIcon={true}>
                      <SelectValue placeholder="Select threshold" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.7">0.7 - Very strict</SelectItem>
                      <SelectItem value="0.6">0.6 - Strict</SelectItem>
                      <SelectItem value="0.5">0.5 - Moderate</SelectItem>
                      <SelectItem value="0.4">
                        0.4 - Balanced (recommended)
                      </SelectItem>
                      <SelectItem value="0.3">0.3 - Lenient</SelectItem>
                      <SelectItem value="0.25">0.25 - Very lenient</SelectItem>
                      <SelectItem value="0.2">
                        0.2 - Minimal filtering
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground">
                    Minimum relevance score (0-1) for results to be included.
                  </p>
                  <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
                    <li>
                      <strong>0.6+:</strong> Very strict - only highly relevant
                      results
                    </li>
                    <li>
                      <strong>0.4-0.5:</strong> Balanced - good relevance,
                      broader results
                    </li>
                    <li>
                      <strong>0.2-0.3:</strong> Lenient - more results, may
                      include tangential
                    </li>
                  </ul>
                  {scoreThreshold >= 0.6 && (
                    <div className="mt-2 flex items-start gap-2 text-yellow-600 dark:text-yellow-500">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        High thresholds may return empty results for vague
                        queries
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Search Mode */}
          <div className="mb-6">
            <Card className="p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Broad Search Mode</Label>
                    <p className="text-muted-foreground text-sm">
                      Return comprehensive results, cast a wider net
                    </p>
                  </div>
                  <Switch
                    checked={broadSearch}
                    onCheckedChange={setBroadSearch}
                  />
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground mb-2">
                    <strong>Precise Mode (off):</strong> Returns focused, highly
                    relevant results. Best for specific questions.
                  </p>
                  <p className="text-muted-foreground mb-2">
                    <strong>Broad Mode (on):</strong> Returns comprehensive
                    results. Best for exploring topics.
                  </p>
                  {broadSearch && (
                    <div className="border-primary/20 mt-2 border-l-2 pl-3">
                      <p className="text-muted-foreground font-medium">
                        What changes in Broad Mode:
                      </p>
                      <ul className="text-muted-foreground mt-1 list-inside list-disc space-y-1">
                        <li>Skips strict entity matching</li>
                        <li>Lowers relevance thresholds</li>
                        <li>Returns up to 50 results instead of 25</li>
                        <li>Skips LLM validation (faster, more inclusive)</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Progressive Retrieval */}
          <div className="mb-6">
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block font-medium">
                    Default Retrieval Mode
                  </Label>
                  <Select
                    value={defaultRetrievalMode}
                    onValueChange={(val) =>
                      setDefaultRetrievalMode(
                        val as "index" | "details" | "full",
                      )
                    }
                  >
                    <SelectTrigger className="w-full" showIcon={true}>
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">
                        Full - Complete content (default)
                      </SelectItem>
                      <SelectItem value="details">
                        Details - Previews with token counts
                      </SelectItem>
                      <SelectItem value="index">
                        Index - References only with token costs
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground mb-2">
                    Progressive retrieval lets agents control context size:
                  </p>
                  <ul className="text-muted-foreground list-inside list-disc space-y-1">
                    <li>
                      <strong>Index:</strong> Just references + token costs
                      (minimal context)
                    </li>
                    <li>
                      <strong>Details:</strong> Previews (200 chars) + token
                      estimates
                    </li>
                    <li>
                      <strong>Full:</strong> Complete content (default behavior)
                    </li>
                  </ul>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Show Token Costs</Label>
                    <p className="text-muted-foreground text-xs">
                      Include token estimates in search responses
                    </p>
                  </div>
                  <Switch
                    checked={showTokenCosts}
                    onCheckedChange={setShowTokenCosts}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Advanced Options */}
          <div className="mb-6">
            <Card className="p-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full items-center justify-between"
              >
                <Label className="cursor-pointer font-medium">
                  Advanced Options
                </Label>
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 border-t pt-4">
                  {/* BFS Depth */}
                  <div>
                    <Label htmlFor="bfs-depth" className="mb-2 block text-sm">
                      Graph Traversal Depth (BFS)
                    </Label>
                    <Select
                      value={maxBfsDepth.toString()}
                      onValueChange={(val) => setMaxBfsDepth(parseInt(val))}
                    >
                      <SelectTrigger className="w-full" showIcon={true}>
                        <SelectValue placeholder="Select depth" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 hop (fastest)</SelectItem>
                        <SelectItem value="2">2 hops</SelectItem>
                        <SelectItem value="3">3 hops (recommended)</SelectItem>
                        <SelectItem value="4">4 hops</SelectItem>
                        <SelectItem value="5">5 hops (slowest)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground mt-1 text-xs">
                      How many hops in the knowledge graph to traverse. Higher =
                      more connections found, but slower.
                    </p>
                  </div>

                  {/* Include Invalidated Facts */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">
                        Include Invalidated Facts
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        Show facts that were later corrected or updated
                      </p>
                    </div>
                    <Switch
                      checked={includeInvalidated}
                      onCheckedChange={setIncludeInvalidated}
                    />
                  </div>

                  {/* LLM Validation */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Enable LLM Validation</Label>
                      <p className="text-muted-foreground text-xs">
                        Use AI to verify result relevance (slower but more
                        precise)
                      </p>
                    </div>
                    <Switch
                      checked={useLLMValidation}
                      onCheckedChange={setUseLLMValidation}
                    />
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Session Lifecycle Hooks */}
          <div className="mb-6">
            <Card className="p-4">
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block font-medium">
                    Session Lifecycle Hooks
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Automatically trigger actions when MCP sessions start or
                    end.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Enable Lifecycle Hooks</Label>
                    <p className="text-muted-foreground text-xs">
                      Fire hooks on session start/end events
                    </p>
                  </div>
                  <Switch
                    checked={lifecycleHooksEnabled}
                    onCheckedChange={setLifecycleHooksEnabled}
                  />
                </div>
                {lifecycleHooksEnabled && (
                  <div className="border-primary/20 border-l-2 pl-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">
                          Auto-Summary on Session End
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Generate session summary when MCP connection closes
                        </p>
                      </div>
                      <Switch
                        checked={autoSummaryOnEnd}
                        onCheckedChange={setAutoSummaryOnEnd}
                      />
                    </div>
                  </div>
                )}
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground">
                    When enabled, closing an MCP session (e.g., ending a Claude
                    Code conversation) will automatically create a session
                    summary, capturing the conversation context for future
                    reference.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!hasChanges || isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isSubmitting}
            >
              Reset to Defaults
            </Button>
            {fetcher.data?.success && !hasChanges && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="h-4 w-4" />
                {fetcher.data.reset ? "Reset to defaults" : "Saved"}
              </span>
            )}
          </div>

          {/* Help text */}
          <div className="bg-muted/30 mt-4 flex items-start gap-2 rounded-md p-3">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">
              These settings apply to all search queries in your workspace,
              including API calls and MCP tool usage. Individual queries can
              override these defaults by passing specific parameters.
            </p>
          </div>
        </>
      </SettingSection>
    </div>
  );
}
