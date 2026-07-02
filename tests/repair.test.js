import assert from "node:assert/strict";
import test from "node:test";
import { buildRepairInstruction } from "../src/runtime/repair.js";

test("buildRepairInstruction includes failure context and repair constraints", () => {
  const failedPlan = {
    intent: "command",
    summary: "Install dependencies",
    clarification: null,
    files: [],
    commands: [
      { cmd: "npm install missing-package", risk: "low" }
    ],
    refusal: null
  };

  const prompt = buildRepairInstruction({
    originalInstruction: "set up the project",
    failedPlan,
    error: new Error("Command exited with code 1"),
    attempt: 1,
    maxAttempts: 2
  });

  assert.match(prompt, /Original user request: set up the project/);
  assert.match(prompt, /Command exited with code 1/);
  assert.match(prompt, /npm install missing-package/);
  assert.match(prompt, /Do not repeat the same failing command/);
});
