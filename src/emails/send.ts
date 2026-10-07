import { UnrecoverableError } from "bullmq";
import type { ErrorResponse } from "resend";
import { resend } from "../resend.js";

const devMode = Number(process.env.DEV_MODE) === 1;

// Verified sender. dev uses Resend's sandbox address; prod sets a real domain.
const emailFrom = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

// In dev every email is redirected here instead of the real recipient.
const devEmailTo = process.env.DEV_EMAIL_TO ?? "agustisera1@gmail.com";

type Email = { to: string; subject: string; html: string };

// 4xx that a retry won't fix. Rate limits and a concurrent request with the same key do pass.
function isPermanent({ statusCode, name }: ErrorResponse) {
  const retryable = name === "rate_limit_exceeded" || name === "concurrent_idempotent_requests";
  return statusCode !== null && statusCode >= 400 && statusCode < 500 && !retryable;
}

// Resend no lanza ante un envío rechazado: resuelve a `{ data, error }`. Sin este
// throw el job resuelve OK y BullMQ lo marca completed, así que nunca reintenta.
export async function sendEmail(
  label: string,
  { to, subject, html }: Email,
  idempotencyKey?: string,
) {
  const { data, error } = await resend.emails.send(
    {
      from: emailFrom,
      to: devMode ? devEmailTo : [to],
      subject,
      html,
    },
    { idempotencyKey },
  );

  if (error) {
    console.error(`[${label}]: send rejected by Resend`, error);
    const message = `[${label}]: ${error.message}`;
    if (isPermanent(error)) throw new UnrecoverableError(message);
    // Error real, no el objeto plano de Resend: BullMQ lee `failedReason` de `.message`.
    throw new Error(message, { cause: error });
  }

  console.info(`[${label}]: sent`, data?.id);
}
