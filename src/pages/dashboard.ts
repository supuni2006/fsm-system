import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';
import { navigate } from '@/router';

export async function renderDashboard(profile: Profile) {
  const content = renderShell(profile, '/dashboard', `Hi ${profile.full_name.split(' ')[0]} 👋`, todayLabel());
  content.innerHTML = `<div class="stat-grid" id="stats"></div><div id="panels"></div>`;

  if (profile.role === 'admin') await renderAdminDashboard();
  else if (profile.role === 'technician') await renderTechnicianDashboard(profile);
  else await renderCustomerDashboard(profile);
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function renderAdminDashboard() {
  const { thisMonthStart, lastMonthStart } = monthBoundaries();

  const [
    { count: overdueInvoices },
    { count: lowStock },
    { count: totalWoThisMonth },
    { count: totalWoLastMonth },
    { count: completedWoThisMonth },
    { count: completedWoLastMonth },
    { count: apptsThisMonth },
    { count: apptsLastMonth },
    { count: completedApptsThisMonth },
    { count: completedApptsLastMonth },
    { data: recent }
  ] = await Promise.all([
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
    supabase.from('inventory_items').select('*', { count: 'exact', head: true }).lte('quantity_on_hand', 5),
    supabase.from('work_orders').select('*', { count: 'exact', head: true }).gte('created_at', thisMonthStart),
    supabase.from('work_orders').select('*', { count: 'exact', head: true }).gte('created_at', lastMonthStart).lt('created_at', thisMonthStart),
    supabase.from('work_orders').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', thisMonthStart),
    supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('updated_at', lastMonthStart)
      .lt('updated_at', thisMonthStart),
    supabase.from('work_orders').select('*', { count: 'exact', head: true }).not('scheduled_start', 'is', null).gte('scheduled_start', thisMonthStart),
    supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true })
      .not('scheduled_start', 'is', null)
      .gte('scheduled_start', lastMonthStart)
      .lt('scheduled_start', thisMonthStart),
    supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .not('scheduled_start', 'is', null)
      .gte('scheduled_start', thisMonthStart),
    supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .not('scheduled_start', 'is', null)
      .gte('scheduled_start', lastMonthStart)
      .lt('scheduled_start', thisMonthStart),
    supabase.from('work_orders').select('*, customers(contact_name)').order('created_at', { ascending: false }).limit(6)
  ]);

  document.getElementById('stats')!.innerHTML = `
    ${trendStatCard('Total Work Orders', totalWoThisMonth ?? 0, totalWoLastMonth ?? 0)}
    ${trendStatCard('Completed Work Orders', completedWoThisMonth ?? 0, completedWoLastMonth ?? 0)}
    ${trendStatCard('Total Service Appointments', apptsThisMonth ?? 0, apptsLastMonth ?? 0)}
    ${trendStatCard('Completed Service Appointments', completedApptsThisMonth ?? 0, completedApptsLastMonth ?? 0)}
    ${statCard('Overdue Invoices', overdueInvoices ?? 0, 'danger')}
    ${statCard('Low Stock Items', lowStock ?? 0, 'danger')}
  `;

  const recentIds = (recent ?? []).map((wo: any) => wo.id);
  let invoicedIds = new Set<string>();
  if (recentIds.length) {
    const { data: invoiced } = await supabase.from('invoices').select('work_order_id').in('work_order_id', recentIds);
    invoicedIds = new Set((invoiced ?? []).map((i: any) => i.work_order_id));
  }

  const rows = (recent ?? [])
    .map(
      (wo: any) => `<tr class="clickable" data-id="${wo.id}">
        <td>${wo.wo_number}</td><td>${wo.title}</td><td>${wo.customers?.contact_name ?? '—'}</td>
        <td><span class="badge badge-${wo.status}">${wo.status.replace(/_/g, ' ')}</span></td>
        <td><span class="badge ${invoicedIds.has(wo.id) ? 'badge-invoiced' : 'badge-not-invoiced'}">${invoicedIds.has(wo.id) ? 'Invoiced' : 'Not yet Invoiced'}</span></td>
      </tr>`
    )
    .join('');

  document.getElementById('panels')!.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>New Work Orders</h2><button class="btn btn-ghost btn-sm" id="view-all">View all →</button></div>
      ${rows ? `<table><thead><tr><th>WO#</th><th>Title</th><th>Customer</th><th>Status</th><th>Billing Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state"><div class="icon">🛠</div>No work orders yet.</div>`}
    </div>
  `;
  document.getElementById('view-all')!.addEventListener('click', () => navigate('/work-orders'));
  document.querySelectorAll<HTMLElement>('#panels tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/work-orders/${tr.dataset.id}`));
  });
}

