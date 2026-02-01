import { spawn } from "child_process";
import readline from "readline";
import chalk from "chalk";

/**
 * Commands that can cause irreversible system damage.
 * This is intentionally SMALL and explicit.
 */
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


/**
 * Block shell chaining even with shell:true
 */
const BLOCK_PATTERNS = ["&&", "|", ";"];

export async function executeCommands(commands, { dryRun, autoYes }) {
  for (const c of commands) {
    console.log(
      `\n⚙️  ${chalk.cyan(c.cmd)} (${chalk.yellow(c.risk)})`
    );

    if (isChained(c.cmd)) {
      throw new Error(`Command chaining is blocked: ${c.cmd}`);
    }

    if (isDangerousCommand(c.cmd)) {
      throw new Error(`Dangerous command blocked: ${c.cmd}`);
    }

    if (dryRun) {
      console.log(chalk.yellow("🟡 Dry-run: command not executed."));
      continue;
    }

    if (c.risk === "high" && !autoYes) {
      const ok = await confirm("⚠️ High-risk command. Proceed? (y/n): ");
      if (!ok) {
        console.log(chalk.gray("Skipped."));
        continue;
      }
    }
    

    await run(normalizeQuotes(c.cmd));
  }
}
function normalizeQuotes(cmd) {
  // Replace single-quoted strings with double-quoted strings
  return cmd.replace(/'([^']*)'/g, (_, inner) => `"${inner}"`);
}


/**
 * Detect truly dangerous commands
 */
function isDangerousCommand(cmd) {
  return DANGEROUS_PATTERNS.some(rx => rx.test(cmd));
}

/**
 * Block command chaining operators
 */
function isChained(cmd) {
  return BLOCK_PATTERNS.some(p => cmd.includes(p));
}

/**
 * Execute command via shell for cross-platform support
 */
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

/**
 * Explicit confirmation for high-risk commands
 */
function confirm(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      const v = answer.trim()?.toLowerCase();
      resolve(v === "y" || v === "yes");
    });
  });
}
