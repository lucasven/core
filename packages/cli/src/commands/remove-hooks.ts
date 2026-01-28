import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";

interface RemoveHooksOptions {
  dryRun: boolean;
}

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

function writeClaudeSettings(configPath: string, settings: ClaudeSettings): void {
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
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

function hasCoreHook(hookWithMatcher: HookWithMatcher): boolean {
  return hookWithMatcher.hooks?.some(isCoreHookEntry) ?? false;
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

export async function removeHooks(options: RemoveHooksOptions): Promise<void> {
  const spinner = ora("Finding Claude Code configuration...").start();

  try {
    const configPath = findClaudeConfigPath();
    if (!configPath) {
      spinner.fail("Could not find Claude Code configuration");
      console.log(chalk.yellow("\nNo Claude Code configuration found."));
      return;
    }

    spinner.text = "Reading current configuration...";
    const settings = readClaudeSettings(configPath);

    const coreHooks = findAllCoreHooks(settings);

    if (coreHooks.length === 0) {
      spinner.succeed("No CORE Memory hooks found");
      console.log(chalk.blue("\nNo CORE Memory hooks are currently configured."));
      return;
    }

    spinner.stop();
    console.log(chalk.cyan(`\nFound ${coreHooks.length} CORE Memory hook(s):\n`));

    // Group by hook type for display
    const byType: Record<string, string[]> = {};
    for (const hook of coreHooks) {
      if (!byType[hook.hookType]) {
        byType[hook.hookType] = [];
      }
      byType[hook.hookType].push(hook.command);
    }

    for (const [hookType, commands] of Object.entries(byType)) {
      console.log(chalk.white(`  ${hookType}:`));
      for (const cmd of commands) {
        console.log(chalk.gray(`    • ${cmd.substring(0, 60)}...`));
      }
    }

    if (options.dryRun) {
      console.log(chalk.cyan("\n📋 Dry run - no changes will be made"));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Remove all CORE Memory hooks?",
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.blue("No changes made."));
      return;
    }

    spinner.start("Removing hooks...");

    // Filter out CORE hooks from all hook types
    const newSettings: ClaudeSettings = {
      ...settings,
      hooks: {
        ...settings.hooks,
      },
    };

    for (const hookType of CORE_HOOK_TYPES) {
      const existingHooks = settings.hooks?.[hookType] || [];
      const filteredHooks = existingHooks.filter((hookGroup) => !hasCoreHook(hookGroup));

      if (filteredHooks.length > 0) {
        newSettings.hooks![hookType] = filteredHooks;
      } else {
        delete newSettings.hooks![hookType];
      }
    }

    // Clean up empty hooks object
    if (Object.keys(newSettings.hooks || {}).length === 0) {
      delete newSettings.hooks;
    }

    writeClaudeSettings(configPath, newSettings);
    spinner.succeed("CORE Memory hooks removed successfully!");

    console.log(chalk.green(`\n✅ Removed ${coreHooks.length} hook(s)`));
  } catch (error) {
    spinner.fail("Failed to remove hooks");
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
