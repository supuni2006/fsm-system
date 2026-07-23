// Shared email sender for edge functions, using Resend (resend.com)'s HTTP
// API — one fetch call, no SDK needed. Swap this out if you use a different
// provider; every caller just imports `sendEmail` from here.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'FieldFlow <onboarding@resend.dev>';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Sends an email via Resend. Throws if RESEND_API_KEY isn't configured or
 * the send fails, so callers can decide how to surface that (e.g. still
 * complete the underlying action but tell the admin the email didn't go
 * out — see send-work-order-email/index.ts).
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}