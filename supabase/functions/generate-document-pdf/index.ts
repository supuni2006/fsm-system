// Supabase Edge Function: generate-document-pdf
// Builds a PDF for an invoice or estimate ("bill"), uploads it to the
// 'documents' storage bucket, and stores the path on the invoices row.
//
// Deploy:  supabase functions deploy generate-document-pdf

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { newPdf, header, footer, keyValueRow, table, totalsBlock, text, paragraph, down, toBytes } from '../_shared/pdf.ts';

const CONTENT_WIDTH = 499;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = await requireRole(req, ['admin', 'technician', 'customer']);
  if ('error' in auth) return auth.error;

  const { invoice_id } = await req.json();
  if (!invoice_id) return json({ error: 'Missing invoice_id' }, 400);

  const { data: inv, error: invErr } = await adminClient
    .from('invoices')
    .select('*, customers(contact_name, company_name, billing_address, phone, email), work_orders(wo_number, title)')
    .eq('id', invoice_id)
    .single();
  if (invErr || !inv) return json({ error: 'Document not found' }, 404);

  if (auth.profile.role === 'customer') {
    const { data: cust } = await adminClient.from('customers').select('id').eq('profile_id', auth.userId).single();
    if (!cust || cust.id !== inv.customer_id) return json({ error: 'Forbidden' }, 403);
  }

  const { data: lines } = await adminClient
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice_id)
    .order('id', { ascending: true });

  const docTitle = inv.doc_type === 'estimate' ? 'ESTIMATE' : 'INVOICE';

  const b = await newPdf();
  header(b, docTitle, inv.invoice_number);

  keyValueRow(b, 'BILL TO', inv.customers?.company_name || inv.customers?.contact_name || '—');
  if (inv.customers?.billing_address) keyValueRow(b, 'ADDRESS', inv.customers.billing_address);
  if (inv.work_orders) keyValueRow(b, 'WORK ORDER', `${inv.work_orders.wo_number} — ${inv.work_orders.title}`);
  keyValueRow(b, 'STATUS', inv.status.replace(/_/g, ' ').toUpperCase());
  if (inv.due_date) keyValueRow(b, inv.doc_type === 'estimate' ? 'VALID UNTIL' : 'DUE DATE', inv.due_date);

  down(b, 6);
  table(
    b,
    [
      { label: 'Description', width: 259 },
      { label: 'Qty', width: 50, align: 'right' },
      { label: 'Unit Price', width: 90, align: 'right' },
      { label: 'Total', width: 100, align: 'right' }
    ],
    (lines ?? []).map((l: any) => [
      l.description,
      String(Number(l.quantity)),
      `$${Number(l.unit_price).toFixed(2)}`,
      `$${Number(l.line_total).toFixed(2)}`
    ])
  );

  down(b, 8);
  totalsBlock(b, [
    { label: 'Subtotal', value: `$${Number(inv.subtotal).toFixed(2)}` },
    { label: 'Tax', value: `$${Number(inv.tax).toFixed(2)}` },
    { label: 'Total', value: `$${Number(inv.total).toFixed(2)}`, emphasize: true },
    ...(inv.doc_type === 'invoice' && Number(inv.amount_paid) > 0
      ? [
          { label: 'Paid', value: `$${Number(inv.amount_paid).toFixed(2)}` },
          { label: 'Balance Due', value: `$${(Number(inv.total) - Number(inv.amount_paid)).toFixed(2)}`, emphasize: true }
        ]
      : [])
  ]);

  if (inv.notes) {
    down(b, 20);
    text(b, 'NOTES', 48, 10, { bold: true });
    down(b, 16);
    paragraph(b, inv.notes, 48, CONTENT_WIDTH, 9.5);
  }

  footer(
    b,
    inv.doc_type === 'estimate'
      ? 'This is an estimate, not a bill. Prices are subject to change.'
      : 'Thank you for your business. Please remit payment by the due date above.'
  );

  const bytes = await toBytes(b);
  const path = `${inv.doc_type === 'estimate' ? 'estimates' : 'invoices'}/${invoice_id}/${inv.invoice_number}.pdf`;

  const { error: uploadErr } = await adminClient.storage.from('documents').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true
  });
  if (uploadErr) return json({ error: uploadErr.message }, 500);

  await adminClient.from('invoices').update({ pdf_storage_path: path }).eq('id', invoice_id);

  const { data: signed } = await adminClient.storage.from('documents').createSignedUrl(path, 3600);

  return json({ ok: true, path, signed_url: signed?.signedUrl ?? null });
});