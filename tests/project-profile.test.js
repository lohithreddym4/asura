import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProjectProfile, validationCommandsForFiles } from "../src/project/profile.js";

test("detectProjectProfile detects node scripts and package manager", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asura-profile-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test", lint: "eslint ." },
    dependencies: { react: "latest" }
  }), "utf8");

  const profile = detectProjectProfile(root);

  assert.equal(profile.packageManager, "npm");
  assert.ok(profile.frameworks.includes("react"));
  assert.equal(profile.testCommand, "npm test");
  assert.equal(profile.venv, false);
});

test("validationCommandsForFiles emits safe syntax checks", () => {
  const commands = validationCommandsForFiles([
    { action: "modify", path: "src/app.js", content: "console.log(1);" },
    { action: "modify", path: "main.py", content: "print(1)" }
  ], { python: true, venv: false });

  assert.ok(commands.some(command => command.cmd.includes("node --check")));
  assert.ok(commands.some(command => command.cmd === "python -m py_compile \"main.py\""));
});
