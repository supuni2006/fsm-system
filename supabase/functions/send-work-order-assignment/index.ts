// Supabase Edge Function: send-work-order-assignment
//
// Called right after an admin assigns a technician to a work order
// (see src/lib/work-order-actions.ts -> assignTechnician). Sends the
// technician a WhatsApp message with the job details and logs it in
// whatsapp_messages so it shows up in their in-app chat thread too.
//
// The technician's next moves (Accept / Decline / Start Work / End Work)
// happen as in-app button taps on the Work Orders page — this function's
// only job is the "hey, you've got a job" notification.
//
// Body: { work_order_id }
//
// Deploy:  supabase functions deploy send-work-order-assignment

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

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
    .select(
      'id, wo_number, title, description, priority, scheduled_start, service_address, assigned_technician_id, customer_id, customers ( contact_name, company_name )'
    )
    .eq('id', work_order_id)
    .single();
  if (woErr || !wo) return json({ error: 'Work order not found' }, 404);
  if (!wo.assigned_technician_id) return json({ error: 'Work order has no assigned technician' }, 400);

  const { data: tech, error: techErr } = await adminClient
    .from('profiles')
    .select('id, full_name, phone')
    .eq('id', wo.assigned_technician_id)
    .single();
  if (techErr || !tech) return json({ error: 'Technician not found' }, 404);
  if (!tech.phone) return json({ error: 'Technician has no WhatsApp number on file' }, 400);

  const customerName = (wo as any).customers?.company_name || (wo as any).customers?.contact_name || 'Customer';
  const when = wo.scheduled_start
    ? new Date(wo.scheduled_start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not scheduled yet';

  const messageBody =
    `🔧 New job assigned: *${wo.wo_number}*\n` +
    `${wo.title}\n\n` +
    `Customer: ${customerName}\n` +
    `When: ${when}\n` +
    (wo.service_address ? `Where: ${wo.service_address}\n` : '') +
    `Priority: ${wo.priority}\n\n` +
    `Open the app to Accept or Decline this job.`;

  const waRes = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: tech.phone.replace('+', ''),
      type: 'text',
      text: { body: messageBody }
    })
  });
  const waData = await waRes.json();
  if (!waRes.ok) {
    console.error('WhatsApp assignment send failed', waData);
    return json({ error: waData }, 502);
  }
  const waMessageId = waData.messages?.[0]?.id ?? null;

  // Find or create the conversation thread for this technician, then log the message
  // so it's visible in the app's WhatsApp view, not just on their phone.
  let { data: conversation } = await adminClient
    .from('whatsapp_conversations')
    .select('id')
    .eq('technician_id', tech.id)
    .maybeSingle();

  if (!conversation) {
    const { data: created } = await adminClient
      .from('whatsapp_conversations')
      .insert({ technician_id: tech.id, wa_phone_number: tech.phone, last_message_at: new Date().toISOString() })
      .select('id')
      .single();
    conversation = created;
  } else {
    await adminClient.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
  }

  if (conversation) {
    await adminClient.from('whatsapp_messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      wa_message_id: waMessageId,
      body: messageBody,
      status: 'sent',
      sent_by: auth.userId
    });
  }

  return json({ ok: true, wa_message_id: waMessageId });
});