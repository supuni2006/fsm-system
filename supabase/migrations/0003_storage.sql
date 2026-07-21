-- =========================================================
-- Storage buckets for attachments (images, PDFs) and avatars
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400, -- 25MB
  array['image/png','image/jpeg','image/jpg','image/webp','image/heic','application/pdf']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 26214400)
on conflict (id) do nothing;

-- Authenticated users can read/write attachments; fine-grained checks happen via the
-- `attachments` table RLS + application logic (path convention: work_orders/{wo_id}/{file})
create policy "attachments_bucket_read" on storage.objects
  for select using (bucket_id = 'attachments' and auth.role() = 'authenticated');

create policy "attachments_bucket_insert" on storage.objects
  for insert with check (bucket_id = 'attachments' and auth.role() = 'authenticated');

create policy "attachments_bucket_delete" on storage.objects
  for delete using (
    bucket_id = 'attachments' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_write" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy "whatsapp_media_admin_only" on storage.objects
  for all using (
    bucket_id = 'whatsapp-media' and
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','technician'))
  );
