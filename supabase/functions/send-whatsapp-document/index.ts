// Supabase Edge Function: send-whatsapp-document
// Sends a PDF already sitting in the 'documents' bucket to a customer's
// WhatsApp number as a document message, and logs it in whatsapp_messages
// so it shows up in the in-app chat thread too.
//
// Body: { storage_path, filename, caption, customer_id,
//         source: 'service_report' | 'invoice' | 'estimate', source_id }
//
// Deploy:  supabase functions deploy send-whatsapp-document

import { adminClient, requireRole, json } from '../_shared/auth.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = await requireRole(req, ['admin', 'technician']);
  if ('error' in auth) return auth.error;

  const { storage_path, filename, caption, customer_id, source, source_id } = await req.json();
  if (!storage_path || !customer_id) return json({ error: 'Missing storage_path or customer_id' }, 400);

  const { data: customer, error: custErr } = await adminClient
    .from('customers')
    .select('id, phone, contact_name')
    .eq('id', customer_id)
    .single();
  if (custErr || !customer?.phone) return json({ error: 'Customer has no WhatsApp number on file' }, 400);

  // A signed URL that Meta's servers can fetch to pull the document in.
  const { data: signed, error: signErr } = await adminClient.storage.from('documents').createSignedUrl(storage_path, 3600);
  if (signErr || !signed) return json({ error: signErr?.message ?? 'Could not sign document URL' }, 500);

  const waRes = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: customer.phone.replace('+', ''),
      type: 'document',
      document: {
        link: signed.signedUrl,
        filename: filename ?? 'document.pdf',
        caption: caption ?? undefined
      }
    })
  });
  const waData = await waRes.json();
  if (!waRes.ok) {
    console.error('WhatsApp document send failed', waData);
    return json({ error: waData }, 502);
  }
  const waMessageId = waData.messages?.[0]?.id ?? null;

  // Find or create the conversation thread for this customer's number, then log the message.
  let { data: conversation } = await adminClient
    .from('whatsapp_conversations')
    .select('id')
    .eq('wa_phone_number', customer.phone)
    .maybeSingle();

  if (!conversation) {
    const { data: created } = await adminClient
      .from('whatsapp_conversations')
      .insert({ customer_id, wa_phone_number: customer.phone, last_message_at: new Date().toISOString() })
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
      body: caption ?? filename ?? 'Document sent',
      media_url: signed.signedUrl,
      media_type: 'application/pdf',
      status: 'sent',
      sent_by: auth.userId
    });
  }

  const nowIso = new Date().toISOString();
  if (source === 'service_report' && source_id) {
    await adminClient.from('service_reports').update({ sent_at: nowIso, sent_to_phone: customer.phone }).eq('id', source_id);
  } else if ((source === 'invoice' || source === 'estimate') && source_id) {
    await adminClient.from('invoices').update({ issued_at: nowIso, status: 'sent' }).eq('id', source_id);
  }

  return json({ ok: true, wa_message_id: waMessageId });
});