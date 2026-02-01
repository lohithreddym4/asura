import path from "path";

export function extractMemoryFromPlan(plan) {
  const facts = {};

  // 1. Intent-based
  const intent = plan.intent.toLowerCase();
  if (intent.includes("component")) {
    facts.project_type = "component";
  }

  // 2. File-based inference
  for (const file of plan.files) {
    const ext = path.extname(file.path);

    if (ext === ".jsx") {
      facts.framework = "react";
      facts.language = "javascript";
      facts.file_extension = ".jsx";
    }

    if (file.path.includes("src/components")) {
      facts.component_dir = "src/components";
      facts.last_component = path.basename(file.path, ext);
    }

    // 3. Styling inference (safe heuristics)
    const content = file.content.toLowerCase();
    if (
      content.includes("classname") &&
      (content.includes("bg-") || content.includes("flex"))
    ) {
      facts.styling = "tailwind";
    }
  }

  return facts;
}
