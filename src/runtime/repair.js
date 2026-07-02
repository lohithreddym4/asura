export function buildRepairInstruction({ originalInstruction, failedPlan, error, attempt, maxAttempts }) {
  return [
    "The previous execution plan failed during local execution.",
    "",
    `Original user request: ${originalInstruction}`,
    `Repair attempt: ${attempt} of ${maxAttempts}`,
    "",
    "Execution error:",
    error?.message || String(error),
    "",
    "Failed plan JSON:",
    JSON.stringify(failedPlan, null, 2),
    "",
    "Create a corrected plan that continues from the current project state.",
    "Do not repeat the same failing command or unsafe approach.",
    "If a dependency install failed, prefer a safer project-local setup or adjust files so the user can run the install manually.",
    "If a command was blocked because of shell chaining, split it into separate command entries.",
    "If the failure cannot be fixed safely, return a refusal or ask a clarification."
  ].join("\n");
}
