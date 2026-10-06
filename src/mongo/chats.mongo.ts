import mongo from "./index.js";

// One chat per booking. `started_at` (not `started`) is the field name the app
// reads — see `ChatDocument` in greenaway/lib/chat/types.ts. The two repos
// deploy separately, so this shape is part of the hand-replicated contract.
export type ChatDocument = {
  booking_id: string;
  guest_id: string;
  host_id: string;
  started_at: Date;
};

async function getCollection() {
  const client = await mongo;
  return client.db("chatsdb").collection<ChatDocument>("chats");
}

// `$setOnInsert` never rewrites `started_at`; the unique index on `booking_id`
// (greenaway `pnpm db:indexes`) makes concurrent upserts yield one chat.
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
