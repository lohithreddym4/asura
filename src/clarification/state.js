const TASK_START_RE = /^(add|build|change|create|delete|edit|fix|generate|implement|install|make|modify|refactor|remove|rename|run|scaffold|set up|setup|update)\b/i;
const ANSWER_START_RE = /^(use|with|in|for|at|under|inside|javascript|typescript|node|jest|vitest|mocha|zod|json schema|joi|pytest|python)\b/i;
const IMPLICIT_TARGET_RE = /\b(it|that|that file|same file|previous file|there|here)\b/i;

export function isCommandDomain(input) {
  return /\b(git|npm|npx|pnpm|yarn|docker|kubectl)\b/i.test(input.trim());
}

export function looksLikeClarificationAnswer(input) {
  const value = input.trim();
  if (!value) return false;
  if (ANSWER_START_RE.test(value)) return true;
  if (IMPLICIT_TARGET_RE.test(value) && !TASK_START_RE.test(value)) return true;

  const hasPath = /(^|\s)[./\w-]+[\\/][./\w-]+/.test(value) || /\.[a-z0-9]{1,8}\b/i.test(value);
  return value.length <= 120 && hasPath && !TASK_START_RE.test(value);
}

export function shouldReplacePendingClarification(input) {
  if (isCommandDomain(input)) return true;
  if (looksLikeClarificationAnswer(input)) return false;
  return TASK_START_RE.test(input.trim());
}
