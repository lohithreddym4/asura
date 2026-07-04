const LABELS = {
  memory: "memory",
  rag: "rag",
  planner: "planner",
  executor: "executor",
  repair: "repair",
  history: "history",
  profile: "profile",
  validate: "validate"
};

export function status(state, channel, message) {
  if (!state?.verbose) return;
  const label = LABELS[channel] || channel || "asura";
  console.log(`[${label}] ${message}`);
}
