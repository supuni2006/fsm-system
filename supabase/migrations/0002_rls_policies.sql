-- =========================================================
-- Row Level Security — role-based access
-- Roles: admin (full access), technician (assigned jobs only),
--        customer (own records only)
-- =========================================================

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.assets enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_status_history enable row level security;
alter table public.work_order_parts enable row level security;
alter table public.work_order_notes enable row level security;
alter table public.attachments enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.reminders enable row level security;

-- Helper: current user's role
create or replace function public.current_role()
returns user_role as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- Helper: customer_id linked to the current logged-in profile (if any)
create or replace function public.current_customer_id()
returns uuid as $$
  select id from public.customers where profile_id = auth.uid();
$$ language sql stable security definer;

-- ---------- PROFILES ----------
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.current_role() = 'admin');
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.current_role() = 'admin');
create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.current_role() = 'admin' or id = auth.uid());

-- Technicians are visible to admins and to themselves; also visible (name only via view) to
-- customers whose work order is assigned to them — handled at the application layer via a
-- restricted view (see 0003_views.sql) rather than loosening this table's policy.

-- ---------- CUSTOMERS ----------
create policy "customers_admin_all" on public.customers
  for all using (public.current_role() = 'admin');
create policy "customers_self_select" on public.customers
  for select using (profile_id = auth.uid());
create policy "customers_technician_select" on public.customers
  for select using (
    public.current_role() = 'technician' and id in (
      select customer_id from public.work_orders where assigned_technician_id = auth.uid()
    )
  );

-- ---------- ASSETS ----------
create policy "assets_admin_all" on public.assets
  for all using (public.current_role() = 'admin');
create policy "assets_customer_select" on public.assets
  for select using (customer_id = public.current_customer_id());
create policy "assets_technician_select" on public.assets
  for select using (
    public.current_role() = 'technician' and customer_id in (
      select customer_id from public.work_orders where assigned_technician_id = auth.uid()
    )
  );

-- ---------- INVENTORY (admin + technician can view; only admin can modify) ----------
create policy "inventory_admin_all" on public.inventory_items
  for all using (public.current_role() = 'admin');
create policy "inventory_technician_select" on public.inventory_items
  for select using (public.current_role() = 'technician');
create policy "inventory_txn_admin_all" on public.inventory_transactions
  for all using (public.current_role() = 'admin');
create policy "inventory_txn_technician_insert" on public.inventory_transactions
  for insert with check (
    public.current_role() = 'technician' and work_order_id in (
      select id from public.work_orders where assigned_technician_id = auth.uid()
    )
  );
create policy "inventory_txn_technician_select" on public.inventory_transactions
  for select using (
    public.current_role() = 'technician' and work_order_id in (
      select id from public.work_orders where assigned_technician_id = auth.uid()
    )
  );

-- ---------- WORK ORDERS ----------
create policy "wo_admin_all" on public.work_orders
  for all using (public.current_role() = 'admin');
create policy "wo_technician_select" on public.work_orders
  for select using (assigned_technician_id = auth.uid());
create policy "wo_technician_update" on public.work_orders
  for update using (assigned_technician_id = auth.uid());
create policy "wo_customer_select" on public.work_orders
  for select using (customer_id = public.current_customer_id());

-- ---------- WORK ORDER STATUS HISTORY ----------
create policy "wo_history_admin_all" on public.work_order_status_history
  for all using (public.current_role() = 'admin');
create policy "wo_history_technician_select" on public.work_order_status_history
  for select using (
    work_order_id in (select id from public.work_orders where assigned_technician_id = auth.uid())
  );
create policy "wo_history_customer_select" on public.work_order_status_history
  for select using (
    work_order_id in (select id from public.work_orders where customer_id = public.current_customer_id())
  );

-- ---------- WORK ORDER PARTS ----------
create policy "wo_parts_admin_all" on public.work_order_parts
  for all using (public.current_role() = 'admin');
create policy "wo_parts_technician_all" on public.work_order_parts
  for all using (
    work_order_id in (select id from public.work_orders where assigned_technician_id = auth.uid())
  );
create policy "wo_parts_customer_select" on public.work_order_parts
  for select using (
    work_order_id in (select id from public.work_orders where customer_id = public.current_customer_id())
  );

-- ---------- WORK ORDER NOTES ----------
create policy "wo_notes_admin_all" on public.work_order_notes
  for all using (public.current_role() = 'admin');
create policy "wo_notes_technician_all" on public.work_order_notes
  for all using (
    work_order_id in (select id from public.work_orders where assigned_technician_id = auth.uid())
  );
create policy "wo_notes_customer_select" on public.work_order_notes
  for select using (
    work_order_id in (select id from public.work_orders where customer_id = public.current_customer_id())
  );

-- ---------- ATTACHMENTS (images & PDFs) ----------
create policy "attachments_admin_all" on public.attachments
  for all using (public.current_role() = 'admin');
create policy "attachments_technician_all" on public.attachments
  for all using (
    work_order_id in (select id from public.work_orders where assigned_technician_id = auth.uid())
  );
create policy "attachments_customer_select" on public.attachments
  for select using (
    customer_id = public.current_customer_id()
    or work_order_id in (select id from public.work_orders where customer_id = public.current_customer_id())
  );
create policy "attachments_customer_insert" on public.attachments
  for insert with check (customer_id = public.current_customer_id());

-- ---------- INVOICES ----------
create policy "invoices_admin_all" on public.invoices
  for all using (public.current_role() = 'admin');
create policy "invoices_customer_select" on public.invoices
  for select using (customer_id = public.current_customer_id());
create policy "invoice_lines_admin_all" on public.invoice_line_items
  for all using (public.current_role() = 'admin');
create policy "invoice_lines_customer_select" on public.invoice_line_items
  for select using (
    invoice_id in (select id from public.invoices where customer_id = public.current_customer_id())
  );

-- ---------- WHATSAPP ----------
create policy "wa_conv_admin_all" on public.whatsapp_conversations
  for all using (public.current_role() = 'admin');
create policy "wa_msg_admin_all" on public.whatsapp_messages
  for all using (public.current_role() = 'admin');
-- Technicians can view (not modify) conversations tied to their assigned customers
create policy "wa_conv_technician_select" on public.whatsapp_conversations
  for select using (
    public.current_role() = 'technician' and customer_id in (
      select customer_id from public.work_orders where assigned_technician_id = auth.uid()
    )
  );
create policy "wa_msg_technician_select" on public.whatsapp_messages
  for select using (
    public.current_role() = 'technician' and conversation_id in (
      select id from public.whatsapp_conversations where customer_id in (
        select customer_id from public.work_orders where assigned_technician_id = auth.uid()
      )
    )
  );

-- ---------- REMINDERS ----------
create policy "reminders_admin_all" on public.reminders
  for all using (public.current_role() = 'admin');
create policy "reminders_recipient_select" on public.reminders
  for select using (recipient_profile_id = auth.uid());
