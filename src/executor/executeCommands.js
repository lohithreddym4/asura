import { spawn } from "child_process";
import readline from "readline";
import chalk from "chalk";

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\b/i,
  /\bcurl\b.*\|\s*(sh|bash)/i,
  /\bwget\b.*\|\s*(sh|bash)/i,
  />\s*\/dev\/sda/i
];

const BLOCK_PATTERNS = ["&&", "|", ";"];

const PACKAGE_MUTATION_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+(install|add|update|upgrade|remove|uninstall)\b/i,
  /\b(npm|pnpm|yarn)\s+i\b/i,
  /\b(npx)\b/i,
  /\b(pip|pip3)\s+(install|uninstall)\b/i,
  /\bpython\s+-m\s+pip\s+(install|uninstall)\b/i,
  /\bpoetry\s+(add|remove|install|update)\b/i,
  /\buv\s+(add|remove|pip\s+install|pip\s+uninstall)\b/i
];

const GLOBAL_PACKAGE_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+.*\s(-g|--global)\b/i,
  /\b(pip|pip3)\s+install\b.*\s(--user|--break-system-packages)\b/i
];

export class CommandExecutionError extends Error {
  constructor(command, message) {
    super(message);
    this.name = "CommandExecutionError";
    this.command = command;
  }
}

export async function executeCommands(commands, { dryRun, autoYes }) {
  for (const command of commands) {
    const risk = classifyCommandRisk(command.cmd, command.risk);

    console.log(`\nCommand ${chalk.cyan(command.cmd)} (${chalk.yellow(risk)})`);

    if (isChained(command.cmd)) {
      throw new CommandExecutionError(
        command.cmd,
        `Command chaining is blocked: ${command.cmd}`
      );
    }

    if (isDangerousCommand(command.cmd)) {
      throw new CommandExecutionError(
        command.cmd,
        `Dangerous command blocked: ${command.cmd}`
      );
    }

    if (dryRun) {
      console.log(chalk.yellow("Dry-run: command not executed."));
      continue;
    }

    if (risk !== "low") {
      const ok = await confirm(`${riskLabel(risk)} command. Proceed? (y/n): `);
      if (!ok) {
        console.log(chalk.gray("Skipped."));
        continue;
      }
    }

    try {
      await run(normalizeQuotes(command.cmd));
    } catch (err) {
      throw new CommandExecutionError(command.cmd, err.message);
    }
  }
}

export function classifyCommandRisk(cmd, modelRisk = "medium") {
  if (isDangerousCommand(cmd)) return "high";
  if (GLOBAL_PACKAGE_PATTERNS.some(rx => rx.test(cmd))) return "high";
  if (PACKAGE_MUTATION_PATTERNS.some(rx => rx.test(cmd))) return "medium";
  if (["low", "medium", "high"].includes(modelRisk)) return modelRisk;
  return "medium";
}

function riskLabel(risk) {
  return risk === "high" ? "High-risk" : "Medium-risk";
}

function normalizeQuotes(cmd) {
  return cmd.replace(/'([^']*)'/g, (_, inner) => `"${inner}"`);
}

function isDangerousCommand(cmd) {
  return DANGEROUS_PATTERNS.some(rx => rx.test(cmd));
}

function isChained(cmd) {
  return BLOCK_PATTERNS.some(p => cmd.includes(p));
}

function run(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      stdio: "inherit",
      shell: true
    });

    proc.on("close", code => {
      if (code !== 0) {
        reject(new Error(`Command exited with code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on("error", err => {
      reject(err);
    });
  });
}

function confirm(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      const value = answer.trim()?.toLowerCase();
      resolve(value === "y" || value === "yes");
    });
  });
}
