import fs from "fs";
import path from "path";
import readline from "readline";
import { createTwoFilesPatch } from "diff";
import chalk from "chalk";
import { MemoryStore } from "../memory/store.js";

const memory = new MemoryStore();

export async function applyFileActions(files, { dryRun, autoYes }) {

  for (const file of files) {
    switch (file.action) {
      case "create":
      case "modify":
        await applyWrite(file, dryRun, autoYes);
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
function recordUndo(file, previousContent = null) {
  const undo = {
    action: file.action,
    path: file.path,
    to: file.to || null,
    previousContent
  };

  memory.setJSON("last_undo", undo);
}
function canAutoApprove(file) {
  // Safe defaults
  if (file.action === "create") return true;
  if (file.action === "modify") return true;

  // NEVER auto-approve these
  if (file.action === "delete") return false;
  if (file.action === "rename") return false;

  return false;
}


async function applyWrite(file, dryRun, autoYes) {
  const absPath = path.resolve(file.path);

  console.log(
    `\n📄 ${chalk.cyan(file.path)} (${chalk.yellow(file.action)})`
  );
  let oldContent = "";
  recordUndo(
    { action: "modify", path: file.path },
    oldContent
  );

  if (fs.existsSync(absPath)) {
    oldContent = fs.readFileSync(absPath, "utf8");
  }

  const newContent = file.content.endsWith("\n")
    ? file.content
    : file.content + "\n";

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
    console.log(chalk.yellow("🟡 Dry-run: change not applied."));
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

  console.log(chalk.green("✅ Applied."));
  updateMemory(file)
}
async function applyRename(file, dryRun, autoYes) {
  const from = path.resolve(file.path);
  const to = path.resolve(file.to);

  console.log(
    `\n📄 ${chalk.cyan(file.path)} → ${chalk.cyan(file.to)} (${chalk.yellow("rename")})`
  );

  if (!fs.existsSync(from)) {
    throw new Error(`Source file does not exist: ${file.path}`);
  }

  if (fs.existsSync(to)) {
    throw new Error(`Target file already exists: ${file.to}`);
  }

  if (dryRun) {
    console.log(chalk.yellow("🟡 Dry-run: rename not applied."));
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

  console.log(chalk.green("✅ Renamed."));
  updateMemory({
    ...file,
    path: file.to
  })


}

async function applyDelete(file, dryRun, autoYes) {
  const absPath = path.resolve(file.path);

  console.log(
    `\n📄 ${chalk.cyan(file.path)} (${chalk.red("delete")})`
  );

  if (!fs.existsSync(absPath)) {
    console.log(chalk.gray("File does not exist. Skipped."));
    return;
  }

  if (dryRun) {
    console.log(chalk.yellow("🟡 Dry-run: delete not applied."));
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
  console.log(chalk.green("✅ Deleted."));
  cleanupMemoryAfterDelete(file.path)

}
function cleanupMemoryAfterDelete(pathToRemove) {
  // known_files
  const known = memory.getJSON("known_files", []);
  memory.setJSON(
    "known_files",
    known.filter(f => f !== pathToRemove)
  );

  // recent_files
  const recent = memory.getJSON("recent_files", []);
  memory.setJSON(
    "recent_files",
    recent.filter(f => f !== pathToRemove)
  );

  if (memory.get("last_file") === pathToRemove) {
    memory.set("last_file", "");
  }

  memory.set("last_action", "delete");
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
  const dir = path.dirname(file.path);

  // known_dirs
  const dirs = memory.getJSON("known_dirs", {});
  dirs[dir] = (dirs[dir] || 0) + 1;
  memory.setJSON("known_dirs", dirs);

  // known_files
  const known = memory.getJSON("known_files", []);
  if (!known.includes(file.path)) {
    memory.setJSON("known_files", [...known, file.path].slice(-50));
  }

  // recent_files + last_file
  const recent = memory.getJSON("recent_files", []);
  const next = [file.path, ...recent.filter(f => f !== file.path)].slice(0, 5);
  memory.setJSON("recent_files", next);
  memory.set("last_file", file.path);

  memory.set("last_action", file.action);
}
