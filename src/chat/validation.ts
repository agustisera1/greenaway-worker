import type { Ack, ClientMessage } from "./types.js";

// Mirrors MAX_MESSAGE_LENGTH in greenaway/lib/chat/validation.ts, which caps the composer.
export const MAX_MESSAGE_LENGTH = 2000;

// The payload comes off the wire untyped, whatever the event map says.
export function parseClientMessage(payload: unknown): Ack<ClientMessage> {
  const { chat_id, body } = (payload ?? {}) as Partial<Record<keyof ClientMessage, unknown>>;

  if (typeof chat_id !== "string" || typeof body !== "string")
    return { ok: false, code: "VALIDATION", error: "Malformed message" };

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, code: "VALIDATION", error: "Message is empty" };
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return {
      ok: false,
      code: "VALIDATION",
      error: `Keep it under ${MAX_MESSAGE_LENGTH} characters`,
    };

  return { ok: true, data: { chat_id, body: trimmed } };
}
