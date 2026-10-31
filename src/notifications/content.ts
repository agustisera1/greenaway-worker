import type { BookingEvent, BookingParty } from "../events.js";
import type { NotificationDocumentPayload } from "../mongo/notifications.mongo.js";

type Party = { id: string; name: string };

export type BookingNotificationInput = {
  eventId: string;
  event: BookingEvent;
  booking: { id: string; cancelled_by: BookingParty | null; status_reason: string | null };
  listing: { _id: string; title: string };
  guest: Party;
  host: Party;
};

type Names = { guest: string; host: string; listing: string; cancelledBy: BookingParty | null };

// The titles carry the keywords the app keys its icon off (`notificationVisual`, notifications-model.ts).
const content: Record<BookingEvent, { title: string; body: (n: Names) => string }> = {
  created: {
    title: "New booking request",
    body: (n) => `${n.guest} requested a stay at “${n.listing}”.`,
  },
  accepted: {
    title: "Booking confirmed",
    body: (n) => `${n.host} confirmed your stay at “${n.listing}”.`,
  },
  rejected: {
    title: "Booking declined",
    body: (n) => `${n.host} declined your request for “${n.listing}”.`,
  },
  cancelled: {
    title: "Booking cancelled",
    body: (n) =>
      n.cancelledBy === "guest"
        ? `${n.guest} cancelled their stay at “${n.listing}”.`
        : `${n.host} cancelled your stay at “${n.listing}”.`,
  },
};

// The notification goes to the party that did not act: they already know what they did.
function recipient(event: BookingEvent, cancelledBy: BookingParty | null): BookingParty {
  if (event === "created") return "host";
  if (event === "cancelled" && cancelledBy === "guest") return "host";
  return "guest";
}

export function bookingNotification({
  eventId,
  event,
  booking,
  listing,
  guest,
  host,
}: BookingNotificationInput): NotificationDocumentPayload {
  const copy = content[event];
  const target = recipient(event, booking.cancelled_by) === "host" ? host : guest;
  // The optional message whoever changed the status left (accept, reject, cancel).
  const note = booking.status_reason ? ` Note: “${booking.status_reason}”` : "";

  return {
    event_id: eventId,
    listing_id: listing._id,
    host_id: host.id,
    guest_id: guest.id,
    booking_id: booking.id,
    target_id: target.id,
    title: copy.title,
    body:
      copy.body({
        guest: guest.name,
        host: host.name,
        listing: listing.title,
        cancelledBy: booking.cancelled_by,
      }) + note,
    is_read: false,
  };
}
