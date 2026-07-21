// Supabase Edge Function: send-reminders
// Run on a schedule (Supabase Dashboard > Edge Functions > Cron, e.g. "*/5 * * * *")
// to dispatch any reminder whose remind_at has passed and status is still 'pending'.
//
// Deploy:   supabase functions deploy send-reminders
// Schedule: supabase functions schedule send-reminders --cron "*/5 * * * *"

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async () => {
  const { data: due, error } = await supabase
    .from('reminders')
    .select('*, customers(phone)')
    .eq('status', 'pending')
    .lte('remind_at', new Date().toISOString());

  if (error) {
    console.error('Failed to fetch due reminders', error);
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const reminder of due ?? []) {
    try {
      if (reminder.channel === 'whatsapp') {
        const phone = reminder.customers?.phone;
        if (!phone) throw new Error('No phone on file for customer');

        const res = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone.replace('+', ''),
            type: 'text',
            text: { body: reminder.message }
          })
        });
        if (!res.ok) throw new Error(await res.text());
      }
      // email / sms / in_app channels: plug in your provider of choice here
      // (Resend/SendGrid for email, Twilio for SMS, or a row in a notifications table for in_app).

      await supabase.from('reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminder.id);
      sent++;
    } catch (err) {
      console.error(`Reminder ${reminder.id} failed`, err);
      await supabase.from('reminders').update({ status: 'failed' }).eq('id', reminder.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: (due ?? []).length, sent, failed }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
