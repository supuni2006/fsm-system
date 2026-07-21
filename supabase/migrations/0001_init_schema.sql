-- =========================================================
-- FSM System — Core Schema
-- Modules: Auth/Profiles, Customers & Assets, Work Orders,
--          Dispatch/Scheduling, Inventory, Invoicing,
--          Attachments, WhatsApp, Reminders/Notifications
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------- ENUMS ----------
create type user_role as enum ('admin', 'technician', 'customer');
create type work_order_status as enum ('unassigned', 'scheduled', 'en_route', 'in_progress', 'on_hold', 'completed', 'cancelled');
create type work_order_priority as enum ('low', 'normal', 'high', 'urgent');
create type invoice_status as enum ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void');
create type reminder_status as enum ('pending', 'sent', 'failed', 'cancelled');
create type reminder_channel as enum ('whatsapp', 'email', 'sms', 'in_app');
create type message_direction as enum ('inbound', 'outbound');
create type message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

-- ---------- PROFILES (extends auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  full_name text not null,
  phone text,                      -- E.164 format, used for WhatsApp matching
  avatar_url text,
  is_active boolean not null default true,
  -- technician-only fields
  skills text[],
  home_base_lat double precision,
  home_base_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CUSTOMERS ----------
create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid references public.profiles(id) on delete set null, -- linked portal login, nullable
  company_name text,
  contact_name text not null,
  email text,
  phone text not null,             -- E.164, used for WhatsApp matching
  billing_address text,
  service_address text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- ASSETS (customer equipment/sites serviced) ----------
create table public.assets (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  category text,
  serial_number text,
  model text,
  install_date date,
  location text,
  warranty_expiry date,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- INVENTORY / PARTS ----------
create table public.inventory_items (
  id uuid primary key default uuid_generate_v4(),
  sku text unique not null,
  name text not null,
  description text,
  unit_cost numeric(12,2) not null default 0,
  unit_price numeric(12,2) not null default 0,
  quantity_on_hand integer not null default 0,
  reorder_level integer not null default 5,
  warehouse_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_transactions (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  work_order_id uuid, -- fk added after work_orders created
  change_qty integer not null,          -- negative = consumed, positive = restocked
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- WORK ORDERS ----------
create table public.work_orders (
  id uuid primary key default uuid_generate_v4(),
  wo_number text unique not null default ('WO-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 6)),
  customer_id uuid not null references public.customers(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete set null,
  title text not null,
  description text,
  status work_order_status not null default 'unassigned',
  priority work_order_priority not null default 'normal',
  assigned_technician_id uuid references public.profiles(id) on delete set null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  service_address text,
  service_lat double precision,
  service_lng double precision,
  signature_url text,             -- customer sign-off image
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_transactions
  add constraint fk_inv_txn_wo foreign key (work_order_id) references public.work_orders(id) on delete set null;

-- Work order status history (audit trail for dispatch/tracking)
create table public.work_order_status_history (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  status work_order_status not null,
  changed_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

-- Parts used on a work order (line items -> inventory)
create table public.work_order_parts (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity integer not null default 1,
  unit_price numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- Technician notes / job checklist entries
create table public.work_order_notes (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  author_id uuid references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now()
);

-- ---------- ATTACHMENTS (images & PDFs, stored in Supabase Storage) ----------
create table public.attachments (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid references public.work_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  storage_path text not null,      -- path inside the 'attachments' storage bucket
  file_name text not null,
  file_type text not null,         -- 'image' | 'pdf' | other mime category
  mime_type text not null,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- INVOICING ----------
create table public.invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text unique not null default ('INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 6)),
  work_order_id uuid references public.work_orders(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status invoice_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_line_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

-- ---------- WHATSAPP CHAT ----------
create table public.whatsapp_conversations (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid references public.customers(id) on delete set null,
  wa_phone_number text not null,     -- E.164 phone number of the contact
  last_message_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.whatsapp_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  direction message_direction not null,
  wa_message_id text,                 -- Meta's message id, for status callbacks
  body text,
  media_url text,                     -- for inbound media (image/pdf) synced to storage
  media_type text,
  status message_status not null default 'queued',
  sent_by uuid references public.profiles(id),  -- null for inbound
  created_at timestamptz not null default now()
);

-- ---------- REMINDERS / NOTIFICATIONS ----------
create table public.reminders (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid references public.work_orders(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  channel reminder_channel not null default 'whatsapp',
  message text not null,
  remind_at timestamptz not null,
  status reminder_status not null default 'pending',
  sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- INDEXES ----------
create index idx_work_orders_status on public.work_orders(status);
create index idx_work_orders_technician on public.work_orders(assigned_technician_id);
create index idx_work_orders_customer on public.work_orders(customer_id);
create index idx_work_orders_scheduled on public.work_orders(scheduled_start);
create index idx_invoices_customer on public.invoices(customer_id);
create index idx_invoices_status on public.invoices(status);
create index idx_attachments_wo on public.attachments(work_order_id);
create index idx_wa_messages_conv on public.whatsapp_messages(conversation_id);
create index idx_reminders_remind_at on public.reminders(remind_at) where status = 'pending';
create index idx_inventory_low_stock on public.inventory_items(quantity_on_hand);

-- ---------- updated_at TRIGGER HELPER ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();
create trigger trg_wo_updated before update on public.work_orders for each row execute function public.set_updated_at();
create trigger trg_inv_items_updated before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger trg_invoices_updated before update on public.invoices for each row execute function public.set_updated_at();

-- ---------- Auto-create profile row on signup ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Work order status history logger ----------
create or replace function public.log_work_order_status()
returns trigger as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into public.work_order_status_history (work_order_id, status, changed_by)
    values (new.id, new.status, new.assigned_technician_id);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_wo_status_log
  after insert or update of status on public.work_orders
  for each row execute function public.log_work_order_status();
