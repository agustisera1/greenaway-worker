import type { PgUser } from "../pg/index.js";
import { findBookingById } from "../pg/bookings.pg.js";
import { findListingById } from "../mongo/listings.mongo.js";
import type { BookingParty } from "../events.js";
import type { AppSocket } from "./types.js";
import jwt from "jsonwebtoken";

export type Role = "guest" | "host";
// Claims the app signs into the access token (see `setAccessToken` in
// greenaway/lib/auth/actions.ts). Careful: the user id travels as
// `user_id`, not `id` — this is the wire contract, not the `users` row.
export type CurrentUser = Pick<PgUser, "email" | "name" | "is_host"> & {
  user_id: string;
  permissions: string[];
  roles: Role[];
};

// Both party ids of a booking's chat plus which side the joined socket is on.
export type ChatParties = {
  chat_id: string;
  host_id: string;
  guest_id: string;
  current_party: BookingParty;
};

const JWT_SECRET = process.env.JWT_SECRET!;

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET);
}

// Step 1 — Handshake: Authenticate.
// Socket.io middleware; runs once per connection, before any event is handled.
// Reads the token off the handshake, verifies it, and attaches the user to
// socket.data so later steps know who is connected. Reject with next(error).
export async function authenticateHandshake(
  socket: AppSocket,
  next: (err?: Error) => void,
) {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Token not provided"));
    const user = verifyToken(token);
    socket.data.user = user as CurrentUser;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
}

// Step 2 — Join Room: Authorize. The user must be the booking's guest or its
// listing's host; the parties are stored per room for the message flow to reuse.
export async function authorizeRoom(
  user: CurrentUser | undefined,
  bookingId: unknown,
): Promise<ChatParties | null> {
  if (!user || typeof bookingId !== "string") return null;

  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return null;
    const listing = await findListingById(booking.listing_id);
    if (!listing) return null;

    const party: BookingParty | null =
      booking.guest_id === user.user_id ? "guest" : listing.host_id === user.user_id ? "host" : null;
    if (!party) return null;

    return {
      chat_id: booking.id,
      host_id: listing.host_id,
      guest_id: booking.guest_id,
      current_party: party,
    };
  } catch (error) {
    console.error("[authorizeRoom]: could not resolve the booking", error);
    return null;
  }
}
