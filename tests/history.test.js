import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addRunEvent, finishRunHistory, listRuns, startRunHistory } from "../src/runtime/history.js";

test("run history persists run records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asura-history-"));
  const history = startRunHistory(root, "do something", { dryRun: true });
  addRunEvent(history, "plan", { ok: true });
  finishRunHistory(history, "completed");

  const runs = listRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].instruction, "do something");
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].events[0].type, "plan");
});
