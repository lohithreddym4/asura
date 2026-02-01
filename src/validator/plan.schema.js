import { z } from "zod";
import {
  normalizeIntent,
  isCreateIntent,
  isDangerousCommand
} from "./intent.js";

const CreateOrModifyFile = z.object({
  action: z.enum(["create", "modify"]),
  path: z.string().min(1),
  content: z.string().min(1)
});

const RenameFile = z.object({
  action: z.literal("rename"),
  path: z.string().min(1),
  to: z.string().min(1)
});

const DeleteFile = z.object({
  action: z.literal("delete"),
  path: z.string().min(1)
});

const FileSchema = z.discriminatedUnion("action", [
  CreateOrModifyFile,
  RenameFile,
  DeleteFile
]);

const CommandSchema = z.object({
  cmd: z.string().min(1),
  risk: z.enum(["low", "medium", "high"])
});

export const PlanSchema = z.object({
  intent: z.string().min(1),
  summary: z.string().min(1),
  clarification: z.string().nullable(),
  files: z.array(FileSchema),
  commands: z.array(CommandSchema),
  refusal: z.string().nullable()
}).superRefine((plan, ctx) => {
  // 1. Refusal must be exclusive
  if (plan.refusal) {
    if (
      plan.files.length > 0 ||
      plan.commands.length > 0 ||
      plan.intent
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Refusal plans must not include intent, files, or commands"
      });
    }
    return;
  }

  // 2. Normalize intent
  const intent = normalizeIntent(plan.intent);

  // 3. Create/add intents must act
  if (isCreateIntent(intent)) {
    if (
      plan.files.length === 0 &&
      plan.commands.length === 0 &&
      !plan.clarification
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Create intent without files or commands"
      });
    }
  }
  // 3.5 Generator vs files conflict
  const hasGeneratorCommand = plan.commands.some(c =>
    isGeneratorCommand(c.cmd)
  );

  const hasExplicitFiles = plan.files.length > 0;

  if (hasGeneratorCommand && hasExplicitFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Plan cannot include both project generator commands and explicit file creation. Choose one.",
      path: ["commands"]
    });
  }



  // 4. File path safety
  for (const f of plan.files) {
    if (
      f.path.startsWith("/") ||
      f.path.includes("..") ||
      f.path.includes("\\..")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsafe file path: ${f.path}`
      });
    }
    
  }

  // 5. Command safety
  for (const c of plan.commands) {
    if (isDangerousCommand(c.cmd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Dangerous command blocked: ${c.cmd}`
      });
    }
  }

  // 6. Filesystem operations must not be shell commands
const FORBIDDEN_FS_CMDS = [
  /^mv\b/i,
  /^cp\b/i,
  /^rm\b/i,
  /^del\b/i,
  /^rename\b/i
];

for (const c of plan.commands) {
  if (FORBIDDEN_FS_CMDS.some(rx => rx.test(c.cmd))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Filesystem operations must use file actions, not shell commands",
      path: ["commands"]
    });
  }
}

});

function isGeneratorCommand(cmd) {
  const generators = [
    "create",
    "init",
    "new"
  ];

  return generators.some(word =>
    cmd.includes(` ${word} `) ||
    cmd.startsWith(`${word} `)
  );
}
