import fs from "fs";
import path from "path";

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".ai",
  "dist",
  "build"
]);

export function scanProject(root, maxDepth = 3) {
  const knownDirs = {};
  const knownFiles = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let fileCount = 0;

    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;

      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);

      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else {
        fileCount++;
        knownFiles.push(rel);
      }
    }

    if (fileCount > 0) {
      knownDirs[path.relative(root, dir) || "."] = fileCount;
    }
  }

  walk(root, 0);
  return { knownDirs, knownFiles };
}
