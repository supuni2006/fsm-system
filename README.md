# FieldFlow — Field Service Management System

A Zoho-FSM-style system: work orders, scheduling & dispatch, customer & asset
management, inventory, invoicing, reports, role-based auth (admin / technician
/ customer portal), image & PDF attachments, WhatsApp Business chat, and
scheduled reminders.

**Stack:** TypeScript, vanilla JS/HTML, CSS · Supabase (Postgres, Auth, Storage,
Edge Functions, Realtime) · WhatsApp Business Cloud API (Meta)

---

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the three migration files **in order**:
   - `supabase/migrations/0001_init_schema.sql`
   - `supabase/migrations/0002_rls_policies.sql`
   - `supabase/migrations/0003_storage.sql`

   Or, with the Supabase CLI:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
3. Copy `.env.example` to `.env` and fill in:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Project Settings → API.

## 2. Run the app

```bash
npm install
npm run dev
```

Open the app, click **Create one**, and register your first user as **Admin**.
From there, create customers, technicians (register more accounts and pick
"Technician"), inventory, and work orders.

## 3. Connect WhatsApp (Meta Business Cloud API)

You said you already have Meta WhatsApp Business API access, so:

1. In `.env`, plus as **Supabase Edge Function secrets** (not the frontend —
   these must stay server-side), set:
   ```
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_VERIFY_TOKEN=any-random-string-you-choose
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   ```bash
   npx supabase secrets set --env-file .env
   ```
2. Deploy the three edge functions:
   ```bash
   npx supabase functions deploy whatsapp-webhook --no-verify-jwt
   npx supabase functions deploy send-whatsapp-message
   npx supabase functions deploy send-reminders
   ```
3. In the Meta App Dashboard → WhatsApp → Configuration, set the webhook
   callback URL to:
   ```
   https://YOUR_PROJECT_REF.functions.supabase.co/whatsapp-webhook
   ```
   and the verify token to the same `WHATSAPP_VERIFY_TOKEN` value.
4. Schedule the reminders dispatcher to run every few minutes:
   ```bash
   npx supabase functions schedule send-reminders --cron "*/5 * * * *"
   ```

Once connected, messages customers send to your WhatsApp Business number
land in the **WhatsApp Chat** tab in real time (matched to a customer by
phone number), and staff replies send back through Meta's API.

## 4. What's implemented vs. what to extend

**Implemented (working end-to-end):**
- Email/password auth with role selection (admin / technician / customer),
  auto-created profile row, role-based routing and Row Level Security.
- Work orders: create, assign a technician, schedule, update status
  (with full audit history), notes, and image/PDF attachments (Supabase
  Storage, signed URLs).
- Customers, assets schema, inventory with low-stock flagging.
- Invoicing schema + list view (see below for what to extend).
- Reports: job counts by status/technician, revenue vs. outstanding.
- WhatsApp: inbound webhook, outbound send function, live chat UI via
  Supabase Realtime, media download-and-store for inbound images/PDFs.
- Reminders: scheduling UI + cron-based dispatcher edge function.

**Left as extension points** (schema is ready; UI is intentionally minimal
so you can shape these to your workflow):
- Invoice creation/editing UI and PDF generation (line items table exists —
  `invoice_line_items`).
- Technician GPS tracking / map view (`service_lat`/`service_lng`,
  `home_base_lat`/`home_base_lng` columns are in place).
- Customer self-service booking form (customers can currently view but not
  create work orders — flip `wo_customer_select`/add an insert policy when
  you're ready).
- Recurring/preventive-maintenance schedules.
- Push/email notifications beyond WhatsApp (stub is in `send-reminders`).

## 5. Project structure

```
src/
  lib/          supabase client, auth helpers
  components/   shell/layout, attachments uploader
  pages/        one file per screen
  types/        hand-written DB types (swap for `supabase gen types` later)
  styles/       design tokens + all CSS
supabase/
  migrations/   schema, RLS policies, storage buckets
  functions/    whatsapp-webhook, send-whatsapp-message, send-reminders
```
