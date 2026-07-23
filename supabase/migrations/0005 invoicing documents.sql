-- =========================================================
-- Finish wiring up invoicing/estimates: the UI (src/pages/invoices.ts,
-- src/lib/documents.ts) and the generate-document-pdf edge function were
-- already written against this shape — this migration is what was missing
-- for them to actually work.
-- =========================================================

-- ---------- doc_type: an invoices row is either an estimate or an invoice ----------
create type invoice_doc_type as enum ('estimate', 'invoice');

alter table public.invoices
  add column doc_type invoice_doc_type not null default 'invoice',
  add column pdf_storage_path text,
  add column converted_from_estimate_id uuid references public.invoices(id) on delete set null;

create index idx_invoices_doc_type on public.invoices(doc_type);

-- ---------- Storage bucket for generated invoice/estimate PDFs ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- Admins manage everything; customers can only read PDFs for their own invoices
-- (path convention: {estimates|invoices}/{invoice_id}/{invoice_number}.pdf).
create policy "documents_bucket_admin_all" on storage.objects
  for all using (
    bucket_id = 'documents' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "documents_bucket_customer_read" on storage.objects
  for select using (
    bucket_id = 'documents' and
    exists (
      select 1 from public.invoices
      where invoices.customer_id = public.current_customer_id()
        and invoices.pdf_storage_path = storage.objects.name
    )
  );