/** Start-of-month ISO timestamps for "this month" and "last month", for month-over-month comparisons. */
function monthBoundaries() {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  return { thisMonthStart, lastMonthStart };
}

/** Percentage change from `previous` to `current`. 0/0 reads as no change; N/0 reads as +100%. */
function pctChange(current: number, previous: number): { pct: number; dir: 'up' | 'down' } {
  if (previous === 0) return current === 0 ? { pct: 0, dir: 'up' } : { pct: 100, dir: 'up' };
  const raw = ((current - previous) / previous) * 100;
  return { pct: Math.round(Math.abs(raw)), dir: raw >= 0 ? 'up' : 'down' };
}

function trendStatCard(label: string, current: number, previous: number): string {
  const { pct, dir } = pctChange(current, previous);
  return `<div class="stat-card">
    <div class="label">${label}</div>
    <div class="value-row">
      <div class="value">${current}</div>
      <span class="trend ${dir}">${dir === 'up' ? '↑' : '↓'} ${pct}%</span>
    </div>
    <div class="caption">Last Month ${previous}</div>
  </div>`;
}

async function renderTechnicianDashboard(profile: Profile) {
  const { data: jobs } = await supabase
    .from('work_orders')
    .select('*, customers(contact_name, service_address)')
    .eq('assigned_technician_id', profile.id)
    .not('status', 'in', '("completed","cancelled")')
    .order('scheduled_start', { ascending: true });

  const today = (jobs ?? []).filter((j: any) => isToday(j.scheduled_start));

  document.getElementById('stats')!.innerHTML = `
    ${statCard("Today's Jobs", today.length, 'amber')}
    ${statCard('All Active Jobs', (jobs ?? []).length, 'ok')}
  `;

  const rows = (jobs ?? [])
    .map(
      (wo: any) => `<tr class="clickable" data-id="${wo.id}">
        <td>${wo.wo_number}</td><td>${wo.title}</td>
        <td>${wo.customers?.contact_name ?? '—'}</td>
        <td>${wo.scheduled_start ? new Date(wo.scheduled_start).toLocaleString() : 'Unscheduled'}</td>
        <td><span class="badge badge-${wo.status}">${wo.status.replace(/_/g, ' ')}</span></td>
      </tr>`
    )
    .join('');

  document.getElementById('panels')!.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>My assigned jobs</h2></div>
      ${rows ? `<table><thead><tr><th>WO#</th><th>Title</th><th>Customer</th><th>Scheduled</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state"><div class="icon">✅</div>No active jobs assigned to you.</div>`}
    </div>
  `;
  document.querySelectorAll<HTMLElement>('#panels tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/work-orders/${tr.dataset.id}`));
  });
}

async function renderCustomerDashboard(profile: Profile) {
  const { data: customer } = await supabase.from('customers').select('id').eq('profile_id', profile.id).single();
  if (!customer) {
    document.getElementById('panels')!.innerHTML = `<div class="empty-state">No customer profile linked yet. Contact support.</div>`;
    return;
  }

  const [{ data: jobs }, { data: invoices }] = await Promise.all([
    supabase.from('work_orders').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('invoices').select('*').eq('customer_id', customer.id).in('status', ['sent', 'overdue', 'partially_paid'])
  ]);

  document.getElementById('stats')!.innerHTML = `
    ${statCard('Active Requests', (jobs ?? []).filter((j: any) => !['completed', 'cancelled'].includes(j.status)).length, 'amber')}
    ${statCard('Unpaid Invoices', (invoices ?? []).length, 'danger')}
  `;

  const rows = (jobs ?? [])
    .map(
      (wo: any) => `<tr class="clickable" data-id="${wo.id}">
        <td>${wo.wo_number}</td><td>${wo.title}</td>
        <td><span class="badge badge-${wo.status}">${wo.status.replace(/_/g, ' ')}</span></td>
      </tr>`
    )
    .join('');

  document.getElementById('panels')!.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>My service requests</h2></div>
      ${rows ? `<table><thead><tr><th>WO#</th><th>Title</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state"><div class="icon">🧰</div>No service requests yet.</div>`}
    </div>
  `;
  document.querySelectorAll<HTMLElement>('#panels tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/work-orders/${tr.dataset.id}`));
  });
}

function statCard(label: string, value: number | string, tone: 'amber' | 'danger' | 'ok' = 'amber') {
  return `<div class="stat-card"><div class="label">${label}</div><div class="value ${tone}">${value}</div></div>`;
}

function isToday(dateStr: string | null) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}