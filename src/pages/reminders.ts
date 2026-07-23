import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile, ReminderChannel } from '@/types/database.types';

export async function renderReminders(profile: Profile) {
  const content = renderShell(profile, '/reminders', 'Reminders', 'Automated nudges for jobs, invoices, and follow-ups.');
  const canDelete = profile.role === 'admin';
  content.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Upcoming reminders</h2><button class="btn btn-amber" id="new-btn">+ New Reminder</button></div>
      <div id="table"></div>
    </div>
  `;

  async function load() {
    const { data } = await supabase
      .from('reminders')
      .select('*, customers(contact_name), work_orders(wo_number)')
      .order('remind_at', { ascending: true });

    const el = document.getElementById('table')!;
    if (!data?.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">⏰</div>No reminders scheduled.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Send at</th><th>Channel</th><th>Recipient</th><th>Message</th><th>Status</th>${canDelete ? '<th></th>' : ''}</tr></thead>
        <tbody>${data
          .map(
            (r: any) => `<tr>
              <td>${new Date(r.remind_at).toLocaleString()}</td>
              <td>${r.channel}</td>
              <td>${r.customers?.contact_name ?? '—'}${r.work_orders?.wo_number ? ` (${r.work_orders.wo_number})` : ''}</td>
              <td style="max-width:280px">${r.message}</td>
              <td><span class="badge badge-${r.status === 'sent' ? 'completed' : r.status === 'failed' ? 'cancelled' : 'scheduled'}">${r.status}</span></td>
              ${
                canDelete
                  ? `<td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-action="delete" data-id="${r.id}" title="Delete">🗑</button></td>`
                  : ''
              }
            </tr>`
          )
          .join('')}</tbody>
      </table>
    `;

    if (canDelete) {
      el.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id!;
          if (!confirm(`Delete this reminder? This can't be undone.`)) return;
          const { error } = await supabase.from('reminders').delete().eq('id', id);
          if (error) {
            alert(error.message);
            return;
          }
          load();
        });
      });
    }
  }

  document.getElementById('new-btn')!.addEventListener('click', async () => {
    const { data: customers } = await supabase.from('customers').select('id, contact_name').order('contact_name');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h2>New Reminder</h2><button class="modal-close" id="close">✕</button></div>
        <div id="err" class="form-error" style="display:none"></div>
        <form id="form">
          <div class="field"><label>Customer</label>
            <select id="customer_id" required><option value="">Select…</option>${(customers ?? [])
              .map((c) => `<option value="${c.id}">${c.contact_name}</option>`)
              .join('')}</select>
          </div>
          <div class="form-row">
            <div class="field"><label>Channel</label>
              <select id="channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option><option value="in_app">In-app</option></select>
            </div>
            <div class="field"><label>Send at</label><input type="datetime-local" id="remind_at" required /></div>
          </div>
          <div class="field"><label>Message</label><textarea id="message" rows="3" placeholder="e.g. Reminder: your technician arrives tomorrow at 10am." required></textarea></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-amber">Schedule Reminder</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#close')!.addEventListener('click', close);
    backdrop.querySelector('#cancel')!.addEventListener('click', close);
    backdrop.querySelector('#form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('reminders').insert({
        customer_id: (backdrop.querySelector('#customer_id') as HTMLSelectElement).value,
        channel: (backdrop.querySelector('#channel') as HTMLSelectElement).value as ReminderChannel,
        remind_at: new Date((backdrop.querySelector('#remind_at') as HTMLInputElement).value).toISOString(),
        message: (backdrop.querySelector('#message') as HTMLTextAreaElement).value,
        created_by: userData.user?.id
      });
      if (error) {
        const errEl = backdrop.querySelector('#err') as HTMLElement;
        errEl.textContent = error.message;
        errEl.style.display = 'block';
        return;
      }
      close();
      load();
    });
  });

  await load();
  document.getElementById('table')!.innerHTML += `
    <p style="font-size:12.5px;color:var(--ink-faint);margin-top:14px">
      Reminders are dispatched by the <code>send-reminders</code> Edge Function, run on a schedule
      (e.g. every 5 minutes via Supabase Cron) — see supabase/functions/send-reminders.
    </p>`;
}