import { Redis } from "ioredis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { authenticateHandshake, authorizeRoom } from "../chat/auth.js";
import {
  Ack,
  ClientToServerEvents,
  DeliveredMessage,
  EVENTS,
  ServerToClientEvents,
  SocketData,
} from "../chat/types.js";
import { parseClientMessage } from "../chat/validation.js";
import { insertMessage, MessageDocument } from "../mongo/messages.mongo.js";
import * as chatsRepo from "../mongo/chats.mongo.js";
import { channels, publish, type UnreadNudge } from "./client.js";

const url = process.env.REDIS_URL;
if (!url) throw new Error("[redis]: Missing REDIS_URL");

// ioredis (not node-redis) for the adapter: node-redis has reconnection issues
// with it. See https://socket.io/docs/v4/redis-adapter/#with-the-redis-package
const pubClient = new Redis(url);
const subClient = pubClient.duplicate();

const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

const NOT_FOUND: Ack<never> = { ok: false, code: "NOT_FOUND", error: "Conversation not found" };

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>({
  adapter: createAdapter(pubClient, subClient),
  cors: {
    origin: clientOrigin,
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// Step 1 — Leverage io.use to provide a middleware and authenticate. Gate every connection before it's accepted.
io.use(authenticateHandshake);

io.on("connection", (socket) => {
  socket.data.rooms = new Map();

  // Step 2 — Join Room: Authorize. It can't ride the handshake: the socket connects
  // once, while the booking it shows changes afterwards.
  socket.on(EVENTS.JOIN_CHAT, async (bookingId, ack) => {
    const parties = await authorizeRoom(socket.data.user, bookingId);
    if (!parties) return ack?.(NOT_FOUND);
    socket.join(parties.chat_id);
    socket.data.rooms.set(parties.chat_id, parties);
    ack?.({ ok: true, data: null });
  });

  socket.on(EVENTS.LEAVE_CHAT, (chatId) => {
    socket.leave(chatId);
    socket.data.rooms.delete(chatId);
  });

  // Steps 3–5: emit → persist → deliver. Every path answers the ack: the sender's
  // bubble waits on it.
  socket.on(EVENTS.CLIENT_MESSAGE, async (payload, ack) => {
    const reply = (res: Ack<DeliveredMessage>) => ack?.(res);

    // Step 3 — Emit: validate the payload, then the room. The parties stored at join
    // are the authorization: no entry means the socket never joined this room.
    const input = parseClientMessage(payload);
    if (!input.ok) return reply(input);
    const { chat_id, body } = input.data;

    const parties = socket.data.rooms.get(chat_id);
    if (!parties) return reply(NOT_FOUND);

    // The sender is whichever party joined — the client never names it.
    const senderId =
      parties.current_party === "guest" ? parties.guest_id : parties.host_id;

    let delivered: DeliveredMessage;
    try {
      // The chat document is born with the first message: a pending booking can carry
      // questions before the host confirms it.
      const now = new Date();
      await chatsRepo.upsertChatByBookingId(chat_id, {
        booking_id: chat_id,
        guest_id: parties.guest_id,
        host_id: parties.host_id,
        started_at: now,
      });

      const message: MessageDocument = {
        chat_id,
        sender_id: senderId,
        body,
        timestamp: now,
      };

      // Step 4 — Persist: Mongo is the source of truth, so store before delivering.
      const stored = await insertMessage(message);
      if (!stored) throw new Error("insert returned no id");
      delivered = {
        ...message,
        id: stored.insertedId.toString(),
        timestamp: message.timestamp.toISOString(),
      };
    } catch (error) {
      console.error("[registerMessageFlow]: message not persisted", error);
      return reply({ ok: false, code: "UNEXPECTED", error: "Message not sent" });
    }

    // Step 5 — Deliver: broadcast to the rest of the room, then confirm to the sender.
    socket.to(chat_id).emit(EVENTS.SERVER_MESSAGE, delivered);
    reply({ ok: true, data: delivered });

    // Step 6 — Nudge: a recipient on another screen isn't in the room. A bodiless
    // frame bumps their unread badge; the count itself is recomputed from Mongo.
    const recipientId =
      senderId === parties.guest_id ? parties.host_id : parties.guest_id;

    try {
      // Already in the room (on any node)? Then the message landed live: no badge.
      const room = await io.in(chat_id).fetchSockets();
      const present = room.some((s) => s.data.user?.user_id === recipientId);
      if (present) return;

      await publish(
        channels.notifications(recipientId),
        JSON.stringify({ kind: "message" } satisfies UnreadNudge),
      );
    } catch (error) {
      // Best-effort: the sender was acked, and a dropped nudge only delays the badge.
      console.error(
        "[registerMessageFlow]: could not publish the unread nudge",
        error,
      );
    }
  });
});
