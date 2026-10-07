import { emailsQueue, notificationsQueue } from "./redis/queues.js";
import { Outbox } from "./pg/index.js";
import * as outboxRepo from "./pg/outbox.pg.js";
import { toJobs } from "./outbox/fan-out.js";

const queues = {
  emails: emailsQueue,
  notifications: notificationsQueue,
};

class Relay {
  running = false;
  interval = 10_000; // Every 10 secs
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  start = () => {
    this.running = true;
    this.loop = this.run();
  };

  // Lets the tick in flight finish, so no row is left between its add() and its mark.
  stop = async () => {
    this.running = false;
    this.wake?.();
    await this.loop;
  };

  private run = async () => {
    while (this.running) {
      try {
        const events = await outboxRepo.findPendingEvents();
        for (const event of events) await this.dispatchEvent(event);
      } catch (err) {
        console.error("[relay]: poll/dispatch failed", err);
      }

      await this.sleep();
    }
  };

  private dispatchEvent = async (event: Outbox) => {
    try {
      const jobs = await toJobs(event);

      for (const job of jobs ?? []) {
        await queues[job.queue].add(job.queue, job.data, job.opts);
      }

      // at-least-once
      const published = await outboxRepo.markAsPublished(event.id);
      if (!published.ok) {
        console.error("[dispatchEvent]: could not mark as published", event.id);
      }
    } catch (err) {
      console.error("[dispatchEvent]: could not dispatch event", event.id, err);
    }
  };

  private sleep() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.interval);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

export const relay = new Relay();
