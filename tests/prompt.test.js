import assert from "node:assert/strict";
import test from "node:test";
import SYSTEM_PROMPT from "../src/planner/prompt.js";

test("system prompt describes LangGraph planning role and repair constraints", () => {
  assert.match(SYSTEM_PROMPT, /generatePlan node inside a LangGraph-powered local CLI agent/);
  assert.match(SYSTEM_PROMPT, /REPAIR MODE:/);
  assert.match(SYSTEM_PROMPT, /Retrieved project context as the strongest evidence/);
  assert.match(SYSTEM_PROMPT, /\.venv\\Scripts\\python\.exe/);
  assert.match(SYSTEM_PROMPT, /Output only valid JSON/i);
});
