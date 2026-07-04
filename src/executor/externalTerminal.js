import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function quotePowerShellSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function createRunPaths(root = process.cwd()) {
  const runDir = path.join(root, ".ai", "runs", safeRunId());
  fs.mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    scriptPath: path.join(runDir, "run.ps1"),
    logPath: path.join(runDir, "output.log"),
    exitCodePath: path.join(runDir, "exit-code.txt")
  };
}

export function buildPowerShellRunScript({ command, cwd, logPath, exitCodePath }) {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$AsuraCommand = ${quotePowerShellSingle(command)}`,
    `$AsuraLog = ${quotePowerShellSingle(logPath)}`,
    `$AsuraExit = ${quotePowerShellSingle(exitCodePath)}`,
    `$AsuraCwd = ${quotePowerShellSingle(cwd)}`,
    "Set-Location -LiteralPath $AsuraCwd",
    "\"Command: $AsuraCommand\" | Tee-Object -FilePath $AsuraLog",
    "\"Working directory: $AsuraCwd\" | Tee-Object -FilePath $AsuraLog -Append",
    "\"\" | Tee-Object -FilePath $AsuraLog -Append",
    "cmd.exe /d /s /c $AsuraCommand 2>&1 | Tee-Object -FilePath $AsuraLog -Append",
    "$AsuraCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "Set-Content -LiteralPath $AsuraExit -Value $AsuraCode",
    "\"\" | Tee-Object -FilePath $AsuraLog -Append",
    "\"Exit code: $AsuraCode\" | Tee-Object -FilePath $AsuraLog -Append",
    "Read-Host 'Process finished. Press Enter to close this terminal'",
    "exit $AsuraCode",
    ""
  ].join("\r\n");
}

export async function runInExternalTerminal(command, { cwd = process.cwd() } = {}) {
  if (process.platform !== "win32") {
    return null;
  }

  const paths = createRunPaths(cwd);
  const script = buildPowerShellRunScript({
    command,
    cwd,
    logPath: paths.logPath,
    exitCodePath: paths.exitCodePath
  });

  fs.writeFileSync(paths.scriptPath, script, "utf8");

  const psCommand = [
    "$p = Start-Process powershell.exe",
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${quotePowerShellSingle(paths.scriptPath)})`,
    "-Wait -PassThru;",
    "exit $p.ExitCode"
  ].join(" ");

  const code = await runPowerShellWait(psCommand);
  const output = fs.existsSync(paths.logPath)
    ? fs.readFileSync(paths.logPath, "utf8")
    : "";

  return {
    code,
    output,
    logPath: paths.logPath,
    exitCodePath: paths.exitCodePath
  };
}

function runPowerShellWait(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
      windowsHide: true
    });

    proc.on("close", code => resolve(code ?? 1));
    proc.on("error", err => reject(err));
  });
}
