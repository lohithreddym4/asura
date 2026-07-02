import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommandRisk } from "../src/executor/executeCommands.js";

test("package installs are elevated above model-provided low risk", () => {
  assert.equal(classifyCommandRisk("pip install -r requirements.txt", "low"), "medium");
  assert.equal(classifyCommandRisk("npm install express", "low"), "medium");
});

test("global package mutations are high risk", () => {
  assert.equal(classifyCommandRisk("npm install -g asura-agent", "low"), "high");
});

test("read-only commands can remain low risk", () => {
  assert.equal(classifyCommandRisk("git status", "low"), "low");
});
