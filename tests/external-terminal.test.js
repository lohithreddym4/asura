import assert from "node:assert/strict";
import test from "node:test";
import { buildPowerShellRunScript } from "../src/executor/externalTerminal.js";

test("buildPowerShellRunScript captures output and exit code", () => {
  const script = buildPowerShellRunScript({
    command: "python main.py",
    cwd: "A:\\asura-test",
    logPath: "A:\\asura-test\\.ai\\runs\\1\\output.log",
    exitCodePath: "A:\\asura-test\\.ai\\runs\\1\\exit-code.txt"
  });

  assert.match(script, /cmd\.exe \/d \/s \/c \$AsuraCommand/);
  assert.match(script, /Tee-Object -FilePath \$AsuraLog -Append/);
  assert.match(script, /Set-Content -LiteralPath \$AsuraExit -Value \$AsuraCode/);
  assert.match(script, /Read-Host 'Process finished/);
});

test("buildPowerShellRunScript escapes single quotes", () => {
  const script = buildPowerShellRunScript({
    command: "python -c \"print('hi')\"",
    cwd: "A:\\asura-test",
    logPath: "A:\\asura-test\\.ai\\runs\\1\\output.log",
    exitCodePath: "A:\\asura-test\\.ai\\runs\\1\\exit-code.txt"
  });

  assert.match(script, /print\(''hi''\)/);
});
