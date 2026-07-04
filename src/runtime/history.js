import fs from "fs";
import path from "path";

function runId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function startRunHistory(root, instruction, options = {}) {
  const id = runId();
  const dir = path.join(root, ".ai", "runs", id);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    id,
    instruction,
    startedAt: new Date().toISOString(),
    options,
    events: []
  };
  writeRunRecord(dir, record);
  return { id, dir, record };
}

export function addRunEvent(history, type, data = {}) {
  if (!history) return;
  history.record.events.push({
    type,
    at: new Date().toISOString(),
    ...data
  });
  writeRunRecord(history.dir, history.record);
}

export function finishRunHistory(history, status, data = {}) {
  if (!history) return;
  history.record.finishedAt = new Date().toISOString();
  history.record.status = status;
  Object.assign(history.record, data);
  writeRunRecord(history.dir, history.record);
}

export function listRuns(root = process.cwd()) {
  const runsDir = path.join(root, ".ai", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .map(id => {
      const file = path.join(runsDir, id, "run.json");
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

export function readRun(root, id) {
  const file = path.join(root, ".ai", "runs", id, "run.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeRunRecord(dir, record) {
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(record, null, 2), "utf8");
}
