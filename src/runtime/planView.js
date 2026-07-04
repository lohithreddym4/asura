export function printPlan(plan, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log("");
  console.log(`Plan: ${plan.summary}`);
  console.log(`Intent: ${plan.intent}`);

  if (plan.refusal) {
    console.log(`Refusal: ${plan.refusal}`);
    return;
  }

  if (plan.clarification) {
    console.log(`Clarification: ${plan.clarification}`);
    return;
  }

  if (plan.files.length > 0) {
    console.log("Files:");
    for (const file of plan.files) {
      const target = file.action === "rename" ? `${file.path} -> ${file.to}` : file.path;
      console.log(`- ${file.action}: ${target}`);
    }
  }

  if (plan.commands.length > 0) {
    console.log("Commands:");
    for (const command of plan.commands) {
      console.log(`- [${command.risk}] ${command.cmd}`);
    }
  }

  const why = [
    plan.files.length > 0 ? "file changes requested" : null,
    plan.commands.length > 0 ? "tooling or execution requested" : null
  ].filter(Boolean).join("; ") || "no executable action required";
  console.log(`Why: ${why}.`);
}
