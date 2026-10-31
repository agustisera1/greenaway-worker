import type { BookingEvent, EmailJob, NotificationJob, NotificationType } from "../events.js";
import type { Booking, Outbox } from "../pg/index.js";
import { findBookingById } from "../pg/bookings.pg.js";
import { findUserById } from "../pg/users.pg.js";
import { findListingById } from "../mongo/listings.mongo.js";
import { bookingNotification } from "../notifications/content.js";

export type BookingJobs = {
  verb: BookingEvent;
  bookingId: string;
  notification: NotificationJob;
  email: EmailJob;
};

// Each outbox event type, with the email stage it announces.
const EVENTS: Record<string, { verb: BookingEvent; email: NotificationType }> = {
  "booking.created": { verb: "created", email: "pending" },
  "booking.accepted": { verb: "accepted", email: "approved" },
  "booking.rejected": { verb: "rejected", email: "rejected" },
  "booking.cancelled": { verb: "cancelled", email: "cancelled" },
};

// NUMERIC columns come back from pg as strings, and the template expects ISO timestamps.
function toEmailBooking(booking: Booking): EmailJob["booking"] {
  return {
    id: booking.id,
    checkIn: new Date(booking.start_date).toISOString(),
    checkOut: new Date(booking.end_date).toISOString(),
    guests: booking.guests,
    totalPrice: Number(booking.total_price),
    statusReason: booking.status_reason || undefined,
    refundAmount: Number(booking.refund_amount),
    cancelledBy: booking.cancelled_by ?? undefined,
  };
}

// The row carries ids only, so everything the jobs render is read here. `null`: it can never be
// published (unknown type, or its booking is gone), so the relay drops it instead of retrying.
export async function toJobs(event: Outbox): Promise<BookingJobs | null> {
  const spec = EVENTS[event.event_type];
  if (!spec) {
    console.error("[toJobs]: unknown event_type", event.event_type, event.id);
    return null;
  }

  const booking = await findBookingById(event.aggregate_id);
  if (!booking) return null;

  const [guest, listing] = await Promise.all([
    findUserById(booking.guest_id),
    findListingById(booking.listing_id),
  ]);
  if (!guest || !listing) return null;

  const host = await findUserById(listing.host_id);
  if (!host) return null;

  return {
    verb: spec.verb,
    bookingId: booking.id,
    notification: {
      eventId: event.id,
      notification: bookingNotification({
        eventId: event.id,
        event: spec.verb,
        booking,
        listing,
        guest,
        host,
      }),
    },
    email: {
      eventId: event.id,
      type: spec.email,
      guest: { email: guest.email },
      booking: toEmailBooking(booking),
      host: { name: host.name },
      listing: {
        title: listing.title,
        location: {
          address: listing.location.address,
          city: listing.location.city,
          country: listing.location.country,
        },
      },
    },
  };
}
