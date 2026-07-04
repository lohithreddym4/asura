import fs from "fs";
import path from "path";

function exists(root, file) {
  return fs.existsSync(path.join(root, file));
}

function readJSON(root, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return null;
  }
}

export function detectProjectProfile(root = process.cwd()) {
  const packageJson = readJSON(root, "package.json");
  const hasPython = exists(root, "requirements.txt") ||
    exists(root, "pyproject.toml") ||
    fs.readdirSync(root).some(name => name.endsWith(".py"));

  const packageManager = exists(root, "pnpm-lock.yaml")
    ? "pnpm"
    : exists(root, "yarn.lock")
      ? "yarn"
      : packageJson
        ? "npm"
        : null;

  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };

  const frameworks = [];
  if (deps.react) frameworks.push("react");
  if (deps.next) frameworks.push("next");
  if (deps.vite) frameworks.push("vite");
  if (exists(root, "pyproject.toml") || exists(root, "requirements.txt")) frameworks.push("python");

  const sourceDirs = ["src", "app", "lib", "tests"]
    .filter(dir => fs.existsSync(path.join(root, dir)));

  const scripts = packageJson?.scripts || {};
  return {
    languages: [
      packageJson ? "javascript" : null,
      hasPython ? "python" : null
    ].filter(Boolean),
    packageManager,
    frameworks,
    sourceDirs,
    testCommand: scripts.test ? `${packageManager || "npm"} test` : hasPython ? "python -m pytest" : null,
    lintCommand: scripts.lint ? `${packageManager || "npm"} run lint` : null,
    node: Boolean(packageJson),
    python: hasPython,
    venv: exists(root, ".venv")
  };
}

export function validationCommandsForFiles(files, profile, root = process.cwd()) {
  const commands = [];
  for (const file of files) {
    if (!["create", "modify"].includes(file.action)) continue;
    if (/\.(mjs|cjs|js)$/i.test(file.path)) {
      commands.push({ cmd: `node --check "${file.path}"`, risk: "low" });
    }
    if (/\.py$/i.test(file.path)) {
      const hasVenv = profile?.venv || fs.existsSync(path.join(root, ".venv"));
      const python = hasVenv
        ? process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python"
        : "python";
      commands.push({ cmd: `${python} -m py_compile "${file.path}"`, risk: "low" });
    }
  }
  return commands;
}
