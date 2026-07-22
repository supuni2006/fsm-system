-- =========================================================
-- Work Order Lifecycle — assign -> notify -> accept -> start -> end
-- =========================================================

-- New statuses: 'assigned' (tech picked, awaiting response) and
-- 'accepted' (tech confirmed, hasn't started driving/working yet).
alter type work_order_status add value if not exists 'assigned' before 'scheduled';
alter type work_order_status add value if not exists 'accepted' after 'assigned';

-- Track the assignment/acceptance timestamps and an optional decline reason,
-- separate from actual_start/actual_end which already track Start/End Work.
alter table public.work_orders add column if not exists assigned_at timestamptz;
alter table public.work_orders add column if not exists accepted_at timestamptz;
alter table public.work_orders add column if not exists declined_at timestamptz;
alter table public.work_orders add column if not exists decline_reason text;

-- Let a WhatsApp conversation belong to a technician (not just a customer),
-- so assignment notifications and technician replies land in the same thread.
alter table public.whatsapp_conversations add column if not exists technician_id uuid references public.profiles(id) on delete set null;
create index if not exists idx_wa_conv_technician on public.whatsapp_conversations(technician_id);

-- A conversation should resolve to at most one counterparty type; enforce
-- "not both null" is already implied by wa_phone_number being required, so
-- no extra constraint is needed — customer_id/technician_id may both be set
-- if a technician is also a portal customer, which is fine.

-- ---------- RLS: technicians can see + insert on their own conversations too ----------
drop policy if exists "wa_conv_technician_select" on public.whatsapp_conversations;
create policy "wa_conv_technician_select" on public.whatsapp_conversations
  for select using (
    public.current_role() = 'technician' and (
      technician_id = auth.uid()
      or customer_id in (select customer_id from public.work_orders where assigned_technician_id = auth.uid())
    )
  );

drop policy if exists "wa_msg_technician_select" on public.whatsapp_messages;
create policy "wa_msg_technician_select" on public.whatsapp_messages
  for select using (
    public.current_role() = 'technician' and conversation_id in (
      select id from public.whatsapp_conversations where
        technician_id = auth.uid()
        or customer_id in (select customer_id from public.work_orders where assigned_technician_id = auth.uid())
    )
  );

-- Admins assign; the assigned technician drives every subsequent status change
-- (accept/decline/start/end) themselves. wo_technician_update already covers this
-- (policy already exists from 0002 — no change needed there).