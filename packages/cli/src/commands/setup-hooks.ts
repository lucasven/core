import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";

interface SetupHooksOptions {
  url: string;
  apiKey?: string;
  force: boolean;
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
    PostToolUse?: HookWithMatcher[];
    Stop?: HookWithMatcher[];
    [key: string]: any;
  };
  [key: string]: any;
}

// Hook types that CORE Memory uses (including PostToolUse for tool observation)
const CORE_HOOK_TYPES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;
type CoreHookType = (typeof CORE_HOOK_TYPES)[number];

const CLAUDE_CONFIG_PATHS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".config", "claude", "settings.json"),
];

// Scripts directory inside installed package
function getScriptsDir(): string {
  // When compiled, __dirname points to dist/
  // Scripts are in dist/scripts (compiled from scripts/)
  return path.join(__dirname, "scripts");
}

function findClaudeConfigPath(): string | null {
  for (const configPath of CLAUDE_CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  // Return the default path even if it doesn't exist (we'll create it)
  return CLAUDE_CONFIG_PATHS[0];
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readClaudeSettings(configPath: string): ClaudeSettings {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Could not parse ${configPath}, starting fresh`));
    return {};
  }
}

function writeClaudeSettings(configPath: string, settings: ClaudeSettings): void {
  ensureDirectoryExists(configPath);
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
}

function isCoreHookCommand(command: string): boolean {
  return (
    command.includes("lifecycle/session") ||
    command.includes("lifecycle/prompt") ||
    command.includes("lifecycle/stop") ||
    command.includes("lifecycle/tool") ||
    command.includes("core-memory") ||
    command.includes("getcore.ai") ||
    command.includes("@core-memory/cli")
  );
}

interface HookConfig {
  script: string;
  timeout: number;
  description: string;
}

function generateHookConfigs(
  scriptsDir: string,
  apiUrl: string,
  apiKey?: string
): Record<CoreHookType, HookConfig> {
  // Environment variables for the hook scripts
  const envPrefix = apiKey
    ? `CORE_MEMORY_URL="${apiUrl}" CORE_MEMORY_API_KEY="${apiKey}"`
    : `CORE_MEMORY_URL="${apiUrl}"`;

  return {
    SessionStart: {
      script: `${envPrefix} node "${path.join(scriptsDir, "session-start-hook.js")}"`,
      timeout: 30,
      description: "Initialize session and search for relevant context",
    },
    UserPromptSubmit: {
      script: `${envPrefix} node "${path.join(scriptsDir, "prompt-submit-hook.js")}"`,
      timeout: 10,
      description: "Track user prompts for session context",
    },
    PostToolUse: {
      script: `${envPrefix} node "${path.join(scriptsDir, "post-tool-use-hook.js")}"`,
      timeout: 5,
      description: "Capture tool usage for context (optional)",
    },
    Stop: {
      script: `${envPrefix} node "${path.join(scriptsDir, "stop-hook.js")}"`,
      timeout: 60,
      description: "Auto-ingest conversation from transcript",
    },
    SessionEnd: {
      script: `${envPrefix} node "${path.join(scriptsDir, "session-end-hook.js")}"`,
      timeout: 30,
      description: "Finalize session",
    },
  };
}

function hasExistingCoreHooks(settings: ClaudeSettings): boolean {
  for (const hookType of CORE_HOOK_TYPES) {
    const hooks = settings.hooks?.[hookType] || [];
    const hasCoreHook = hooks.some((hookWithMatcher) =>
      hookWithMatcher.hooks?.some((hook) => isCoreHookCommand(hook.command || ""))
    );
    if (hasCoreHook) return true;
  }
  return false;
}

function filterOutCoreHooks(hooks: HookWithMatcher[]): HookWithMatcher[] {
  return hooks.filter(
    (hookWithMatcher) =>
      !hookWithMatcher.hooks?.some((hook) => isCoreHookCommand(hook.command || ""))
  );
}

export async function setupHooks(options: SetupHooksOptions): Promise<void> {
  const spinner = ora("Finding Claude Code configuration...").start();

  try {
    // Find Claude Code config
    const configPath = findClaudeConfigPath();
    if (!configPath) {
      spinner.fail("Could not find Claude Code configuration directory");
      console.log(
        chalk.yellow("\nMake sure Claude Code is installed and has been run at least once.")
      );
      process.exit(1);
    }

    spinner.text = "Reading current configuration...";
    const settings = readClaudeSettings(configPath);

    // Check for existing CORE hooks
    if (hasExistingCoreHooks(settings) && !options.force) {
      spinner.stop();
      console.log(chalk.yellow("\n⚠️  CORE Memory hooks are already configured."));

      const { overwrite } = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: "Do you want to overwrite the existing configuration?",
          default: false,
        },
      ]);

      if (!overwrite) {
        console.log(chalk.blue("No changes made. Use --force to overwrite without prompting."));
        return;
      }
      spinner.start("Updating configuration...");
    }

    // Get API key if not provided
    let apiKey = options.apiKey;
    if (!apiKey && !process.env.CORE_MEMORY_API_KEY) {
      spinner.stop();
      console.log(chalk.cyan("\n📋 API Key Configuration"));
      console.log(
        chalk.gray("You can get your API key from: https://getcore.ai/settings/api-keys\n")
      );

      const { keyChoice } = await inquirer.prompt([
        {
          type: "list",
          name: "keyChoice",
          message: "How would you like to configure the API key?",
          choices: [
            { name: "Enter API key now (will be stored in hook command)", value: "enter" },
            { name: "Use environment variable (CORE_MEMORY_API_KEY)", value: "env" },
            { name: "Skip for now (configure later)", value: "skip" },
          ],
        },
      ]);

      if (keyChoice === "enter") {
        const { key } = await inquirer.prompt([
          {
            type: "password",
            name: "key",
            message: "Enter your CORE Memory API key:",
            mask: "*",
          },
        ]);
        apiKey = key;
      } else if (keyChoice === "skip") {
        console.log(
          chalk.yellow(
            "\n⚠️  Remember to set CORE_MEMORY_API_KEY environment variable before using the hooks."
          )
        );
      }

      spinner.start("Configuring hooks...");
    }

    // Get scripts directory
    const scriptsDir = getScriptsDir();

    // Check if scripts exist
    const requiredScripts = [
      "session-start-hook.js",
      "prompt-submit-hook.js",
      "post-tool-use-hook.js",
      "stop-hook.js",
      "session-end-hook.js",
    ];

    for (const script of requiredScripts) {
      const scriptPath = path.join(scriptsDir, script);
      if (!fs.existsSync(scriptPath)) {
        spinner.fail(`Missing required script: ${scriptPath}`);
        console.log(chalk.yellow("\nPlease reinstall @core-memory/cli package."));
        process.exit(1);
      }
    }

    // Generate hook configs
    const hookConfigs = generateHookConfigs(scriptsDir, options.url, apiKey);

    // Build new settings with all hook types
    const newSettings: ClaudeSettings = {
      ...settings,
      hooks: {
        ...settings.hooks,
      },
    };

    // Add each hook type
    for (const hookType of CORE_HOOK_TYPES) {
      const existingHooks = settings.hooks?.[hookType] || [];
      const filteredHooks = filterOutCoreHooks(existingHooks);
      const hookConfig = hookConfigs[hookType];

      newSettings.hooks![hookType] = [
        ...filteredHooks,
        {
          hooks: [
            {
              type: "command",
              command: hookConfig.script,
              timeout: hookConfig.timeout,
            },
          ],
        },
      ];
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan("\n📋 Dry run - no changes will be made\n"));
      console.log(chalk.gray("Config path:"), configPath);
      console.log(chalk.gray("Scripts dir:"), scriptsDir);
      console.log(chalk.gray("\nNew configuration:"));
      console.log(JSON.stringify(newSettings.hooks, null, 2));
      return;
    }

    // Write the new settings
    writeClaudeSettings(configPath, newSettings);

    spinner.succeed("CORE Memory hooks configured successfully!");

    console.log(chalk.green("\n✅ Setup complete!\n"));
    console.log(chalk.gray("Configuration file:"), configPath);
    console.log(chalk.gray("API endpoint:"), options.url);
    console.log(chalk.gray("Scripts directory:"), scriptsDir);

    console.log(chalk.cyan("\n📝 Hooks configured:"));
    for (const hookType of CORE_HOOK_TYPES) {
      const config = hookConfigs[hookType];
      console.log(`   • ${hookType.padEnd(18)} - ${config.description}`);
    }

    console.log(chalk.cyan("\n🎯 What happens now:"));
    console.log("   • Conversations will be automatically ingested when you stop/exit Claude");
    console.log("   • No need to manually call memory_ingest - it's all automatic!");
    console.log("   • Previous context will be available in future sessions");

    if (!apiKey && !process.env.CORE_MEMORY_API_KEY) {
      console.log(
        chalk.yellow("\n⚠️  Don't forget to set CORE_MEMORY_API_KEY in your environment:")
      );
      console.log(chalk.gray("   export CORE_MEMORY_API_KEY=your_api_key_here"));
    }

    console.log(chalk.cyan("\n🔍 To verify the setup, run:"));
    console.log(chalk.gray("   npx @core-memory/cli status"));
  } catch (error) {
    spinner.fail("Failed to configure hooks");
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
