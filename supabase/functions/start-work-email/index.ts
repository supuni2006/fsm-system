// Supabase Edge Function: start-work-email
//
// PUBLIC — no login, no Authorization header. This is what the technician's
// browser hits when they tap "▶ Start Work" in the assignment email (see
// send-work-order-email/index.ts). The token is the only credential, so it's
// single-use and time-limited: on success it's immediately cleared so the
// same email link can't be clicked twice.
//
// On success: flips the work order to in_progress (same effect as the
// in-app "Start Work" button) and emails every admin to confirm, so the
// office finds out immediately without the technician opening the app.
//
// Method: GET  (so a plain email link/button works)
// Query:  ?token=...
//
// Deploy:  supabase functions deploy start-work-email --no-verify-jwt
// (--no-verify-jwt is required — there's no user session to verify here.)

import { adminClient } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/email.ts';

function page(title: string, message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body{font-family:Arial,sans-serif;background:#f7f5f2;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
        .card{background:#fff;border-radius:12px;padding:32px 28px;max-width:360px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
        .icon{font-size:40px;margin-bottom:8px}
        h1{font-size:18px;margin:0 0 8px}
        p{color:#666;font-size:14px;line-height:1.5;margin:0}
      </style>
    </head><body><div class="card">
      <div class="icon">${ok ? '✅' : '⚠️'}</div>
      <h1>${title}</h1>
      <p>${message}</p>
    </div></body></html>`,
    { status: ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return page('Missing link', 'This start-work link is incomplete.', false);

  const { data: wo, error: woErr } = await adminClient
    .from('work_orders')
    .select('id, wo_number, title, status, assigned_technician_id, start_email_token_expires_at')
    .eq('start_email_token', token)
    .maybeSingle();

  if (woErr || !wo) return page('Link already used', 'This start-work link has already been used or is no longer valid.', false);

  if (wo.start_email_token_expires_at && new Date(wo.start_email_token_expires_at) < new Date()) {
    // Clear it so it can't be retried, and tell the office to re-send.
    await adminClient.from('work_orders').update({ start_email_token: null }).eq('id', wo.id);
    return page('Link expired', 'This start-work link has expired. Ask the office to resend it.', false);
  }

  if (wo.status === 'in_progress' || wo.status === 'completed') {
    return page('Already started', `${wo.wo_number} is already marked as ${wo.status.replace('_', ' ')}.`, true);
  }
  if (wo.status === 'cancelled') {
    return page("Job cancelled", `${wo.wo_number} was cancelled, so it can't be started.`, false);
  }

  // Clear the token in the same update so the link is single-use even under
  // a double-click or a duplicate request.
  const { error: updateErr } = await adminClient
    .from('work_orders')
    .update({ status: 'in_progress', actual_start: new Date().toISOString(), start_email_token: null })
    .eq('id', wo.id)
    .eq('start_email_token', token); // guards against a race between two simultaneous requests

  if (updateErr) {
    console.error('start-work-email update failed', updateErr);
    return page('Something went wrong', "We couldn't start the job. Please open the app instead.", false);
  }

  // Best-effort office notification — the job is already started even if this fails.
  try {
    const { data: tech } = await adminClient.from('profiles').select('full_name').eq('id', wo.assigned_technician_id).maybeSingle();
    const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
    const adminEmails: string[] = [];
    for (const a of admins ?? []) {
      const { data: u } = await adminClient.auth.admin.getUserById(a.id);
      if (u?.user?.email) adminEmails.push(u.user.email);
    }
    if (adminEmails.length) {
      await sendEmail({
        to: adminEmails,
        subject: `${wo.wo_number} started — ${tech?.full_name ?? 'Technician'}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333">
                 <strong>${tech?.full_name ?? 'A technician'}</strong> just started work order
                 <strong>${wo.wo_number}</strong> (${wo.title}) at ${new Date().toLocaleString()}.
               </p>`
      });
    }
  } catch (err) {
    console.error('start-work-email office notification failed', err);
  }

  return page('Work started', `Thanks — ${wo.wo_number} is now marked in progress, and the office has been notified. You can close this tab.`, true);
});