import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import { mountAttachments } from '@/components/attachments';
import type { Profile, WorkOrderPriority, WorkOrderStatus } from '@/types/database.types';
import { navigate } from '@/router';

const STATUSES: WorkOrderStatus[] = ['unassigned', 'scheduled', 'en_route', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const PRIORITIES: WorkOrderPriority[] = ['low', 'normal', 'high', 'urgent'];

// ---------------- LIST ----------------
export async function renderWorkOrdersList(profile: Profile) {
  const content = renderShell(profile, '/work-orders', 'Work Orders', 'Schedule, dispatch, and track every job.');

  const canCreate = profile.role === 'admin';
  content.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div style="display:flex;gap:8px">
          <select id="filter-status" class="filter-select"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}">${s.replace(/_/g, ' ')}</option>`).join('')}</select>
        </div>
        ${canCreate ? `<button class="btn btn-amber" id="new-wo-btn">+ New Work Order</button>` : ''}
      </div>
      <div id="wo-table"></div>
    </div>
  `;

  async function load(status = '') {
    let query = supabase
      .from('work_orders')
      .select('*, customers(contact_name), profiles!work_orders_assigned_technician_id_fkey(full_name)')
      .order('created_at', { ascending: false });

    if (profile.role === 'technician') query = query.eq('assigned_technician_id', profile.id);
    if (profile.role === 'customer') {
      const { data: cust } = await supabase.from('customers').select('id').eq('profile_id', profile.id).single();
      query = query.eq('customer_id', cust?.id ?? '');
    }
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    const tableEl = document.getElementById('wo-table')!;
    if (error) {
      tableEl.innerHTML = `<div class="empty-state">Could not load work orders: ${error.message}</div>`;
      return;
    }
    if (!data?.length) {
      tableEl.innerHTML = `<div class="empty-state"><div class="icon">🛠</div>No work orders found.</div>`;
      return;
    }
    tableEl.innerHTML = `
      <table>
        <thead><tr><th>WO#</th><th>Title</th><th>Customer</th><th>Technician</th><th>Priority</th><th>Scheduled</th><th>Status</th></tr></thead>
        <tbody>
          ${data
            .map(
              (wo: any) => `<tr class="clickable" data-id="${wo.id}">
              <td>${wo.wo_number}</td>
              <td>${wo.title}</td>
              <td>${wo.customers?.contact_name ?? '—'}</td>
              <td>${wo.profiles?.full_name ?? '<span style="color:var(--ink-faint)">Unassigned</span>'}</td>
              <td><span class="badge badge-${wo.priority}">${wo.priority}</span></td>
              <td>${wo.scheduled_start ? new Date(wo.scheduled_start).toLocaleString() : '—'}</td>
              <td><span class="badge badge-${wo.status}">${wo.status.replace(/_/g, ' ')}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    tableEl.querySelectorAll<HTMLElement>('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => navigate(`/work-orders/${tr.dataset.id}`));
    });
  }

  document.getElementById('filter-status')!.addEventListener('change', (e) => {
    load((e.target as HTMLSelectElement).value);
  });

  if (canCreate) {
    document.getElementById('new-wo-btn')!.addEventListener('click', () => openCreateModal(load));
  }

  await load();
}

async function openCreateModal(onDone: () => void) {
  const { data: customers } = await supabase.from('customers').select('id, contact_name').order('contact_name');
  const { data: technicians } = await supabase.from('profiles').select('id, full_name').eq('role', 'technician');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>New Work Order</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <form id="wo-form">
        <div class="field"><label>Title</label><input id="title" required /></div>
        <div class="field"><label>Description</label><textarea id="description" rows="3"></textarea></div>
        <div class="form-row">
          <div class="field"><label>Customer</label>
            <select id="customer_id" required><option value="">Select…</option>${(customers ?? [])
              .map((c) => `<option value="${c.id}">${c.contact_name}</option>`)
              .join('')}</select>
          </div>
          <div class="field"><label>Priority</label>
            <select id="priority">${PRIORITIES.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Assign technician</label>
            <select id="technician_id"><option value="">Unassigned</option>${(technicians ?? [])
              .map((t) => `<option value="${t.id}">${t.full_name}</option>`)
              .join('')}</select>
          </div>
          <div class="field"><label>Scheduled start</label><input type="datetime-local" id="scheduled_start" /></div>
        </div>
        <div class="field"><label>Service address</label><input id="service_address" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          <button type="submit" class="btn btn-amber" id="submit">Create Work Order</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  backdrop.querySelector('#wo-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    const technicianId = (backdrop.querySelector('#technician_id') as HTMLSelectElement).value || null;
    const scheduledStart = (backdrop.querySelector('#scheduled_start') as HTMLInputElement).value;

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('work_orders').insert({
      title: (backdrop.querySelector('#title') as HTMLInputElement).value,
      description: (backdrop.querySelector('#description') as HTMLTextAreaElement).value || null,
      customer_id: (backdrop.querySelector('#customer_id') as HTMLSelectElement).value,
      priority: (backdrop.querySelector('#priority') as HTMLSelectElement).value as WorkOrderPriority,
      assigned_technician_id: technicianId,
      status: technicianId ? 'scheduled' : 'unassigned',
      scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : null,
      service_address: (backdrop.querySelector('#service_address') as HTMLInputElement).value || null,
      created_by: userData.user?.id
    });

    if (error) {
      errBox.textContent = error.message;
      errBox.style.display = 'block';
      return;
    }
    close();
    onDone();
  });
}

// ---------------- DETAIL ----------------
export async function renderWorkOrderDetail(profile: Profile, id: string) {
  const content = renderShell(profile, '/work-orders', 'Work Order', '');

  const { data: wo, error } = await supabase
    .from('work_orders')
    .select('*, customers(contact_name, phone, service_address), profiles!work_orders_assigned_technician_id_fkey(id, full_name)')
    .eq('id', id)
    .single();

  if (error || !wo) {
    content.innerHTML = `<div class="empty-state">Work order not found.</div>`;
    return;
  }

  const canEdit = profile.role === 'admin' || (profile.role === 'technician' && wo.assigned_technician_id === profile.id);

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="font-size:18px">${wo.wo_number} — ${wo.title}</h2>
          <div class="sub" style="color:var(--ink-soft);font-size:13px;margin-top:4px">
            ${wo.customers?.contact_name ?? '—'} · ${wo.customers?.service_address ?? wo.service_address ?? 'No address'}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge badge-${wo.priority}">${wo.priority}</span>
          <span class="badge badge-${wo.status}">${wo.status.replace(/_/g, ' ')}</span>
        </div>
      </div>
      <p style="font-size:13.5px;color:var(--ink-soft)">${wo.description ?? 'No description provided.'}</p>

      ${
        canEdit
          ? `<div class="field" style="max-width:260px">
              <label>Update status</label>
              <select id="status-select">${STATUSES.map((s) => `<option value="${s}" ${s === wo.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
            </div>`
          : ''
      }
    </div>

    <div class="tabs">
      <div class="tab active" data-tab="notes">Notes</div>
      <div class="tab" data-tab="attachments">Photos & PDFs</div>
      <div class="tab" data-tab="history">Status History</div>
    </div>
    <div id="tab-content"></div>
  `;

  if (canEdit) {
    document.getElementById('status-select')!.addEventListener('change', async (e) => {
      const newStatus = (e.target as HTMLSelectElement).value as WorkOrderStatus;
      await supabase.from('work_orders').update({ status: newStatus }).eq('id', id);
    });
  }

  const tabContent = document.getElementById('tab-content')!;
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      renderTab(t.dataset.tab!);
    })
  );

  async function renderTab(tab: string) {
    if (tab === 'notes') {
      const { data: notes } = await supabase
        .from('work_order_notes')
        .select('*, profiles(full_name)')
        .eq('work_order_id', id)
        .order('created_at', { ascending: false });
      tabContent.innerHTML = `
        <div class="panel">
          ${canEdit ? `<div class="field"><textarea id="new-note" rows="2" placeholder="Add a note about this job…"></textarea></div><button class="btn btn-primary btn-sm" id="add-note">Add note</button>` : ''}
          <div style="margin-top:16px">
            ${(notes ?? []).map((n: any) => `<div class="timeline-item"><div class="time">${new Date(n.created_at).toLocaleString()}</div><div><strong>${n.profiles?.full_name ?? 'Unknown'}:</strong> ${n.note}</div></div>`).join('') || '<div class="empty-state">No notes yet.</div>'}
          </div>
        </div>
      `;
      if (canEdit) {
        document.getElementById('add-note')!.addEventListener('click', async () => {
          const text = (document.getElementById('new-note') as HTMLTextAreaElement).value.trim();
          if (!text) return;
          const { data: userData } = await supabase.auth.getUser();
          await supabase.from('work_order_notes').insert({ work_order_id: id, author_id: userData.user?.id, note: text });
          renderTab('notes');
        });
      }
    } else if (tab === 'attachments') {
      tabContent.innerHTML = `<div class="panel"><div id="attach-mount"></div></div>`;
      const { data: userData } = await supabase.auth.getUser();
      await mountAttachments(document.getElementById('attach-mount')!, id, userData.user!.id);
    } else {
      const { data: history } = await supabase
        .from('work_order_status_history')
        .select('*')
        .eq('work_order_id', id)
        .order('created_at', { ascending: false });
      tabContent.innerHTML = `
        <div class="panel">
          ${(history ?? []).map((h: any) => `<div class="timeline-item"><div class="time">${new Date(h.created_at).toLocaleString()}</div><span class="badge badge-${h.status}">${h.status.replace(/_/g, ' ')}</span></div>`).join('') || '<div class="empty-state">No history yet.</div>'}
        </div>
      `;
    }
  }

  await renderTab('notes');
}
