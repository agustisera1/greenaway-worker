import type { Socket } from "socket.io";
import type { MessageDocument } from "../mongo/messages.mongo.js";
import type { CurrentUser, ChatParties } from "./auth.js";

// The persisted + delivered message shape lives with the Mongo repository (the
// storage owner), same as NotificationDocumentPayload. Re-exported here so the
// chat feature has a single types entry point.
export type { MessageDocument };

// What a client sends on `events.clientMessage`: only the room and the body.
// The server stamps _id, sender_id (from the join) and timestamp before
// persisting — clients don't get to set those.
export type ClientMessage = {
  chat_id: string;
  body: string;
};

// `user`: attached by the handshake middleware (step 1). `rooms`: the verified
// parties per joined chat, keyed by chat_id — one singleton socket serves
// every conversation, so the sender check looks up the room a message targets.
export type SocketData = {
  user?: CurrentUser;
  rooms: Map<string, ChatParties>;
};

// A socket carrying our authenticated-user data. `any` on the event maps keeps
// the focus on socket.data without enumerating every client/server event.
export type AppSocket = Socket<any, any, any, SocketData>;

// Socket.io event names, in one place so client and server stay in agreement.
export enum EVENTS {
  CLIENT_MESSAGE = "client-message",
  SERVER_MESSAGE = "server-message",
  JOIN_CHAT = "join-chat",
  LEAVE_CHAT = "leave-chat",
}

// Reply the server acks a join with, so the client knows whether it was let in.
export type JoinAck = { ok: boolean };

// What actually goes out on SERVER_MESSAGE. `MessageDocument` is the *stored*
// shape, which has no `_id` — Mongo mints that on insert. The client keys its
// thread on `_id`, so the id has to travel with the delivered message; without
// it every live message arrives with an undefined key.
export type DeliveredMessage = MessageDocument & { _id: string };

// Reply to a client-message. The sender is excluded from the broadcast (it
// renders its own message optimistically), so this ack is the only thing that
// tells it the message actually landed — and carries the real `_id` so the
// client can swap out the temporary one it invented.
export type MessageAck =
  | { ok: true; message: DeliveredMessage }
  | { ok: false };
