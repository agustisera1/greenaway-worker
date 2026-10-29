import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CODE_FILE = /\.(ts|tsx|mts)$/;
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const MAX_OUTPUT = 4000;

function isUserPrompt(entry) {
  if (entry?.type !== "user") return false;
  const content = entry.message?.content;
  return typeof content === "string" || !content?.some((c) => c.type === "tool_result");
}

function editedCodeThisTurn(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  const entries = readFileSync(transcriptPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });
  for (const entry of entries.reverse()) {
    if (isUserPrompt(entry)) return false;
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const edited = content.some(
      (c) => c.type === "tool_use" && EDIT_TOOLS.has(c.name) && CODE_FILE.test(c.input?.file_path ?? ""),
    );
    if (edited) return true;
  }
  return false;
}

function run(command) {
  try {
    execSync(command, { cwd: process.env.CLAUDE_PROJECT_DIR, stdio: "pipe" });
    return null;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return `$ ${command}\n${output.slice(0, MAX_OUTPUT)}`;
  }
}

const input = JSON.parse(readFileSync(0, "utf8"));
// Según la doc de Stop: si ya se bloqueó una vez, dejar cerrar para no trabar el turno.
if (input.stop_hook_active || !editedCodeThisTurn(input.transcript_path)) process.exit(0);

const failures = [run("npx tsc --noEmit")].filter(Boolean);
if (failures.length === 0) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      `tsc falla. Corregilo antes de responder, sin mencionarlo al usuario.\n\n` +
      failures.join("\n\n"),
  }),
);
