import { Redis } from "ioredis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { authenticateHandshake, authorizeRoom } from "../chat/auth.js";
import {
  ClientMessage,
  DeliveredMessage,
  EVENTS,
  JoinAck,
  MessageAck,
  SocketData,
} from "../chat/types.js";
import { insertMessage, MessageDocument } from "../mongo/messages.mongo.js";
import * as chatsRepo from "../mongo/chats.mongo.js";
import { channels, publish, type UnreadNudge } from "./client.js";

const url = process.env.REDIS_URL;
if (!url) throw new Error("[redis]: Missing REDIS_URL");

// ioredis (not node-redis) for the adapter: node-redis has reconnection issues
// with it. See https://socket.io/docs/v4/redis-adapter/#with-the-redis-package
// Same REDIS_URL the rest of the worker uses — one source of connection config.
const pubClient = new Redis(url);
const subClient = pubClient.duplicate();

// Origin of the web client allowed through CORS. Environment-specific, so it
// comes from env; falls back to the local dev front.
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

export const io = new Server<any, any, any, SocketData>({
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

  // Step 2 — Join Room: Authorize. The join can't ride the handshake: the socket
  // connects once, while the client learns (and changes) which booking it shows
  // afterwards. The handshake authenticates *who*; the ticket authorizes *what*,
  // and names its own room. On success the parties are stashed per room for the
  // message flow to reuse.
  socket.on(
    EVENTS.JOIN_CHAT,
    (ticket: string, ack?: (res: JoinAck) => void) => {
      const parties = authorizeRoom(ticket);
      if (!parties) return ack?.({ ok: false });
      socket.join(parties.chat_id);
      socket.data.rooms.set(parties.chat_id, parties);
      ack?.({ ok: true });
    },
  );

  socket.on(EVENTS.LEAVE_CHAT, (chatId: string) => {
    socket.leave(chatId);
    socket.data.rooms.delete(chatId);
  });

  // Steps 3–5: emit → persist → deliver.
  socket.on(
    EVENTS.CLIENT_MESSAGE,
    async (payload: ClientMessage, ack?: (res: MessageAck) => void) => {
      // Step 3 — Emit: a client message arrived. The parties stored at join are
      // the authorization: no entry for this room means the socket never joined
      // it (or its ticket expired), so there's nothing to emit into.
      const parties = socket.data.rooms.get(payload.chat_id);
      if (!parties) {
        console.error(
          "[registerMessageFlow]: no authorized room for",
          payload.chat_id,
        );
        return ack?.({ ok: false });
      }

      // The sender is whichever party the ticket was issued to — the client is
      // never trusted to name it.
      const senderId =
        parties.current_party === "guest" ? parties.guest_id : parties.host_id;

      // The chat document is born with the first message, not with the booking:
      // a pending booking can carry questions before the host confirms it. Both
      // party ids come from the ticket, so it doesn't matter which side speaks
      // first — writing the sender into `guest_id` would be wrong half the time.
      await chatsRepo.upsertChatByBookingId(payload.chat_id, {
        booking_id: payload.chat_id,
        guest_id: parties.guest_id,
        host_id: parties.host_id,
        started_at: new Date().toISOString(),
      });

      // Stamp the fields the client isn't trusted to set.
      const message: MessageDocument = {
        chat_id: payload.chat_id,
        sender_id: senderId,
        body: payload.body,
        timestamp: new Date().toISOString(),
      };

      // Step 4 — Persist: Mongo is the source of truth. Store before delivering
      // so a delivered message always exists on refetch.
      const stored = await insertMessage(message);
      if (!stored) {
        console.error("[registerMessageFlow]: message not persisted, dropping");
        return ack?.({ ok: false });
      }

      // Step 5 — Deliver: broadcast to the rest of the room, then confirm to
      // the sender.
      const delivered: DeliveredMessage = {
        ...message,
        _id: stored.insertedId.toString(),
      };
      socket.to(payload.chat_id).emit(EVENTS.SERVER_MESSAGE, delivered);
      ack?.({ ok: true, message: delivered });

      // Step 6 — Nudge: the broadcast above only reaches sockets that joined
      // this room, so a recipient on another screen would never know. Publish a
      // bodiless frame that only bumps their unread badge — nothing is stored
      // here, since the count is recomputed from the messages themselves.
      const recipientId =
        senderId === parties.guest_id ? parties.host_id : parties.guest_id;

      try {
        // Already in the room? Then the message just landed live, and counting
        // it as unread would leave a badge nobody can clear. `fetchSockets`
        // spans every node, so a recipient connected elsewhere counts too.
        const room = await io.in(payload.chat_id).fetchSockets();
        const present = room.some((s) => s.data.user?.user_id === recipientId);
        if (present) return;

        await publish(
          channels.notifications(recipientId),
          JSON.stringify({ kind: "message" } satisfies UnreadNudge),
        );
      } catch (error) {
        // The sender was already acked, so this can't fail the send — and a
        // dropped nudge only delays the badge until the next load, which
        // recomputes it from Mongo.
        console.error(
          "[registerMessageFlow]: could not publish the unread nudge",
          error,
        );
      }
    },
  );
});
