import { supabase } from '@/lib/supabase';
import type { Invoice, InvoiceLineItem, ServiceReport } from '@/types/database.types';

// ---------------- Service reports ----------------

export async function generateServiceReport(
  workOrderId: string,
  fields: { summary?: string; work_performed?: string; recommendations?: string }
): Promise<{ report: ServiceReport; signed_url: string | null }> {
  const { data, error } = await supabase.functions.invoke('generate-service-report', {
    body: { work_order_id: workOrderId, ...fields }
  });
  if (error) throw new Error(await extractError(error));
  return data;
}

export async function getServiceReport(workOrderId: string): Promise<ServiceReport | null> {
  const { data } = await supabase.from('service_reports').select('*').eq('work_order_id', workOrderId).maybeSingle();
  return data ?? null;
}

// ---------------- Invoices & estimates ----------------

export async function generateDocumentPdf(invoiceId: string): Promise<{ path: string; signed_url: string | null }> {
  const { data, error } = await supabase.functions.invoke('generate-document-pdf', { body: { invoice_id: invoiceId } });
  if (error) throw new Error(await extractError(error));
  return data;
}

export async function getSignedPdfUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/** Ensures a PDF exists (generating it if needed) and returns a fresh signed URL. */
export async function ensurePdfUrl(invoice: Pick<Invoice, 'id' | 'pdf_storage_path'>): Promise<string> {
  if (invoice.pdf_storage_path) {
    const url = await getSignedPdfUrl(invoice.pdf_storage_path);
    if (url) return url;
  }
  const { signed_url } = await generateDocumentPdf(invoice.id);
  if (!signed_url) throw new Error('PDF generation did not return a URL');
  return signed_url;
}

export async function downloadPdf(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function printPdf(url: string) {
  const win = window.open(url, '_blank');
  // Give the PDF a moment to load before invoking print in the new tab.
  win?.addEventListener('load', () => win.print());
}

export async function deleteInvoice(id: string) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteServiceReport(id: string) {
  const { error } = await supabase.from('service_reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface DocumentFormValues {
  doc_type: 'estimate' | 'invoice';
  customer_id: string;
  work_order_id: string | null;
  due_date: string | null;
  notes: string | null;
  tax_rate: number; // percentage, e.g. 8.5
  line_items: { description: string; quantity: number; unit_price: number }[];
}

export async function createDocument(values: DocumentFormValues): Promise<Invoice> {
  const { subtotal, tax, total } = computeTotals(values.line_items, values.tax_rate);
  const { data: userData } = await supabase.auth.getUser();

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      doc_type: values.doc_type,
      customer_id: values.customer_id,
      work_order_id: values.work_order_id,
      due_date: values.due_date,
      notes: values.notes,
      subtotal,
      tax,
      total,
      status: 'draft',
      created_by: userData.user?.id
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await insertLineItems(invoice.id, values.line_items);
  return invoice;
}

export async function updateDocument(id: string, values: DocumentFormValues): Promise<void> {
  const { subtotal, tax, total } = computeTotals(values.line_items, values.tax_rate);

  const { error } = await supabase
    .from('invoices')
    .update({
      customer_id: values.customer_id,
      work_order_id: values.work_order_id,
      due_date: values.due_date,
      notes: values.notes,
      subtotal,
      tax,
      total,
      pdf_storage_path: null // stale after edits; regenerated on next view/send
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.from('invoice_line_items').delete().eq('invoice_id', id);
  await insertLineItems(id, values.line_items);
}

async function insertLineItems(invoiceId: string, items: DocumentFormValues['line_items']) {
  const rows = items
    .filter((i) => i.description.trim())
    .map((i) => ({ invoice_id: invoiceId, description: i.description, quantity: i.quantity, unit_price: i.unit_price }));
  if (!rows.length) return;
  const { error } = await supabase.from('invoice_line_items').insert(rows);
  if (error) throw new Error(error.message);
}

export function computeTotals(items: { quantity: number; unit_price: number }[], taxRatePct: number) {
  const subtotal = items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const tax = subtotal * ((Number(taxRatePct) || 0) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Converts an estimate into a brand-new invoice, copying customer, work order, and line items. */
export async function convertEstimateToInvoice(estimateId: string): Promise<Invoice> {
  const { data: estimate, error } = await supabase.from('invoices').select('*').eq('id', estimateId).single();
  if (error || !estimate) throw new Error(error?.message ?? 'Estimate not found');

  const { data: lines } = await supabase.from('invoice_line_items').select('*').eq('invoice_id', estimateId);
  const { data: userData } = await supabase.auth.getUser();

  const { data: invoice, error: createErr } = await supabase
    .from('invoices')
    .insert({
      doc_type: 'invoice',
      customer_id: estimate.customer_id,
      work_order_id: estimate.work_order_id,
      due_date: estimate.due_date,
      notes: estimate.notes,
      subtotal: estimate.subtotal,
      tax: estimate.tax,
      total: estimate.total,
      status: 'draft',
      converted_from_estimate_id: estimateId,
      created_by: userData.user?.id
    })
    .select()
    .single();
  if (createErr) throw new Error(createErr.message);

  await insertLineItems(
    invoice.id,
    (lines ?? []).map((l: InvoiceLineItem) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price }))
  );

  return invoice;
}

// ---------------- Email send ----------------

export async function sendDocumentViaEmail(args: {
  storage_path: string;
  filename: string;
  caption?: string;
  customer_id: string;
  source: 'service_report' | 'invoice' | 'estimate';
  source_id: string;
}) {
  const { data, error } = await supabase.functions.invoke('send-document-email', { body: args });
  if (error) throw new Error(await extractError(error));
  return data;
}

async function extractError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    return body?.error?.message || body?.error || error.message || 'Request failed';
  } catch {
    return error?.message ?? 'Request failed';
  }
}