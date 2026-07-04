import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommandRisk,
  expandEnvironmentCommands,
  normalizePlatformCommand
} from "../src/executor/executeCommands.js";

test("package installs are elevated above model-provided low risk", () => {
  assert.equal(classifyCommandRisk("pip install -r requirements.txt", "low"), "medium");
  assert.equal(classifyCommandRisk("npm install express", "low"), "medium");
  assert.equal(classifyCommandRisk(".venv\\Scripts\\pip.exe install -r requirements.txt", "low"), "medium");
});

test("global package mutations are high risk", () => {
  assert.equal(classifyCommandRisk("npm install -g asura-agent", "low"), "high");
});

test("read-only commands can remain low risk", () => {
  assert.equal(classifyCommandRisk("git status", "low"), "low");
});

test("windows normalizes common POSIX virtualenv paths", () => {
  assert.equal(
    normalizePlatformCommand(".venv/bin/pip install -r requirements.txt", "win32"),
    ".venv\\Scripts\\pip.exe install -r requirements.txt"
  );
  assert.equal(
    normalizePlatformCommand(".venv/bin/python main.py", "win32"),
    ".venv\\Scripts\\python.exe main.py"
  );
});

test("python pip installs are expanded into project virtualenv commands", () => {
  const commands = expandEnvironmentCommands(
    [{ cmd: "pip install -r requirements.txt", risk: "medium" }],
    { profile: { python: true }, projectRoot: process.cwd() }
  );

  assert.equal(commands[0].cmd, "python -m venv .venv");
  assert.match(commands[1].cmd, /\.venv/);
  assert.match(commands[1].cmd, /pip/);
});
