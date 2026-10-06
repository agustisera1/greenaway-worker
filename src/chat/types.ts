import type { Socket } from "socket.io";
import type { MessageDocument } from "../mongo/messages.mongo.js";
import type { CurrentUser, ChatParties } from "./auth.js";

// The chat wire contract, mirrored by hand in greenaway/lib/chat/socket.ts (the
// repos deploy separately): a change here goes there too.

// The persisted shape lives with the Mongo repository (the storage owner).
export type { MessageDocument };

// Socket.io event names, in one place so client and server stay in agreement.
export enum EVENTS {
  CLIENT_MESSAGE = "client-message",
  SERVER_MESSAGE = "server-message",
  JOIN_CHAT = "join-chat",
  LEAVE_CHAT = "leave-chat",
}

// Over the wire the timestamp is ISO-8601: JSON has no Date.
export type DeliveredMessage = Omit<MessageDocument, "timestamp"> & { id: string; timestamp: string };

// The server stamps everything else: the client is never trusted with it.
export type ClientMessage = Pick<DeliveredMessage, "chat_id" | "body">;

// Same shape as the app's ServiceResult, narrowed to the codes the socket can produce.
export type AckErrorCode = "VALIDATION" | "NOT_FOUND" | "UNEXPECTED";
export type Ack<T> = { ok: true; data: T } | { ok: false; code: AckErrorCode; error: string };

export interface ServerToClientEvents {
  [EVENTS.SERVER_MESSAGE]: (message: DeliveredMessage) => void;
}

export interface ClientToServerEvents {
  [EVENTS.JOIN_CHAT]: (chatId: string, ack: (res: Ack<null>) => void) => void;
  [EVENTS.LEAVE_CHAT]: (chatId: string) => void;
  [EVENTS.CLIENT_MESSAGE]: (
    payload: ClientMessage,
    ack: (res: Ack<DeliveredMessage>) => void,
  ) => void;
}

// `user`: attached by the handshake middleware (step 1). `rooms`: the verified
// parties per joined chat, keyed by chat_id.
export type SocketData = {
  user?: CurrentUser;
  rooms: Map<string, ChatParties>;
};

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
