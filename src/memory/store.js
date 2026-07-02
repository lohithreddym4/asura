import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

function findProjectRoot(startDir = process.cwd()) {
  let dir = startDir;

  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return process.cwd();
}

export class MemoryStore {
  constructor() {
    const root = findProjectRoot();
    const aiDir = path.join(root, ".ai");


    if (!fs.existsSync(aiDir)) {
      fs.mkdirSync(aiDir, { recursive: true });
    }
    const gitignorePath = path.join(aiDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n", "utf8");
    }


    this.dbPath = path.join(aiDir, "memory.db");
    this.db = new Database(this.dbPath);
    this.init();

  }
  init() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        tokens TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_documents_path
      ON documents(path)
    `).run();
  }

  set(key, value) {
    this.db.prepare(`
      INSERT INTO memory (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  get(key) {
    const row = this.db
      .prepare(`SELECT value FROM memory WHERE key = ?`)
      .get(key);
    return row?.value ?? null;
  }

  all() {
    const rows = this.db.prepare(`SELECT key, value FROM memory`).all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  clear() {
    this.db.prepare(`DELETE FROM memory`).run();
  }
  getJSON(key, fallback) {
    const val = this.get(key);
    if (!val) return fallback;
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }

  setJSON(key, value) {
    this.set(key, JSON.stringify(value));
  }
  hasScanned() {
    return this.get("dir_scanned") === "true";
  }
  
  markScanned() {
    this.set("dir_scanned", "true");
  }

  replaceDocuments(documents) {
    const insert = this.db.prepare(`
      INSERT INTO documents (
        id,
        path,
        start_line,
        end_line,
        content,
        tokens,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((rows) => {
      this.db.prepare(`DELETE FROM documents`).run();
      for (const row of rows) {
        insert.run(
          row.id,
          row.path,
          row.startLine,
          row.endLine,
          row.content,
          JSON.stringify(row.tokens),
          row.updatedAt
        );
      }
    });

    tx(documents);
    this.set("rag_indexed_at", String(Date.now()));
    this.set("rag_document_count", String(documents.length));
  }

  allDocuments() {
    const rows = this.db.prepare(`
      SELECT id, path, start_line AS startLine, end_line AS endLine, content, tokens, updated_at AS updatedAt
      FROM documents
    `).all();

    return rows.map(row => ({
      ...row,
      tokens: JSON.parse(row.tokens)
    }));
  }
  

}

