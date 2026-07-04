import fs from "fs";
import path from "path";
import readline from "readline";
import { createTwoFilesPatch } from "diff";
import chalk from "chalk";
import { createCheckpoint } from "./checkpoint.js";
import { MemoryStore } from "../memory/store.js";

let memory;

function getMemory() {
  if (!memory) {
    memory = new MemoryStore();
  }

  return memory;
}

export async function applyFileActions(files, { dryRun, autoYes }) {
  if (!dryRun && files.length > 0) {
    createCheckpoint(files);
  }

  const writeFiles = files.filter(file => ["create", "modify"].includes(file.action));
  const onlyWrites = writeFiles.length === files.length;
  let batchApproved = false;

  if (onlyWrites && writeFiles.length > 1 && !dryRun && !autoYes) {
    console.log(`\nPlanned file changes (${writeFiles.length}):`);
    for (const file of writeFiles) {
      console.log(`- ${file.action}: ${file.path}`);
    }
    batchApproved = await confirm("Apply all file changes? (y/n): ");
    if (!batchApproved) {
      console.log(chalk.gray("Skipped all file changes."));
      return;
    }
  }

  for (const file of files) {
    switch (file.action) {
      case "create":
      case "modify":
        await applyWrite(file, dryRun, autoYes || batchApproved);
        break;

      case "rename":
        await applyRename(file, dryRun, autoYes);
        break;

      case "delete":
        await applyDelete(file, dryRun, autoYes);
        break;

      default:
        throw new Error(`Unknown file action: ${file.action}`);
    }
  }
}

function recordUndo(undo) {
  getMemory().setJSON("last_undo", undo);
}

function projectRoot() {
  const store = getMemory();
  return path.resolve(store.get("project_root") || process.cwd());
}

function resolveSafePath(filePath) {
  const root = projectRoot();
  const absPath = path.resolve(root, filePath);
  const rel = path.relative(root, absPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Unsafe path outside project root: ${filePath}`);
  }

  return absPath;
}

function canAutoApprove(file) {
  return file.action === "create" || file.action === "modify";
}

async function applyWrite(file, dryRun, autoYes) {
  const absPath = resolveSafePath(file.path);

  console.log(`\nFile ${chalk.cyan(file.path)} (${chalk.yellow(file.action)})`);

  const existed = fs.existsSync(absPath);
  const oldContent = existed ? fs.readFileSync(absPath, "utf8") : "";
  const newContent = file.content.endsWith("\n")
    ? file.content
    : `${file.content}\n`;

  const diff = createTwoFilesPatch(
    "before",
    "after",
    oldContent,
    newContent,
    "",
    ""
  );

  if (!diff.trim()) {
    console.log(chalk.gray("No changes detected."));
    return;
  }

  console.log(diff);

  if (dryRun) {
    console.log(chalk.yellow("Dry-run: change not applied."));
    return;
  }

  if (!(autoYes && canAutoApprove(file))) {
    const confirmed = await confirm("Apply this change? (y/n): ");
    if (!confirmed) {
      console.log(chalk.gray("Skipped."));
      return;
    }
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, newContent, "utf8");
  recordUndo(existed
    ? { action: "modify", path: file.path, content: oldContent }
    : { action: "delete", path: file.path }
  );

  console.log(chalk.green("Applied."));
  updateMemory(file);
}

async function applyRename(file, dryRun, autoYes) {
  const from = resolveSafePath(file.path);
  const to = resolveSafePath(file.to);

  console.log(`\nFile ${chalk.cyan(file.path)} -> ${chalk.cyan(file.to)} (${chalk.yellow("rename")})`);

  if (!fs.existsSync(from)) {
    throw new Error(`Source file does not exist: ${file.path}`);
  }

  if (fs.existsSync(to)) {
    throw new Error(`Target file already exists: ${file.to}`);
  }

  if (dryRun) {
    console.log(chalk.yellow("Dry-run: rename not applied."));
    return;
  }

  const confirmed = await confirm("Apply this rename? (y/n): ");
  if (!confirmed) {
    console.log(chalk.gray("Skipped."));
    return;
  }

  recordUndo({
    action: "rename",
    path: file.to,
    to: file.path
  });

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);

  console.log(chalk.green("Renamed."));
  updateMemory({
    ...file,
    path: file.to
  });
}

async function applyDelete(file, dryRun, autoYes) {
  const absPath = resolveSafePath(file.path);

  console.log(`\nFile ${chalk.cyan(file.path)} (${chalk.red("delete")})`);

  if (!fs.existsSync(absPath)) {
    console.log(chalk.gray("File does not exist. Skipped."));
    return;
  }

  if (dryRun) {
    console.log(chalk.yellow("Dry-run: delete not applied."));
    return;
  }

  const confirmed = await confirm("Delete this file? (y/n): ");
  if (!confirmed) {
    console.log(chalk.gray("Skipped."));
    return;
  }

  const oldContent = fs.readFileSync(absPath, "utf8");
  recordUndo({
    action: "create",
    path: file.path,
    content: oldContent
  });

  fs.unlinkSync(absPath);
  console.log(chalk.green("Deleted."));
  cleanupMemoryAfterDelete(file.path);
}

function cleanupMemoryAfterDelete(pathToRemove) {
  const store = getMemory();
  const known = store.getJSON("known_files", []);
  store.setJSON(
    "known_files",
    known.filter(f => f !== pathToRemove)
  );

  const recent = store.getJSON("recent_files", []);
  store.setJSON(
    "recent_files",
    recent.filter(f => f !== pathToRemove)
  );

  if (store.get("last_file") === pathToRemove) {
    store.set("last_file", "");
  }

  store.set("last_action", "delete");
}

function confirm(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      const v = answer.trim()?.toLowerCase();
      resolve(v === "y" || v === "yes");
    });
  });
}

function updateMemory(file) {
  const store = getMemory();
  const dir = path.dirname(file.path);

  const dirs = store.getJSON("known_dirs", {});
  dirs[dir] = (dirs[dir] || 0) + 1;
  store.setJSON("known_dirs", dirs);

  const known = store.getJSON("known_files", []);
  if (!known.includes(file.path)) {
    store.setJSON("known_files", [...known, file.path].slice(-50));
  }

  const recent = store.getJSON("recent_files", []);
  const next = [file.path, ...recent.filter(f => f !== file.path)].slice(0, 5);
  store.setJSON("recent_files", next);
  store.set("last_file", file.path);
  store.set("last_action", file.action);
}
