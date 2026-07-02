import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRagIndex, retrieveDocuments } from "../src/memory/rag.js";

test("buildRagIndex chunks searchable project files and skips secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asura-rag-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src", "planner.js"),
    "export const planner = () => 'schema validation';\n",
    "utf8"
  );
  fs.writeFileSync(path.join(root, ".env"), "SECRET=value\n", "utf8");

  const docs = buildRagIndex(root);
  const paths = docs.map(doc => doc.path);

  assert.ok(paths.includes("src/planner.js"));
  assert.ok(!paths.includes(".env"));

  const hits = retrieveDocuments("planner schema", docs, { limit: 1 });
  assert.equal(hits[0].path, "src/planner.js");
});
