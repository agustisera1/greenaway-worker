import type { NotificationJob } from "../events.js";
import { insertNotification } from "../mongo/notifications.mongo.js";
import { channels, publish } from "../redis/client.js";

// Persist first (Mongo is the source of truth), then publish. The insert is also the claim:
// `false` is a retry of a job already done, and republishing would duplicate it live.
export async function sendBookingNotification({ eventId, notification }: NotificationJob) {
  const inserted = await insertNotification(notification);
  if (!inserted) {
    console.info("[sendBookingNotification]: already stored for", eventId);
    return;
  }

  await publish(channels.notifications(notification.target_id), JSON.stringify(notification));
}
