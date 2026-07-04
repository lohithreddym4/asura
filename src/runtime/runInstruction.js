import { invokeAsuraGraph } from "./asuraGraph.js";

export async function runInstruction(instruction, options = {}) {
  const {
    dryRun = false,
    yes = false,
    json = false,
    policy = null,
    verbose = true,
    exitOnError = false,
    maxRepairAttempts = 2
  } = options;

  try {
    return await invokeAsuraGraph({
      instruction,
      dryRun,
      yes,
      json,
      policy,
      verbose,
      maxRepairAttempts
    });
  } catch (err) {
    console.error("Error:", err.message);
    if (exitOnError) {
      process.exit(1);
    }
    return { status: "error", error: err };
  }
}
