#!/usr/bin/env node
import { Command } from "commander";
import { setupHooks } from "./commands/setup-hooks";

const program = new Command();

program
  .name("core-memory")
  .description("CORE Memory CLI - Setup and manage CORE Memory integrations")
  .version("0.1.0");

program
  .command("setup-hooks")
  .description("Configure Claude Code hooks for CORE Memory session tracking")
  .option("-u, --url <url>", "CORE Memory API URL", "https://api.getcore.ai")
  .option("-k, --api-key <key>", "CORE Memory API key")
  .option("-f, --force", "Overwrite existing hooks without prompting", false)
  .option("--dry-run", "Show what would be changed without modifying files", false)
  .action(setupHooks);

program
  .command("remove-hooks")
  .description("Remove CORE Memory hooks from Claude Code configuration")
  .option("--dry-run", "Show what would be changed without modifying files", false)
  .action(async (options) => {
    const { removeHooks } = await import("./commands/remove-hooks");
    await removeHooks(options);
  });

program
  .command("status")
  .description("Check CORE Memory hooks status in Claude Code")
  .action(async () => {
    const { checkStatus } = await import("./commands/status");
    await checkStatus();
  });

program.parse();
