-- =========================================================
-- Switch document delivery tracking from WhatsApp to email.
--
-- Note: `service_reports` isn't defined in any tracked migration in this
-- repo (it was evidently created out-of-band against the shape that
-- generate-service-report/index.ts and src/lib/documents.ts already expect).
-- This migration is defensive about that with `if exists`/`if not exists`,
-- but if service reports have never worked for you, that table needs to be
-- created first — see generate-service-report/index.ts for the columns it
-- reads and writes.
-- =========================================================

alter table if exists public.service_reports
  add column if not exists sent_to_email text;

-- sent_to_phone (if it exists from the old WhatsApp flow) is no longer
-- written to, but left in place rather than dropped, in case you want to
-- keep the historical record of who a report was sent to over WhatsApp.