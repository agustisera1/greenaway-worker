import { type Job, Worker, createNodeRedisClient } from "bullmq";
import { createClient } from "redis";
import type { EmailJob, NotificationJob } from "../events.js";
import { notifyBooking } from "../emails/booking.js";
import { sendBookingNotification } from "../notifications/booking.js";

const url = process.env.REDIS_URL;
if (!url) throw new Error("[redis]: Missing REDIS_URL");

export const emailsWorker = new Worker(
  "emails",
  (job: Job<EmailJob>) => notifyBooking(job.data),
  {
    autorun: false,
    connection: createNodeRedisClient(
      createClient({ url, name: "redis-emails-client" }),
    ),
  },
);

export const notificationsWorker = new Worker(
  "notifications",
  (job: Job<NotificationJob>) => sendBookingNotification(job.data),
  {
    autorun: false,
    connection: createNodeRedisClient(
      createClient({ url, name: "redis-notifications-client" }),
    ),
  },
);
