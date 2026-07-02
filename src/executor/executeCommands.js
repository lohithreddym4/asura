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
  /(^|\s|[\\/])(pip|pip3)(\.exe)?\s+(install|uninstall)\b/i,
  /\bpython\s+-m\s+pip\s+(install|uninstall)\b/i,
  /\bpoetry\s+(add|remove|install|update)\b/i,
  /\buv\s+(add|remove|pip\s+install|pip\s+uninstall)\b/i
];

const GLOBAL_PACKAGE_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+.*\s(-g|--global)\b/i,
  /(^|\s|[\\/])(pip|pip3)(\.exe)?\s+install\b.*\s(--user|--break-system-packages)\b/i
];

export class CommandExecutionError extends Error {
  constructor(command, message, output = "") {
    super(message);
    this.name = "CommandExecutionError";
    this.command = command;
    this.output = output;
  }
}

export async function executeCommands(commands, { dryRun, autoYes }) {
  for (const command of commands) {
    const cmd = normalizePlatformCommand(command.cmd);
    const risk = classifyCommandRisk(cmd, command.risk);

    console.log(`\nCommand ${chalk.cyan(cmd)} (${chalk.yellow(risk)})`);

    if (isChained(cmd)) {
      throw new CommandExecutionError(
        cmd,
        `Command chaining is blocked: ${cmd}`
      );
    }

    if (isDangerousCommand(cmd)) {
      throw new CommandExecutionError(
        cmd,
        `Dangerous command blocked: ${cmd}`
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
      await run(normalizeQuotes(cmd));
    } catch (err) {
      throw new CommandExecutionError(cmd, err.message, err.output || "");
    }
  }
}

export function normalizePlatformCommand(cmd, platform = process.platform) {
  if (platform !== "win32") return cmd;

  return cmd
    .replace(/(^|\s)\.venv\/bin\/python(\.exe)?(?=\s|$)/gi, "$1.venv\\Scripts\\python.exe")
    .replace(/(^|\s)\.venv\/bin\/pip(\.exe)?(?=\s|$)/gi, "$1.venv\\Scripts\\pip.exe")
    .replace(/(^|\s)venv\/bin\/python(\.exe)?(?=\s|$)/gi, "$1venv\\Scripts\\python.exe")
    .replace(/(^|\s)venv\/bin\/pip(\.exe)?(?=\s|$)/gi, "$1venv\\Scripts\\pip.exe");
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
    let output = "";
    const proc = spawn(command, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true
    });

    proc.stdout.on("data", chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      output = trimOutput(`${output}${text}`);
    });

    proc.stderr.on("data", chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      output = trimOutput(`${output}${text}`);
    });

    proc.on("close", code => {
      if (code !== 0) {
        const err = new Error([
          `Command exited with code ${code}`,
          output ? `Recent command output:\n${output}` : ""
        ].filter(Boolean).join("\n"));
        err.output = output;
        reject(err);
      } else {
        resolve();
      }
    });

    proc.on("error", err => {
      reject(err);
    });
  });
}

function trimOutput(output) {
  const max = 12000;
  return output.length > max ? output.slice(output.length - max) : output;
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
