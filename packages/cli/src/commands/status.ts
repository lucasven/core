import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";

// New Claude Code hooks format with matchers
interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookWithMatcher {
  matcher?: string | Record<string, any>;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookWithMatcher[];
    SessionEnd?: HookWithMatcher[];
    UserPromptSubmit?: HookWithMatcher[];
    Stop?: HookWithMatcher[];
    [key: string]: any;
  };
  [key: string]: any;
}

// Hook types that CORE Memory uses
const CORE_HOOK_TYPES = ["SessionStart", "SessionEnd", "UserPromptSubmit", "Stop"] as const;
type CoreHookType = (typeof CORE_HOOK_TYPES)[number];

// Display names and descriptions for each hook type
const HOOK_INFO: Record<CoreHookType, { name: string; description: string }> = {
  SessionStart: {
    name: "Session Start",
    description: "Initialize session, search for context",
  },
  UserPromptSubmit: {
    name: "Prompt Submit",
    description: "Search memory when you submit a prompt",
  },
  Stop: {
    name: "Stop",
    description: "Generate summary when assistant stops",
  },
  SessionEnd: {
    name: "Session End",
    description: "Generate session summary on close",
  },
};

const CLAUDE_CONFIG_PATHS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".config", "claude", "settings.json"),
];

function findClaudeConfigPath(): string | null {
  for (const configPath of CLAUDE_CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

function readClaudeSettings(configPath: string): ClaudeSettings {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

function isCoreHookCommand(command: string): boolean {
  return (
    command.includes("lifecycle/session") ||
    command.includes("lifecycle/prompt") ||
    command.includes("lifecycle/stop") ||
    command.includes("core-memory") ||
    command.includes("getcore.ai")
  );
}

function isCoreHookEntry(hook: HookEntry): boolean {
  return isCoreHookCommand(hook.command || "");
}

function extractApiUrl(command: string): string | null {
  const match = command.match(/https?:\/\/[^\s"']+/);
  return match ? match[0].replace(/\/api\/v1\/lifecycle\/.*/, "") : null;
}

function hasApiKeyInCommand(command: string): boolean {
  return command.includes("Bearer ") && !command.includes("$CORE_MEMORY_API_KEY");
}

function usesEnvVariable(command: string): boolean {
  return command.includes("$CORE_MEMORY_API_KEY");
}

interface FoundHook {
  hookType: CoreHookType;
  command: string;
}

function findAllCoreHooks(settings: ClaudeSettings): FoundHook[] {
  const found: FoundHook[] = [];

  for (const hookType of CORE_HOOK_TYPES) {
    const hooks = settings.hooks?.[hookType] || [];
    for (const hookGroup of hooks) {
      for (const hook of hookGroup.hooks || []) {
        if (isCoreHookEntry(hook)) {
          found.push({
            hookType,
            command: hook.command,
          });
        }
      }
    }
  }

  return found;
}

export async function checkStatus(): Promise<void> {
  console.log(chalk.cyan("\n🔍 CORE Memory Hooks Status\n"));
  console.log(chalk.gray("─".repeat(50)));

  // Check Claude Code config
  const configPath = findClaudeConfigPath();

  console.log(chalk.white("\n📁 Claude Code Configuration"));
  if (configPath) {
    console.log(chalk.green("   ✓ Config file found:"), chalk.gray(configPath));
  } else {
    console.log(chalk.yellow("   ⚠ Config file not found"));
    console.log(chalk.gray("     Expected locations:"));
    CLAUDE_CONFIG_PATHS.forEach((p) => console.log(chalk.gray(`       - ${p}`)));
    return;
  }

  // Check for CORE hooks
  const settings = readClaudeSettings(configPath);
  const coreHooks = findAllCoreHooks(settings);

  console.log(chalk.white("\n🔗 CORE Memory Hooks"));

  if (coreHooks.length === 0) {
    console.log(chalk.yellow("   ⚠ No CORE Memory hooks configured"));
    console.log(chalk.gray("     Run: npx @core-memory/cli setup-hooks"));
  } else {
    console.log(chalk.green(`   ✓ ${coreHooks.length} hook(s) configured\n`));

    // Show status for each hook type
    for (const hookType of CORE_HOOK_TYPES) {
      const hooks = coreHooks.filter((h) => h.hookType === hookType);
      const info = HOOK_INFO[hookType];

      if (hooks.length > 0) {
        console.log(chalk.green(`   ✓ ${info.name}`), chalk.gray(`- ${info.description}`));

        for (const hook of hooks) {
          const apiUrl = extractApiUrl(hook.command);
          if (apiUrl) {
            console.log(chalk.gray(`     └ ${apiUrl}`));
          }
        }
      } else {
        console.log(chalk.yellow(`   ○ ${info.name}`), chalk.gray(`- ${info.description}`));
      }
    }

    // Check API key configuration
    const anyHook = coreHooks[0];
    if (anyHook) {
      const hasKey = hasApiKeyInCommand(anyHook.command);
      const usesEnv = usesEnvVariable(anyHook.command);

      console.log(chalk.white("\n🔑 API Key"));
      if (hasKey) {
        console.log(chalk.green("   ✓ API key embedded in commands"));
      } else if (usesEnv) {
        console.log(chalk.blue("   ℹ Using CORE_MEMORY_API_KEY environment variable"));
      } else {
        console.log(chalk.yellow("   ⚠ No API key configuration detected"));
      }
    }
  }

  // Check environment variable
  console.log(chalk.white("\n🌍 Environment"));
  if (process.env.CORE_MEMORY_API_KEY) {
    const keyPreview = process.env.CORE_MEMORY_API_KEY.substring(0, 8) + "...";
    console.log(chalk.green("   ✓ CORE_MEMORY_API_KEY is set"), chalk.gray(`(${keyPreview})`));
  } else {
    const usesEnv = coreHooks.some((h) => usesEnvVariable(h.command));
    console.log(chalk.yellow("   ⚠ CORE_MEMORY_API_KEY not set"));
    if (usesEnv) {
      console.log(chalk.red("     ✗ Required for hooks to work!"));
      console.log(chalk.gray("       export CORE_MEMORY_API_KEY=your_api_key"));
    }
  }

  console.log(chalk.gray("\n" + "─".repeat(50)));
  console.log(chalk.cyan("\n📚 Commands:"));
  console.log(chalk.gray("   Setup hooks:  npx @core-memory/cli setup-hooks"));
  console.log(chalk.gray("   Remove hooks: npx @core-memory/cli remove-hooks"));
  console.log();
}
