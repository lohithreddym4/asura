import fs from "fs";
import os from "os";
import path from "path";

const CONFIG_DIR = path.join(os.homedir(), ".asura");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function ensureConfig() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
  }
}

export function getConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

export function setConfig(key, value) {
  ensureConfig();
  const config = getConfig();
  config[key] = value;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
