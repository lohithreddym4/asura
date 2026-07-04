import { getConfig, setConfig } from "../config/store.js";

const POLICIES = new Set(["safe", "dev", "auto"]);

export function getExecutionPolicy(override) {
  const config = getConfig();
  const policy = override || config.executionPolicy || "dev";
  return POLICIES.has(policy) ? policy : "dev";
}

export function setExecutionPolicy(policy) {
  if (!POLICIES.has(policy)) {
    throw new Error(`Invalid execution policy: ${policy}`);
  }
  setConfig("executionPolicy", policy);
}

export function isInstallCommand(cmd) {
  return /\b(npm|pnpm|yarn)\s+(install|add|update|upgrade|remove|uninstall|i)\b/i.test(cmd) ||
    /(^|\s|[\\/])(pip|pip3)(\.exe)?\s+(install|uninstall)\b/i.test(cmd) ||
    /\bpython\s+-m\s+pip\s+(install|uninstall)\b/i.test(cmd);
}

export function shouldPromptForCommand({ risk, policy, autoYes, cmd }) {
  if (policy === "safe" && isInstallCommand(cmd)) return true;
  if (policy === "auto") return risk === "high";
  if (autoYes && risk === "low") return false;
  return risk !== "low";
}

export function policyBlocksCommand({ policy, cmd, autoYes }) {
  return policy === "safe" && isInstallCommand(cmd) && autoYes;
}
