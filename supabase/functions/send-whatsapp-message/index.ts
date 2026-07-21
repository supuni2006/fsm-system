// Supabase Edge Function: send-whatsapp-message
// Called from the app (with the user's JWT) to send an outbound WhatsApp
// message through the Meta Cloud API, then records the wa_message_id.
//
// Deploy:  supabase functions deploy send-whatsapp-message

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Verify the caller is an authenticated admin/technician
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single();
  if (!profile || !['admin', 'technician'].includes(profile.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { conversation_id, text } = await req.json();
  if (!conversation_id || !text) return new Response('Missing conversation_id or text', { status: 400 });

  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('wa_phone_number')
    .eq('id', conversation_id)
    .single();
  if (!conversation) return new Response('Conversation not found', { status: 404 });

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
    await supabase
      .from('whatsapp_messages')
      .update({ status: 'failed' })
      .eq('conversation_id', conversation_id)
      .eq('body', text)
      .order('created_at', { ascending: false })
      .limit(1);
    return new Response(JSON.stringify({ error: waData }), { status: 502 });
  }

  const waMessageId = waData.messages?.[0]?.id ?? null;
  await supabase
    .from('whatsapp_messages')
    .update({ status: 'sent', wa_message_id: waMessageId })
    .eq('conversation_id', conversation_id)
    .eq('body', text)
    .order('created_at', { ascending: false })
    .limit(1);

  await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation_id);

  return new Response(JSON.stringify({ ok: true, wa_message_id: waMessageId }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
