import { existsSync, readFileSync } from "node:fs";

const MAX_LINES = 5;

function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
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
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    const texts = Array.isArray(content)
      ? content.filter((c) => c.type === "text").map((c) => c.text)
      : [];
    if (texts.length) return texts.join("\n");
  }
  return "";
}

const input = JSON.parse(readFileSync(0, "utf8"));
const text = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;

if (lines <= MAX_LINES) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      `Tu respuesta tiene ${lines} líneas; el máximo es ${MAX_LINES}. Reescribila en ${MAX_LINES} ` +
      `líneas o menos, respondiendo solo lo que el usuario preguntó.`,
  }),
);
