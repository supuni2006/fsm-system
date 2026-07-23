// Supabase Edge Function: send-document-email
// Emails a PDF already sitting in the 'documents' bucket to a customer as an
// attachment (invoice, estimate, or service report). Replaces the old
// WhatsApp document send — this project now does all customer communication
// by email.
//
// Body: { storage_path, filename, caption, customer_id,
//         source: 'service_report' | 'invoice' | 'estimate', source_id }
//
// Deploy:  supabase functions deploy send-document-email

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/email.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const auth = await requireRole(req, ['admin', 'technician']);
  if ('error' in auth) return auth.error;

  const { storage_path, filename, caption, customer_id, source, source_id } = await req.json();
  if (!storage_path || !customer_id) return json({ error: 'Missing storage_path or customer_id' }, 400);

  const { data: customer, error: custErr } = await adminClient.from('customers').select('id, email, contact_name').eq('id', customer_id).single();
  if (custErr || !customer?.email) return json({ error: 'Customer has no email on file' }, 400);

  const { data: fileBlob, error: downloadErr } = await adminClient.storage.from('documents').download(storage_path);
  if (downloadErr || !fileBlob) return json({ error: downloadErr?.message ?? 'Could not read the PDF from storage' }, 500);

  const pdfBytes = new Uint8Array(await fileBlob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
  const base64Content = btoa(binary);

  const safeFilename = filename ?? 'document.pdf';

  try {
    await sendEmail({
      to: customer.email,
      subject: safeFilename.replace(/\.pdf$/i, ''),
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333">${(caption ?? '').replace(/\n/g, '<br>') || `Hi ${customer.contact_name}, please find your document attached.`}</p>`,
      attachments: [{ filename: safeFilename, content: base64Content }]
    });
  } catch (err) {
    console.error('send-document-email failed', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: `Could not send email: ${message}` }, 502);
  }

  const nowIso = new Date().toISOString();
  if (source === 'service_report' && source_id) {
    await adminClient.from('service_reports').update({ sent_at: nowIso, sent_to_email: customer.email }).eq('id', source_id);
  } else if ((source === 'invoice' || source === 'estimate') && source_id) {
    await adminClient.from('invoices').update({ issued_at: nowIso, status: 'sent' }).eq('id', source_id);
  }

  return json({ ok: true, sent_to: customer.email });
});