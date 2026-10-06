import mongo from "./index.js";

// A chat message as persisted: Mongo mints `_id` on insert, delivered as `id`
// (`DeliveredMessage` in chat/types.ts). The booking's id doubles as `chat_id`.
export type MessageDocument = {
  chat_id: string;
  sender_id: string;
  body: string;
  timestamp: Date;
};

async function getCollection() {
  const client = await mongo;
  return client.db("messagesdb").collection<MessageDocument>("messages");
}

export async function insertMessage(message: MessageDocument) {
  const collection = await getCollection();
  const result = await collection.insertOne(message);
  return result.insertedId ? result : null;
}
