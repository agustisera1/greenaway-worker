import mongo from "./index.js";

// One chat per booking. `started_at` (not `started`) is the field name the app
// reads — see `ChatDocument` in greenaway/lib/chat/types.ts. The two repos
// deploy separately, so this shape is part of the hand-replicated contract.
export type ChatDocument = {
  booking_id: string;
  guest_id: string;
  host_id: string;
  started_at: string; // ISO string
};

async function getCollection() {
  const client = await mongo;
  return client.db("chatsdb").collection<ChatDocument>("chats");
}

/**
 * Insert the chat for `bookingId` only if it isn't there yet. `$setOnInsert`
 * leaves an existing document untouched, so re-sending never rewrites
 * `started_at`.
 *
 * Careful: this narrows the race a find-then-insert opens, but doesn't close
 * it — Mongo only makes an upsert atomic when a **unique index** covers the
 * filter, and `chats.booking_id` has none yet. See
 * `greenaway/docs/tech_debt/CHAT_FEATURE_NEXT_STEPS.md`.
 */
export async function upsertChatByBookingId(
  bookingId: string,
  chat: ChatDocument,
) {
  const collection = await getCollection();
  return collection.updateOne(
    { booking_id: bookingId },
    { $setOnInsert: chat },
    { upsert: true },
  );
}
