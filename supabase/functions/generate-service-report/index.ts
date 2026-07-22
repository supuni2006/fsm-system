// Supabase Edge Function: generate-service-report
// Builds a PDF service report for a work order, uploads it to the
// 'documents' storage bucket, and upserts the service_reports row.
//
// Deploy:  supabase functions deploy generate-service-report

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { newPdf, header, footer, keyValueRow, table, text, paragraph, down, toBytes } from '../_shared/pdf.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const CONTENT_WIDTH = 499; // PAGE_W (595.28) - 2*MARGIN (48), minus a little padding

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const auth = await requireRole(req, ['admin', 'technician']);
  if ('error' in auth) return auth.error;

  const { work_order_id, summary, work_performed, recommendations } = await req.json();
  if (!work_order_id) return json({ error: 'Missing work_order_id' }, 400);

  const { data: wo, error: woErr } = await adminClient
    .from('work_orders')
    .select(
      '*, customers(contact_name, company_name, service_address, phone, email), profiles!work_orders_assigned_technician_id_fkey(full_name)'
    )
    .eq('id', work_order_id)
    .single();
  if (woErr || !wo) return json({ error: 'Work order not found' }, 404);

  if (auth.profile.role === 'technician' && wo.assigned_technician_id !== auth.userId) {
    return json({ error: 'Not your work order' }, 403);
  }

  const { data: parts } = await adminClient
    .from('work_order_parts')
    .select('quantity, unit_price, inventory_items(name, sku)')
    .eq('work_order_id', work_order_id);

  const { data: notes } = await adminClient
    .from('work_order_notes')
    .select('note, created_at, profiles(full_name)')
    .eq('work_order_id', work_order_id)
    .order('created_at', { ascending: true });

  // Upsert first to get a stable report_number (unique per work order).
  const { data: existing } = await adminClient
    .from('service_reports')
    .select('id, report_number')
    .eq('work_order_id', work_order_id)
    .maybeSingle();

  const reportNumber = existing?.report_number ?? `SR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${work_order_id.slice(0, 6)}`;

  const b = await newPdf();
  header(b, 'SERVICE REPORT', reportNumber);

  keyValueRow(b, 'CUSTOMER', wo.customers?.company_name || wo.customers?.contact_name || '—');
  keyValueRow(b, 'SERVICE ADDRESS', wo.customers?.service_address || wo.service_address || '—');
  keyValueRow(b, 'WORK ORDER', `${wo.wo_number} — ${wo.title}`);
  keyValueRow(b, 'TECHNICIAN', wo.profiles?.full_name ?? 'Unassigned');
  keyValueRow(
    b,
    'SERVICE DATE',
    wo.actual_end ? new Date(wo.actual_end).toLocaleString() : wo.scheduled_start ? new Date(wo.scheduled_start).toLocaleString() : '—'
  );

  down(b, 4);
  text(b, 'SUMMARY', 48, 10, { bold: true });
  down(b, 16);
  paragraph(b, summary || wo.description || 'No summary provided.', 48, CONTENT_WIDTH, 10);
  down(b, 10);

  text(b, 'WORK PERFORMED', 48, 10, { bold: true });
  down(b, 16);
  paragraph(b, work_performed || 'Not specified.', 48, CONTENT_WIDTH, 10);
  down(b, 10);

  if (recommendations) {
    text(b, 'RECOMMENDATIONS', 48, 10, { bold: true });
    down(b, 16);
    paragraph(b, recommendations, 48, CONTENT_WIDTH, 10);
    down(b, 10);
  }

  if (parts?.length) {
    text(b, 'PARTS USED', 48, 10, { bold: true });
    down(b, 18);
    table(
      b,
      [
        { label: 'Part', width: 300 },
        { label: 'Qty', width: 80, align: 'right' },
        { label: 'Unit Price', width: 118, align: 'right' }
      ],
      parts.map((p: any) => [p.inventory_items?.name ?? '—', String(p.quantity), `$${Number(p.unit_price).toFixed(2)}`])
    );
  }

  if (notes?.length) {
    down(b, 6);
    text(b, 'JOB NOTES', 48, 10, { bold: true });
    down(b, 16);
    for (const n of notes) {
      text(b, `${new Date(n.created_at).toLocaleDateString()} — ${n.profiles?.full_name ?? 'Unknown'}: ${n.note}`, 48, 9);
      down(b, 14);
    }
  }

  footer(b, 'Thank you for your business. Contact us with any questions about this report.');

  const bytes = await toBytes(b);
  const path = `service-reports/${work_order_id}/${reportNumber}.pdf`;

  const { error: uploadErr } = await adminClient.storage.from('documents').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true
  });
  if (uploadErr) return json({ error: uploadErr.message }, 500);

  const { data: saved, error: saveErr } = await adminClient
    .from('service_reports')
    .upsert(
      {
        id: existing?.id,
        report_number: reportNumber,
        work_order_id,
        summary: summary || wo.description || null,
        work_performed: work_performed || null,
        recommendations: recommendations || null,
        pdf_storage_path: path,
        generated_by: auth.userId,
        generated_at: new Date().toISOString()
      },
      { onConflict: 'work_order_id' }
    )
    .select()
    .single();
  if (saveErr) return json({ error: saveErr.message }, 500);

  const { data: signed } = await adminClient.storage.from('documents').createSignedUrl(path, 3600);

  return json({ ok: true, report: saved, signed_url: signed?.signedUrl ?? null });
});