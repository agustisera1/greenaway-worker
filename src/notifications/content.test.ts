import { describe, expect, it } from "vitest";
import type { BookingParty } from "../events.js";
import { bookingNotification, type BookingNotificationInput } from "./content.js";

const guest = { id: "guest-1", name: "Lucía" };
const host = { id: "host-1", name: "Martín" };

function input(
  event: BookingNotificationInput["event"],
  cancelledBy: BookingParty | null = null,
  statusReason: string | null = null,
): BookingNotificationInput {
  return {
    eventId: "event-1",
    event,
    booking: { id: "booking-1", cancelled_by: cancelledBy, status_reason: statusReason },
    listing: { _id: "listing-1", title: "Winery house" },
    guest,
    host,
  };
}

describe("bookingNotification", () => {
  it.each([
    ["created", null, "New booking request", "Lucía requested a stay at “Winery house”.", host.id],
    ["accepted", null, "Booking confirmed", "Martín confirmed your stay at “Winery house”.", guest.id],
    ["rejected", null, "Booking declined", "Martín declined your request for “Winery house”.", guest.id],
    ["cancelled", "guest", "Booking cancelled", "Lucía cancelled their stay at “Winery house”.", host.id],
    ["cancelled", "host", "Booking cancelled", "Martín cancelled your stay at “Winery house”.", guest.id],
  ] as const)("%s (cancelled by %s) goes to the party that did not act", (event, by, title, body, target) => {
    const notification = bookingNotification(input(event, by));

    expect(notification).toMatchObject({ title, body, target_id: target, is_read: false });
  });

  it.each([
    ["accepted", null, "Martín confirmed your stay at “Winery house”. Note: “Check-in is at 3pm”"],
    ["rejected", null, "Martín declined your request for “Winery house”. Note: “Check-in is at 3pm”"],
    ["cancelled", "host", "Martín cancelled your stay at “Winery house”. Note: “Check-in is at 3pm”"],
  ] as const)("%s appends the optional note", (event, by, body) => {
    expect(bookingNotification(input(event, by, "Check-in is at 3pm")).body).toBe(body);
  });

  it("keeps the real parties and the outbox id as its idempotency key", () => {
    expect(bookingNotification(input("created"))).toMatchObject({
      event_id: "event-1",
      booking_id: "booking-1",
      listing_id: "listing-1",
      guest_id: guest.id,
      host_id: host.id,
    });
  });
});
