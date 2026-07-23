// Supabase Edge Function: send-work-order-email
//
// Admin-triggered (from the work order detail page, next to "Assign
// technician"). Emails the assigned technician the job details plus a
// "▶ Start Work" button that works without logging into the app — it's a
// plain link to the public `start-work-email` function carrying a
// single-use token. Clicking it flips the job to in_progress and emails
// the office back automatically (see start-work-email/index.ts).
//
// Body: { work_order_id }
//
// Requires the RESEND_API_KEY secret (see _shared/email.ts) and
// SUPABASE_URL to build the link.
//
// Deploy:  supabase functions deploy send-work-order-email

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — plenty for a scheduled job, short enough to limit a leaked link

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Only admins assign work, so only admins trigger this.
  const auth = await requireRole(req, ['admin']);
  if ('error' in auth) return auth.error;

  const { work_order_id } = await req.json();
  if (!work_order_id) return json({ error: 'Missing work_order_id' }, 400);

  const { data: wo, error: woErr } = await adminClient
    .from('work_orders')
    .select('id, wo_number, title, description, priority, scheduled_start, service_address, status, assigned_technician_id, customers ( contact_name, company_name )')
    .eq('id', work_order_id)
    .single();
  if (woErr || !wo) return json({ error: 'Work order not found' }, 404);
  if (!wo.assigned_technician_id) return json({ error: 'Work order has no assigned technician' }, 400);

  const { data: tech, error: techErr } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .eq('id', wo.assigned_technician_id)
    .single();
  if (techErr || !tech) return json({ error: 'Technician not found' }, 404);

  const { data: techUser, error: techUserErr } = await adminClient.auth.admin.getUserById(tech.id);
  const techEmail = techUser?.user?.email;
  if (techUserErr || !techEmail) return json({ error: 'Technician has no email on file' }, 400);

  // Fresh single-use token every send, so an old email link can't be replayed
  // after a new one goes out.
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error: tokenErr } = await adminClient
    .from('work_orders')
    .update({ start_email_token: token, start_email_token_expires_at: expiresAt, start_email_sent_at: new Date().toISOString() })
    .eq('id', work_order_id);
  if (tokenErr) return json({ error: tokenErr.message }, 500);

  const startWorkUrl = `${SUPABASE_URL}/functions/v1/start-work-email?token=${token}`;
  const customerName = (wo as any).customers?.company_name || (wo as any).customers?.contact_name || 'Customer';
  const when = wo.scheduled_start
    ? new Date(wo.scheduled_start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not scheduled yet';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="margin-bottom:4px">New job: ${wo.wo_number}</h2>
      <p style="color:#444;margin-top:0">${wo.title}</p>
      <table style="font-size:14px;color:#333;margin:16px 0">
        <tr><td style="padding:2px 12px 2px 0;color:#777">Customer</td><td>${customerName}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#777">When</td><td>${when}</td></tr>
        ${wo.service_address ? `<tr><td style="padding:2px 12px 2px 0;color:#777">Where</td><td>${wo.service_address}</td></tr>` : ''}
        <tr><td style="padding:2px 12px 2px 0;color:#777">Priority</td><td>${wo.priority}</td></tr>
      </table>
      <p style="color:#444">When you arrive on site and begin the job, tap the button below —
        it marks the job as started and lets the office know right away, no need to open the app.</p>
      <a href="${startWorkUrl}"
         style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;
                padding:12px 24px;border-radius:6px;font-weight:bold;margin-top:8px">
        ▶ Start Work
      </a>
      <p style="color:#999;font-size:12px;margin-top:24px">This link is single-use and expires in 7 days. If it's not you, ignore this email.</p>
    </div>
  `;

  try {
    await sendEmail({ to: techEmail, subject: `Job assigned: ${wo.wo_number} — ${wo.title}`, html });
  } catch (err) {
    console.error('send-work-order-email failed', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: `Could not send email: ${message}` }, 502);
  }

  return json({ ok: true, sent_to: techEmail });
});