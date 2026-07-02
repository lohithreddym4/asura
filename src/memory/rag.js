import fs from "fs";
import path from "path";

const IGNORE_DIRS = new Set([
  ".ai",
  ".git",
  "coverage",
  "dist",
  "build",
  "node_modules"
]);

const IGNORE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json"
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const MAX_FILE_BYTES = 200_000;
const CHUNK_LINES = 80;
const CHUNK_OVERLAP = 12;

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function tokenize(text) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9_./-]{2,}/g) || []
    )
  );
}

function shouldIndexFile(filePath) {
  if (IGNORE_FILES.has(path.basename(filePath))) return false;
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function walkFiles(root, dir = root, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        walkFiles(root, path.join(dir, entry.name), files);
      }
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (!shouldIndexFile(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_FILE_BYTES) continue;

    files.push(fullPath);
  }

  return files;
}

export function buildRagIndex(root) {
  const now = Date.now();
  const documents = [];

  for (const fullPath of walkFiles(root)) {
    const relPath = normalizePath(path.relative(root, fullPath));
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
      const chunkLines = lines.slice(start, start + CHUNK_LINES);
      const chunkContent = chunkLines.join("\n").trim();
      if (!chunkContent) continue;

      const startLine = start + 1;
      const endLine = start + chunkLines.length;
      const id = `${relPath}:${startLine}-${endLine}`;
      const searchText = `${relPath}\n${chunkContent}`;

      documents.push({
        id,
        path: relPath,
        startLine,
        endLine,
        content: chunkContent,
        tokens: tokenize(searchText),
        updatedAt: now
      });
    }
  }

  return documents;
}

export function retrieveDocuments(query, documents, { limit = 6 } = {}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return documents
    .map(doc => {
      const docTokens = new Set(doc.tokens);
      const pathText = doc.path.toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        if (docTokens.has(token)) score += 3;
        if (pathText.includes(token)) score += 2;
      }

      return { ...doc, score };
    })
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export function formatRetrievedContext(results) {
  if (results.length === 0) return "(none)";

  return results.map(doc => {
    const excerpt = doc.content.length > 1800
      ? `${doc.content.slice(0, 1800)}\n...`
      : doc.content;

    return [
      `File: ${doc.path}:${doc.startLine}-${doc.endLine}`,
      `Score: ${doc.score}`,
      "Snippet:",
      excerpt
    ].join("\n");
  }).join("\n\n---\n\n");
}
