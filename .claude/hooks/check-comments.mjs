import { existsSync, readFileSync } from "node:fs";

const MAX_LINES = 2;
const CODE_FILE = /\.(ts|tsx|js|mjs)$/;
const EXCLUDED = [/__generated__/];
const COMMENT_LINE = /^(\/\/|\/\*|\*|\{\/\*)/;

function commentBlocks(text) {
  const blocks = [];
  let run = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (COMMENT_LINE.test(trimmed)) {
      run.push(trimmed);
      continue;
    }
    if (run.length) blocks.push(run);
    run = [];
  }
  if (run.length) blocks.push(run);
  return blocks;
}

function newLongBlocks(added, previous) {
  const known = new Set(commentBlocks(previous).map((b) => b.join("\n")));
  return commentBlocks(added).filter(
    (b) => b.length > MAX_LINES && !known.has(b.join("\n")),
  );
}

const input = JSON.parse(readFileSync(0, "utf8"));
const { tool_name: tool, tool_input: args = {} } = input;
const path = args.file_path ?? "";

if (!CODE_FILE.test(path) || EXCLUDED.some((re) => re.test(path))) process.exit(0);

let offenders = [];
if (tool === "Write") {
  const onDisk = existsSync(path) ? readFileSync(path, "utf8") : "";
  offenders = newLongBlocks(args.content ?? "", onDisk);
} else if (tool === "Edit") {
  offenders = newLongBlocks(args.new_string ?? "", args.old_string ?? "");
} else if (tool === "MultiEdit") {
  offenders = (args.edits ?? []).flatMap((e) =>
    newLongBlocks(e.new_string ?? "", e.old_string ?? ""),
  );
}

if (offenders.length === 0) process.exit(0);

const quoted = offenders.map((b) => b.join("\n")).join("\n---\n");
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Máx. ${MAX_LINES} líneas de comentario por bloque. Si el código se explica solo, borralo; ` +
        `si no, renombrá o reestructurá; la explicación larga va a docs/.\n\nBloques rechazados:\n${quoted}`,
    },
  }),
);
