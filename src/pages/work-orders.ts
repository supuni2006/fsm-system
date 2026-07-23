import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import { mountAttachments } from '@/components/attachments';
import { generateServiceReport, getServiceReport, deleteServiceReport, getSignedPdfUrl, downloadPdf, printPdf } from '@/lib/documents';
import { assignTechnician, acceptWorkOrder, declineWorkOrder, startWork, endWork, sendStartWorkEmail } from '@/lib/work-order-actions';
import type { Profile, WorkOrderPriority, WorkOrderStatus } from '@/types/database.types';
import { navigate } from '@/router';

const STATUSES: WorkOrderStatus[] = ['unassigned', 'assigned', 'accepted', 'scheduled', 'en_route', 'in_progress', 'on_hold', 'completed', 'cancelled'];
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
        <thead><tr><th>WO#</th><th>Title</th><th>Customer</th><th>Technician</th><th>Priority</th><th>Scheduled</th><th>Status</th>${canCreate ? '<th></th>' : ''}</tr></thead>
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
              ${
                canCreate
                  ? `<td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-action="delete" data-id="${wo.id}" title="Delete">🗑</button></td>`
                  : ''
              }
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    tableEl.querySelectorAll<HTMLElement>('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => navigate(`/work-orders/${tr.dataset.id}`));
    });
    if (canCreate) {
      tableEl.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation(); // don't trigger the row's navigate-to-detail click
          const id = btn.dataset.id!;
          const wo = data.find((w: any) => w.id === id);
          if (!confirm(`Delete work order ${wo?.wo_number ?? ''}? This can't be undone.`)) return;
          const { error } = await supabase.from('work_orders').delete().eq('id', id);
          if (error) {
            alert(error.message);
            return;
          }
          load(status);
        });
      });
    }
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
    const { data: created, error } = await supabase
      .from('work_orders')
      .insert({
        title: (backdrop.querySelector('#title') as HTMLInputElement).value,
        description: (backdrop.querySelector('#description') as HTMLTextAreaElement).value || null,
        customer_id: (backdrop.querySelector('#customer_id') as HTMLSelectElement).value,
        priority: (backdrop.querySelector('#priority') as HTMLSelectElement).value as WorkOrderPriority,
        assigned_technician_id: technicianId,
        status: technicianId ? 'assigned' : 'unassigned',
        assigned_at: technicianId ? new Date().toISOString() : null,
        scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        service_address: (backdrop.querySelector('#service_address') as HTMLInputElement).value || null,
        created_by: userData.user?.id
      })
      .select('id')
      .single();

    if (error) {
      errBox.textContent = error.message;
      errBox.style.display = 'block';
      return;
    }
    close();
    onDone();

    // Best-effort — the work order is already created either way.
    if (technicianId && created) {
      supabase.functions.invoke('send-work-order-assignment', { body: { work_order_id: created.id } }).catch(() => {});
    }
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

  const isAssignedTech = profile.role === 'technician' && wo.assigned_technician_id === profile.id;
  const canEdit = profile.role === 'admin' || isAssignedTech;
  const isAdmin = profile.role === 'admin';

  // Technicians get guided buttons for the main lifecycle; everything else (including
  // admin, always) falls back to the free-form status dropdown as an override.
  const guidedStatuses: WorkOrderStatus[] = ['assigned', 'accepted', 'in_progress'];
  const showGuidedActions = isAssignedTech && guidedStatuses.includes(wo.status);
  const dropdownStatuses = isAdmin ? STATUSES : STATUSES.filter((s) => s !== 'assigned' && s !== 'accepted');

  let technicians: { id: string; full_name: string }[] = [];
  if (isAdmin) {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'technician').eq('is_active', true);
    technicians = data ?? [];
  }

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
        isAdmin
          ? `<div class="field" style="max-width:260px">
              <label>${wo.assigned_technician_id ? 'Reassign technician' : 'Assign technician'}</label>
              <select id="assign-select">
                <option value="">Unassigned</option>
                ${technicians.map((t) => `<option value="${t.id}" ${t.id === wo.assigned_technician_id ? 'selected' : ''}>${t.full_name}</option>`).join('')}
              </select>
              <div id="assign-status" style="font-size:12px;color:var(--ink-soft);margin-top:6px"></div>
              ${
                wo.assigned_technician_id && wo.status !== 'in_progress' && wo.status !== 'completed' && wo.status !== 'cancelled'
                  ? `<button class="btn btn-ghost btn-sm" id="send-start-email" style="margin-top:8px">✉ Email "Start Work" link</button>
                     <div id="send-start-email-status" style="font-size:12px;color:var(--ink-soft);margin-top:6px"></div>`
                  : ''
              }
            </div>`
          : ''
      }

      ${
        showGuidedActions
          ? `<div id="lifecycle-actions" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
              ${wo.status === 'assigned' ? `<button class="btn btn-success" id="accept-btn">✓ Accept Job</button><button class="btn btn-ghost" id="decline-btn">Decline</button>` : ''}
              ${wo.status === 'accepted' ? `<button class="btn btn-success" id="start-btn">▶ Start Work</button>` : ''}
              ${wo.status === 'in_progress' ? `<button class="btn btn-danger" id="end-btn">■ End Work</button>` : ''}
            </div>`
          : ''
      }

      ${
        canEdit && !showGuidedActions
          ? `<div class="field" style="max-width:260px;margin-top:14px">
              <label>Update status</label>
              <select id="status-select">${dropdownStatuses.map((s) => `<option value="${s}" ${s === wo.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
            </div>`
          : ''
      }
    </div>

    <div class="tabs">
      <div class="tab active" data-tab="notes">Notes</div>
      <div class="tab" data-tab="attachments">Photos & PDFs</div>
      <div class="tab" data-tab="report">Service Report</div>
      <div class="tab" data-tab="history">Status History</div>
    </div>
    <div id="tab-content"></div>
  `;

  if (isAdmin) {
    document.getElementById('assign-select')!.addEventListener('change', async (e) => {
      const technicianId = (e.target as HTMLSelectElement).value;
      const statusEl = document.getElementById('assign-status')!;
      if (!technicianId) {
        await supabase.from('work_orders').update({ assigned_technician_id: null, status: 'unassigned' }).eq('id', id);
        renderWorkOrderDetail(profile, id);
        return;
      }
      statusEl.textContent = 'Assigning and sending WhatsApp notification…';
      try {
        const result = await assignTechnician(id, technicianId);
        statusEl.textContent = result.whatsappSent ? 'Assigned — WhatsApp notification sent.' : `Assigned, but WhatsApp message failed: ${result.whatsappError}`;
      } catch (err: any) {
        statusEl.textContent = err.message ?? 'Failed to assign technician.';
        return;
      }
      renderWorkOrderDetail(profile, id);
    });

    document.getElementById('send-start-email')?.addEventListener('click', async () => {
      const btn = document.getElementById('send-start-email') as HTMLButtonElement;
      const statusEl = document.getElementById('send-start-email-status')!;
      btn.disabled = true;
      statusEl.textContent = 'Sending email…';
      try {
        const { sentTo } = await sendStartWorkEmail(id);
        statusEl.textContent = `Sent to ${sentTo}. They can tap "Start Work" in the email — no login needed.`;
      } catch (err: any) {
        statusEl.textContent = err.message ?? 'Failed to send email.';
      } finally {
        btn.disabled = false;
      }
    });
  }

  document.getElementById('accept-btn')?.addEventListener('click', async () => {
    await acceptWorkOrder(id);
    renderWorkOrderDetail(profile, id);
  });
  document.getElementById('decline-btn')?.addEventListener('click', () => {
    openDeclineModal(async (reason) => {
      await declineWorkOrder(id, reason);
      renderWorkOrderDetail(profile, id);
    });
  });
  document.getElementById('start-btn')?.addEventListener('click', async () => {
    await startWork(id);
    renderWorkOrderDetail(profile, id);
  });
  document.getElementById('end-btn')?.addEventListener('click', async () => {
    await endWork(id);
    openGenerateReportModal({ ...wo, status: 'completed' }, () => {
      navigate(`/work-orders/${id}`);
    });
  });

  if (canEdit) {
    document.getElementById('status-select')?.addEventListener('change', async (e) => {
      const newStatus = (e.target as HTMLSelectElement).value as WorkOrderStatus;
      await supabase.from('work_orders').update({ status: newStatus }).eq('id', id);
      if (newStatus === 'completed') {
        openGenerateReportModal(wo, () => {
          const reportTab = document.querySelector<HTMLElement>('.tab[data-tab="report"]');
          reportTab?.click();
        });
      }
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
    } else if (tab === 'report') {
      const report = await getServiceReport(id);
      if (!report) {
        tabContent.innerHTML = `
          <div class="panel">
            <div class="empty-state"><div class="icon">📄</div>No service report yet.</div>
            ${canEdit ? `<div style="text-align:center"><button class="btn btn-amber" id="gen-report">Generate Service Report</button></div>` : ''}
          </div>`;
        if (canEdit) {
          document.getElementById('gen-report')!.addEventListener('click', () => openGenerateReportModal(wo, () => renderTab('report')));
        }
      } else {
        tabContent.innerHTML = `
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 style="font-size:16px">${report.report_number}</h2>
                <div class="sub" style="color:var(--ink-soft);font-size:12.5px;margin-top:2px">
                  Generated ${report.generated_at ? new Date(report.generated_at).toLocaleString() : '—'}
                  ${report.sent_at ? ` · Sent to customer ${new Date(report.sent_at).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
            <p style="font-size:13.5px;color:var(--ink-soft)"><strong>Summary:</strong> ${report.summary ?? '—'}</p>
            <p style="font-size:13.5px;color:var(--ink-soft)"><strong>Work performed:</strong> ${report.work_performed ?? '—'}</p>
            ${report.recommendations ? `<p style="font-size:13.5px;color:var(--ink-soft)"><strong>Recommendations:</strong> ${report.recommendations}</p>` : ''}
            <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" id="rep-download">⬇ Download PDF</button>
              <button class="btn btn-ghost btn-sm" id="rep-print">🖨 Print</button>
              ${canEdit ? `<button class="btn btn-ghost btn-sm" id="rep-send">💬 Send via WhatsApp</button>` : ''}
              ${canEdit ? `<button class="btn btn-ghost btn-sm" id="rep-regen">↻ Regenerate</button>` : ''}
              ${profile.role === 'admin' ? `<button class="btn btn-ghost btn-sm" id="rep-delete">🗑 Delete</button>` : ''}
            </div>
          </div>`;

        document.getElementById('rep-download')!.addEventListener('click', async () => {
          const url = report.pdf_storage_path ? await getSignedPdfUrl(report.pdf_storage_path) : null;
          if (url) await downloadPdf(url, report.report_number);
        });
        document.getElementById('rep-print')!.addEventListener('click', async () => {
          const url = report.pdf_storage_path ? await getSignedPdfUrl(report.pdf_storage_path) : null;
          if (url) printPdf(url);
        });
        document.getElementById('rep-send')?.addEventListener('click', () => {
          openSendWhatsappModal({
            customerId: (wo as any).customer_id,
            customerName: wo.customers?.contact_name ?? 'customer',
            customerPhone: wo.customers?.phone ?? null,
            storagePath: report.pdf_storage_path ?? '',
            filename: `${report.report_number}.pdf`,
            defaultCaption: `Hi ${wo.customers?.contact_name ?? ''}, here's the service report for your recent job (${wo.wo_number}).`,
            source: 'service_report',
            sourceId: report.id,
            onSent: () => renderTab('report')
          });
        });
        document.getElementById('rep-regen')?.addEventListener('click', () => openGenerateReportModal(wo, () => renderTab('report')));
        document.getElementById('rep-delete')?.addEventListener('click', async () => {
          if (!confirm('Delete this service report?')) return;
          await deleteServiceReport(report.id);
          renderTab('report');
        });
      }
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

function openDeclineModal(onConfirm: (reason: string) => void | Promise<void>) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>Decline Job</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:-4px">
        This sends the job back to the unassigned pool so it can be reassigned.
      </p>
      <div class="field"><label>Reason (optional)</label><textarea id="decline-reason" rows="3" placeholder="Let the office know why you can't take this one…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
        <button type="button" class="btn btn-danger" id="confirm">Decline Job</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const confirmBtn = backdrop.querySelector('#confirm') as HTMLButtonElement;
  confirmBtn.addEventListener('click', async () => {
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    const reason = (backdrop.querySelector('#decline-reason') as HTMLTextAreaElement).value.trim();
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Declining…';
    try {
      await onConfirm(reason);
      close();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Failed to decline job.';
      errBox.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Decline Job';
    }
  });
}

function openGenerateReportModal(wo: any, onDone: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h2>Generate Service Report</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:-4px">
        This creates a PDF service report for ${wo.wo_number} that you can download or send to the customer on WhatsApp.
      </p>
      <div class="field"><label>Summary</label><textarea id="rg-summary" rows="2" placeholder="Brief summary of the visit…">${wo.description ?? ''}</textarea></div>
      <div class="field"><label>Work performed</label><textarea id="rg-work" rows="3" placeholder="What was done on site…"></textarea></div>
      <div class="field"><label>Recommendations (optional)</label><textarea id="rg-rec" rows="2" placeholder="Follow-up work, parts to order, etc."></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Skip for now</button>
        <button type="button" class="btn btn-amber" id="generate">Generate PDF</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const generateBtn = backdrop.querySelector('#generate') as HTMLButtonElement;
  generateBtn.addEventListener('click', async () => {
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
    try {
      await generateServiceReport(wo.id, {
        summary: (backdrop.querySelector('#rg-summary') as HTMLTextAreaElement).value,
        work_performed: (backdrop.querySelector('#rg-work') as HTMLTextAreaElement).value,
        recommendations: (backdrop.querySelector('#rg-rec') as HTMLTextAreaElement).value
      });
      close();
      onDone();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Failed to generate report.';
      errBox.style.display = 'block';
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate PDF';
    }
  });
}