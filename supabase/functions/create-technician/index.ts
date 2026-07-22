// Supabase Edge Function: send-whatsapp-message
// Sends an outbound WhatsApp text message through the Meta Cloud API.
//
// Accepts EITHER an existing `conversation_id`, OR a `customer_id` /
// `technician_id` / raw `phone` to start a brand-new conversation — the
// conversation row is looked up or created here, so callers never need to
// create one themselves first.
//
// Deploy:  supabase functions deploy send-whatsapp-message

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const auth = await requireRole(req, ['admin', 'technician']);
  if ('error' in auth) return auth.error;

  const { conversation_id, customer_id, technician_id, phone, text } = await req.json();
  if (!text || !String(text).trim()) return json({ error: 'Missing text' }, 400);
  if (!conversation_id && !customer_id && !technician_id && !phone) {
    return json({ error: 'Provide conversation_id, customer_id, technician_id, or phone' }, 400);
  }

  const conversation = conversation_id
    ? await getConversation(conversation_id)
    : await getOrCreateConversation({ customer_id, technician_id, phone });

  if (!conversation) return json({ error: 'Conversation not found' }, 404);
  if (!conversation.wa_phone_number) return json({ error: 'This recipient has no WhatsApp number on file' }, 400);

  // Insert the outbound row up front and keep its id — avoids the old
  // "find the most recent message with this body" hack, which could match
  // the wrong row if two messages with identical text were sent back to back.
  const { data: message, error: insertErr } = await adminClient
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      body: text,
      status: 'queued',
      sent_by: auth.userId
    })
    .select()
    .single();
  if (insertErr) return json({ error: insertErr.message }, 500);

  const waRes = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: conversation.wa_phone_number.replace('+', ''),
      type: 'text',
      text: { body: text }
    })
  });
  const waData = await waRes.json();

  if (!waRes.ok) {
    console.error('WhatsApp send failed', waData);
    await adminClient.from('whatsapp_messages').update({ status: 'failed' }).eq('id', message.id);
    return json({ error: waData?.error?.message ?? 'WhatsApp API rejected the message' }, 502);
  }

  const waMessageId = waData.messages?.[0]?.id ?? null;
  await adminClient.from('whatsapp_messages').update({ status: 'sent', wa_message_id: waMessageId }).eq('id', message.id);
  await adminClient.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);

  return json({ ok: true, conversation_id: conversation.id, wa_message_id: waMessageId });
});

async function getConversation(id: string) {
  const { data } = await adminClient.from('whatsapp_conversations').select('id, wa_phone_number').eq('id', id).single();
  return data;
}

async function getOrCreateConversation(target: { customer_id?: string; technician_id?: string; phone?: string }) {
  const { customer_id, technician_id, phone } = target;

  let waPhone = phone ?? null;
  if (customer_id) {
    const { data: customer } = await adminClient.from('customers').select('phone').eq('id', customer_id).single();
    waPhone = customer?.phone ?? null;
  } else if (technician_id) {
    const { data: tech } = await adminClient.from('profiles').select('phone').eq('id', technician_id).single();
    waPhone = tech?.phone ?? null;
  }

  // Reuse an existing conversation for this customer/technician/phone if one exists.
  let query = adminClient.from('whatsapp_conversations').select('id, wa_phone_number').limit(1);
  if (customer_id) query = query.eq('customer_id', customer_id);
  else if (technician_id) query = query.eq('technician_id', technician_id);
  else query = query.eq('wa_phone_number', waPhone ?? '');

  const { data: existing } = await query.maybeSingle();
  if (existing) return existing;

  if (!waPhone) return null;

  const { data: created, error } = await adminClient
    .from('whatsapp_conversations')
    .insert({
      customer_id: customer_id ?? null,
      technician_id: technician_id ?? null,
      wa_phone_number: waPhone,
      unread_count: 0
    })
    .select('id, wa_phone_number')
    .single();
  if (error) {
    console.error('Failed to create conversation', error);
    return null;
  }
  return created;
}