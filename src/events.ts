// Wire contracts for the jobs this worker pulls off the BullMQ queues. The relay is the only
// producer, so these types are the single source. Ver docs/architecture/bullmq-queues.md.
import type { NotificationDocumentPayload } from "./mongo/notifications.mongo.js";

// The verb of a `booking.<verb>` outbox row: the only events the worker handles.
export type BookingEvent = "created" | "accepted" | "rejected" | "cancelled";

export type ListingLocation = {
  address?: string;
  city?: string;
  country?: string;
};

// Mirrors BookingParty in the app (lib/bookings/types.ts).
export type BookingParty = "guest" | "host";

export type Booking = {
  id: string;
  checkIn: string; // ISO string
  checkOut: string; // ISO string
  guests: number;
  totalPrice: number;
  statusReason?: string;
  // Set only on `cancelled`, as the app's cancellation policy decided: rendered, never recomputed.
  refundAmount?: number;
  cancelledBy?: BookingParty;
};

// The lifecycle stage a booking email announces: drives the subject and the copy.
export type NotificationType = "pending" | "approved" | "rejected" | "cancelled";

// `eventId` is the outbox row id: the idempotency key of both consumers across retries.
export type NotificationJob = {
  eventId: string;
  notification: NotificationDocumentPayload;
};

// Only the fields the email template renders, not the full domain entities.
export type EmailJob = {
  eventId: string;
  type: NotificationType;
  guest: { email: string };
  booking: Booking;
  host: { name: string };
  listing: { title: string; location: ListingLocation };
};
