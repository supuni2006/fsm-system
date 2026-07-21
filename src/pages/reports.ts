import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';

export async function renderReports(profile: Profile) {
  const content = renderShell(profile, '/reports', 'Reports', 'Operational health at a glance.');
  content.innerHTML = `<div class="stat-grid" id="stats"></div><div class="panel" id="by-status"></div><div class="panel" id="by-tech"></div>`;

  const { data: workOrders } = await supabase.from('work_orders').select('status, assigned_technician_id, profiles!work_orders_assigned_technician_id_fkey(full_name)');
  const { data: invoices } = await supabase.from('invoices').select('status, total');

  const totalRevenue = (invoices ?? []).filter((i) => i.status === 'paid').reduce((sum, i) => sum + Number(i.total), 0);
  const outstanding = (invoices ?? [])
    .filter((i) => ['sent', 'overdue', 'partially_paid'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.total), 0);

  document.getElementById('stats')!.innerHTML = `
    <div class="stat-card"><div class="label">Total Work Orders</div><div class="value">${(workOrders ?? []).length}</div></div>
    <div class="stat-card"><div class="label">Completed</div><div class="value ok">${(workOrders ?? []).filter((w) => w.status === 'completed').length}</div></div>
    <div class="stat-card"><div class="label">Revenue (Paid)</div><div class="value ok">$${totalRevenue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">Outstanding</div><div class="value amber">$${outstanding.toFixed(2)}</div></div>
  `;

  const statusCounts: Record<string, number> = {};
  (workOrders ?? []).forEach((w) => (statusCounts[w.status] = (statusCounts[w.status] ?? 0) + 1));
  document.getElementById('by-status')!.innerHTML = `
    <div class="panel-head"><h2>Work orders by status</h2></div>
    ${Object.entries(statusCounts)
      .map(([status, count]) => `<div class="timeline-item"><span class="badge badge-${status}">${status.replace(/_/g, ' ')}</span><span style="margin-left:10px">${count}</span></div>`)
      .join('') || '<div class="empty-state">No data yet.</div>'}
  `;

  const techCounts: Record<string, number> = {};
  (workOrders ?? []).forEach((w: any) => {
    const name = w.profiles?.full_name ?? 'Unassigned';
    techCounts[name] = (techCounts[name] ?? 0) + 1;
  });
  document.getElementById('by-tech')!.innerHTML = `
    <div class="panel-head"><h2>Jobs by technician</h2></div>
    ${Object.entries(techCounts)
      .map(([name, count]) => `<div class="timeline-item">${name}<span style="margin-left:10px;color:var(--ink-soft)">${count} jobs</span></div>`)
      .join('') || '<div class="empty-state">No data yet.</div>'}
  `;
}
