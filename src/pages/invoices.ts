import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';

export async function renderInvoices(profile: Profile) {
  const content = renderShell(profile, '/invoices', 'Invoices', 'Billing and payment status for completed work.');
  content.innerHTML = `<div class="panel"><div class="panel-head"><h2>All invoices</h2></div><div id="table"></div></div>`;

  let query = supabase
    .from('invoices')
    .select('*, customers(contact_name)')
    .order('created_at', { ascending: false });

  if (profile.role === 'customer') {
    const { data: cust } = await supabase.from('customers').select('id').eq('profile_id', profile.id).single();
    query = query.eq('customer_id', cust?.id ?? '');
  }

  const { data } = await query;
  const el = document.getElementById('table')!;
  if (!data?.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🧾</div>No invoices yet.</div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>${data
        .map(
          (inv: any) => `<tr>
            <td>${inv.invoice_number}</td>
            <td>${inv.customers?.contact_name ?? '—'}</td>
            <td>$${Number(inv.total).toFixed(2)}</td>
            <td>$${Number(inv.amount_paid).toFixed(2)}</td>
            <td>${inv.due_date ?? '—'}</td>
            <td><span class="badge badge-${inv.status}">${inv.status.replace(/_/g, ' ')}</span></td>
          </tr>`
        )
        .join('')}</tbody>
    </table>
  `;
}
