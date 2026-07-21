// Supabase Edge Function: whatsapp-webhook
// Handles both the Meta webhook verification handshake (GET) and
// inbound WhatsApp messages/status callbacks (POST).
//
// Configure in Meta App Dashboard > WhatsApp > Configuration:
//   Callback URL:  https://YOUR_PROJECT_REF.functions.supabase.co/whatsapp-webhook
//   Verify token:  same value as WHATSAPP_VERIFY_TOKEN below
//
// Deploy:  supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ---- Webhook verification handshake ----
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // ---- Inbound message / status payload ----
  if (req.method === 'POST') {
    const payload = await req.json();

    try {
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Delivery/read status callbacks
      if (value?.statuses) {
        for (const status of value.statuses) {
          await supabase
            .from('whatsapp_messages')
            .update({ status: mapStatus(status.status) })
            .eq('wa_message_id', status.id);
        }
      }

      // Inbound customer messages
      if (value?.messages) {
        for (const msg of value.messages) {
          const fromPhone = normalizePhone(msg.from);

          // Find or create the conversation, matching against the customers table by phone
          let { data: conversation } = await supabase
            .from('whatsapp_conversations')
            .select('id, customer_id')
            .eq('wa_phone_number', fromPhone)
            .maybeSingle();

          if (!conversation) {
            const { data: customer } = await supabase
              .from('customers')
              .select('id')
              .eq('phone', fromPhone)
              .maybeSingle();

            const { data: newConv } = await supabase
              .from('whatsapp_conversations')
              .insert({ wa_phone_number: fromPhone, customer_id: customer?.id ?? null, last_message_at: new Date().toISOString() })
              .select('id, customer_id')
              .single();
            conversation = newConv;
          }

          let body: string | null = null;
          let mediaUrl: string | null = null;
          let mediaType: string | null = null;

          if (msg.type === 'text') {
            body = msg.text?.body ?? null;
          } else if (msg.type === 'image' || msg.type === 'document') {
            mediaType = msg.type;
            mediaUrl = await downloadAndStoreMedia(msg[msg.type]?.id, msg[msg.type]?.mime_type);
            body = msg[msg.type]?.caption ?? null;
          }

          await supabase.from('whatsapp_messages').insert({
            conversation_id: conversation!.id,
            direction: 'inbound',
            wa_message_id: msg.id,
            body,
            media_url: mediaUrl,
            media_type: mediaType,
            status: 'delivered'
          });

          await supabase
            .from('whatsapp_conversations')
            .update({ last_message_at: new Date().toISOString(), unread_count: 1 })
            .eq('id', conversation!.id);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('whatsapp-webhook error', err);
      // Meta retries on non-2xx; still ack to avoid a retry storm on parse errors.
      return new Response('OK', { status: 200 });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

function mapStatus(waStatus: string): string {
  switch (waStatus) {
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'read': return 'read';
    case 'failed': return 'failed';
    default: return 'queued';
  }
}

function normalizePhone(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}

// Downloads inbound media from Meta's media API and re-uploads it into the
// private `whatsapp-media` Supabase Storage bucket, returning a signed URL.
async function downloadAndStoreMedia(mediaId: string, mimeType: string): Promise<string | null> {
  if (!mediaId) return null;
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;

  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const meta = await metaRes.json();
  if (!meta.url) return null;

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  const blob = await fileRes.arrayBuffer();

  const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
  const path = `inbound/${Date.now()}-${mediaId}.${ext}`;

  await supabase.storage.from('whatsapp-media').upload(path, new Uint8Array(blob), { contentType: mimeType });
  const { data: signed } = await supabase.storage.from('whatsapp-media').createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed?.signedUrl ?? null;
}
