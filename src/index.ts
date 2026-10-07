import "dotenv/config.js";
import { emailsWorker, notificationsWorker } from "./redis/workers.js";
import { emailsQueue, notificationsQueue } from "./redis/queues.js";
import { pubClient } from "./redis/client.js";
import { io as chatServer } from "./redis/socket.js";
import { relay } from "./relay.js";

// node-redis emits `error` events; without a listener they throw and can crash
// the process. Attach before anything connects.
pubClient.on("error", (err) => console.error("[pubClient]:", err));

// Un solo lugar para los fallos de todas las colas. `failed` cubre además lo que
// ningún handler llega a ver: payload sin handler, job stalled, timeout.
for (const worker of [emailsWorker, notificationsWorker]) {
  const label = `[${worker.name}Worker]`;
  worker.on("error", (err) => console.error(label, err));
  worker.on("failed", (job, err) =>
    console.error(label, "job", job?.id, "event", job?.data.eventId, "failed:", err),
  );
}

for (const queue of [emailsQueue, notificationsQueue]) {
  queue.on("error", (err) => console.error(`[${queue.name}Queue]`, err));
}

process.on("uncaughtException", (err) => {
  console.error("[process]: uncaught exception", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[process]: unhandled rejection", reason);
});

// Startup order matters: the notifications processor publishes on `pubClient`,
// so that connection must be up before the workers start pulling jobs. The
// workers are created with `autorun: false` precisely so we gate them here.
// Port the socket.io chat server listens on. From env so it can differ per
// environment; falls back to 4000 for local dev.
const socketPort = Number(process.env.SOCKET_PORT) || 4000;

async function initialize() {
  await pubClient.connect();
  console.info("[pubClient]: initialized");
  chatServer.listen(socketPort);
  console.info(`[chatServer]: listening on ${socketPort}`);
  relay.start();
  console.info("[relay]: initialized");

  // run() starts each processing loop; its promise resolves only when the
  // worker closes, so we start them without awaiting.
  emailsWorker.run().catch((err) => console.error("[emailsWorker] run:", err));
  notificationsWorker
    .run()
    .catch((err) => console.error("[notificationsWorker] run:", err));
  console.info("[workers]: running");
}

initialize().catch((err) => {
  console.error("[initialize]: startup failed", err);
  process.exit(1);
});

// Producer before consumers: the relay stops feeding the queues, then each worker
// finishes its active jobs, which may still publish on `pubClient`.
async function shutdown() {
  await relay.stop();
  await Promise.all([emailsWorker.close(), notificationsWorker.close()]);
  await Promise.all([emailsQueue.close(), notificationsQueue.close()]);
  await pubClient.close();
  console.info("[shutdown]: connections closed");
  process.exit(0);
}

// SIGINT -> Ctrl+C; SIGTERM -> docker stop / tsx watch reloads.
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
