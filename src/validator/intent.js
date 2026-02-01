export function normalizeIntent(intent) {
    const i = intent.toLowerCase();
  
    if (i.includes("create") || i.includes("add") || i.includes("generate")) {
      return "create";
    }
    if (i.includes("modify") || i.includes("edit") || i.includes("update")) {
      return "modify";
    }
    if (i.includes("delete") || i.includes("remove")) {
      return "delete";
    }
  
    return "unknown";
  }
  
  export function isCreateIntent(intent) {
    return intent === "create";
  }
  
  export function isDangerousCommand(cmd) {
    const blocklist = [
      "rm ",
      "sudo",
      "chmod 777",
      "|",
      "&&",
      "shutdown",
      "reboot"
    ];
  
    const lower = cmd.toLowerCase();
    return blocklist.some(b => lower.includes(b));
  }
  