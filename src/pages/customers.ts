import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';

export async function renderCustomers(profile: Profile) {
  const content = renderShell(profile, '/customers', 'Customers', 'Manage accounts, sites, and equipment.');
  const canDelete = profile.role === 'admin';
  content.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>All customers</h2><button class="btn btn-amber" id="new-btn">+ New Customer</button></div>
      <div id="table"></div>
    </div>
  `;

  async function load() {
    const { data } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    const el = document.getElementById('table')!;
    if (!data?.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">👤</div>No customers yet.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Service Address</th>${canDelete ? '<th></th>' : ''}</tr></thead>
        <tbody>${data
          .map(
            (c) => `<tr><td>${c.contact_name}</td><td>${c.company_name ?? '—'}</td><td>${c.phone}</td><td>${c.email ?? '—'}</td><td>${c.service_address ?? '—'}</td>${
              canDelete
                ? `<td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-action="delete" data-id="${c.id}" title="Delete">🗑</button></td>`
                : ''
            }</tr>`
          )
          .join('')}</tbody>
      </table>
    `;

    if (canDelete) {
      el.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id!;
          const customer = data.find((c) => c.id === id);
          const label = customer?.company_name ?? customer?.contact_name ?? 'this customer';
          if (!confirm(`Delete ${label}? This can't be undone.`)) return;
          const { error } = await supabase.from('customers').delete().eq('id', id);
          if (error) {
            alert(error.message);
            return;
          }
          load();
        });
      });
    }
  }

  document.getElementById('new-btn')!.addEventListener('click', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h2>New Customer</h2><button class="modal-close" id="close">✕</button></div>
        <div id="err" class="form-error" style="display:none"></div>
        <form id="form">
          <div class="form-row">
            <div class="field"><label>Contact name</label><input id="contact_name" required /></div>
            <div class="field"><label>Company</label><input id="company_name" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Phone (WhatsApp)</label><input id="phone" placeholder="+94771234567" required /></div>
            <div class="field"><label>Email</label><input id="email" type="email" /></div>
          </div>
          <div class="field"><label>Service address</label><input id="service_address" /></div>
          <div class="field"><label>Billing address</label><input id="billing_address" /></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-amber">Save Customer</button>
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
      const { error } = await supabase.from('customers').insert({
        contact_name: (backdrop.querySelector('#contact_name') as HTMLInputElement).value,
        company_name: (backdrop.querySelector('#company_name') as HTMLInputElement).value || null,
        phone: (backdrop.querySelector('#phone') as HTMLInputElement).value,
        email: (backdrop.querySelector('#email') as HTMLInputElement).value || null,
        service_address: (backdrop.querySelector('#service_address') as HTMLInputElement).value || null,
        billing_address: (backdrop.querySelector('#billing_address') as HTMLInputElement).value || null,
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
}