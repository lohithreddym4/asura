import fs from "fs";
import path from "path";
import { MemoryStore } from "../memory/store.js";

function checkpointId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function projectRoot(memory) {
  return path.resolve(memory.get("project_root") || process.cwd());
}

export function createCheckpoint(files) {
  const memory = new MemoryStore();
  const root = projectRoot(memory);
  const id = checkpointId();
  const dir = path.join(root, ".ai", "checkpoints");
  fs.mkdirSync(dir, { recursive: true });

  const touched = new Set();
  for (const file of files) {
    if (file.path) touched.add(file.path);
    if (file.to) touched.add(file.to);
  }

  const snapshot = {
    id,
    createdAt: new Date().toISOString(),
    files: Array.from(touched).map(relPath => {
      const absPath = path.resolve(root, relPath);
      const exists = fs.existsSync(absPath);
      return {
        path: relPath,
        exists,
        content: exists && fs.statSync(absPath).isFile()
          ? fs.readFileSync(absPath, "utf8")
          : null
      };
    })
  };

  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  memory.set("last_checkpoint", filePath);
  return snapshot;
}

export function rollbackLastCheckpoint() {
  const memory = new MemoryStore();
  const checkpointPath = memory.get("last_checkpoint");
  if (!checkpointPath || !fs.existsSync(checkpointPath)) {
    return false;
  }

  const root = projectRoot(memory);
  const snapshot = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  for (const file of snapshot.files) {
    const absPath = path.resolve(root, file.path);
    const rel = path.relative(root, absPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Unsafe checkpoint path: ${file.path}`);
    }

    if (!file.exists) {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      continue;
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content ?? "", "utf8");
  }

  return true;
}
