import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import { openDocumentModal } from '@/components/document-form';
import { openSendEmailModal } from '@/components/send-email-modal';
import { ensurePdfUrl, downloadPdf, printPdf, deleteInvoice, convertEstimateToInvoice } from '@/lib/documents';
import type { Profile, DocType } from '@/types/database.types';
import { navigate } from '@/router';

export async function renderInvoices(profile: Profile) {
  const content = renderShell(profile, '/invoices', 'Invoices & Estimates', 'Bills, estimates, and invoices — generate PDFs and email to customers.');
  const isAdmin = profile.role === 'admin';

  content.innerHTML = `
    <div class="tabs">
      <div class="tab active" data-doc-type="estimate">Estimates &amp; Bills</div>
      <div class="tab" data-doc-type="invoice">Invoices</div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h2 id="panel-title">All estimates</h2>
        ${isAdmin ? `<button class="btn btn-amber" id="new-doc-btn">+ New Estimate</button>` : ''}
      </div>
      <div id="table"></div>
    </div>
  `;

  let activeType: DocType = 'estimate';

  const tabs = content.querySelectorAll<HTMLElement>('.tab');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeType = t.dataset.docType as DocType;
      document.getElementById('panel-title')!.textContent = activeType === 'estimate' ? 'All estimates' : 'All invoices';
      const newBtn = document.getElementById('new-doc-btn');
      if (newBtn) newBtn.textContent = activeType === 'estimate' ? '+ New Estimate' : '+ New Invoice';
      load();
    })
  );

  if (isAdmin) {
    document.getElementById('new-doc-btn')!.addEventListener('click', () => {
      openDocumentModal({ docType: activeType, onSaved: load });
    });
  }

  async function load() {
    let query = supabase
      .from('invoices')
      .select('*, customers(contact_name, company_name, phone)')
      .eq('doc_type', activeType)
      .order('created_at', { ascending: false });

    if (profile.role === 'customer') {
      const { data: cust } = await supabase.from('customers').select('id').eq('profile_id', profile.id).single();
      query = query.eq('customer_id', cust?.id ?? '');
    }

    const { data, error } = await query;
    const el = document.getElementById('table')!;
    if (error) {
      el.innerHTML = `<div class="empty-state">Could not load documents: ${error.message}</div>`;
      return;
    }
    if (!data?.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">🧾</div>No ${activeType === 'estimate' ? 'estimates' : 'invoices'} yet.</div>`;
      return;
    }

    el.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>${activeType === 'estimate' ? 'Estimate #' : 'Invoice #'}</th>
            <th>Customer</th><th>Total</th>${activeType === 'invoice' ? '<th>Paid</th>' : ''}
            <th>${activeType === 'estimate' ? 'Valid until' : 'Due'}</th><th>Status</th><th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>${data.map((inv: any) => row(inv, activeType, isAdmin)).join('')}</tbody>
      </table>
    `;

    el.querySelectorAll<HTMLElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        const action = btn.dataset.action!;
        const inv = data.find((d: any) => d.id === id);
        if (!inv) return;
        await handleAction(action, inv);
      });
    });

    if (isAdmin) {
      el.querySelectorAll<HTMLElement>('tr[data-row-id]').forEach((tr) => {
        tr.addEventListener('click', async () => {
          const inv = data.find((d: any) => d.id === tr.dataset.rowId);
          if (!inv) return;
          const { data: lines } = await supabase.from('invoice_line_items').select('*').eq('invoice_id', inv.id);
          openDocumentModal({ docType: activeType, existing: { ...inv, invoice_line_items: lines ?? [] }, onSaved: load });
        });
      });
    }
  }

  async function handleAction(action: string, inv: any) {
    const label = inv.customers?.company_name ?? inv.customers?.contact_name ?? 'customer';
    try {
      if (action === 'download') {
        const url = await ensurePdfUrl(inv);
        await downloadPdf(url, inv.invoice_number);
      } else if (action === 'print') {
        const url = await ensurePdfUrl(inv);
        printPdf(url);
      } else if (action === 'send') {
        await ensurePdfUrl(inv); // makes sure pdf_storage_path is populated before we send it
        const { data: fresh } = await supabase.from('invoices').select('pdf_storage_path').eq('id', inv.id).single();
        openSendEmailModal({
          customerName: label,
          customerEmail: inv.customers?.email ?? null,
          storage_path: fresh?.pdf_storage_path ?? '',
          filename: `${inv.invoice_number}.pdf`,
          defaultCaption:
            activeType === 'estimate'
              ? `Hi ${label}, here's your estimate ${inv.invoice_number} from us. Let us know if you'd like to go ahead!`
              : `Hi ${label}, here's your invoice ${inv.invoice_number}. Total due: $${Number(inv.total).toFixed(2)}.`,
          source: activeType,
          sourceId: inv.id,
          onSent: load
        });
      } else if (action === 'convert') {
        if (!confirm(`Convert ${inv.invoice_number} into a new invoice? This creates a separate invoice — the estimate stays as-is.`)) return;
        const newInvoice = await convertEstimateToInvoice(inv.id);
        alert(`Created invoice ${newInvoice.invoice_number}.`);
        navigate('/invoices');
        load();
      } else if (action === 'delete') {
        if (!confirm(`Delete ${inv.invoice_number}? This can't be undone.`)) return;
        await deleteInvoice(inv.id);
        load();
      }
    } catch (err: any) {
      alert(err.message ?? 'Something went wrong.');
    }
  }

  await load();
}

function row(inv: any, docType: DocType, isAdmin: boolean): string {
  const customerLabel = inv.customers?.company_name ?? inv.customers?.contact_name ?? '—';
  const actions: string[] = [
    `<button class="btn btn-ghost btn-sm" data-action="download" data-id="${inv.id}" title="Download PDF">⬇ PDF</button>`,
    `<button class="btn btn-ghost btn-sm" data-action="print" data-id="${inv.id}" title="Print">🖨</button>`
  ];
  if (isAdmin) {
    actions.push(`<button class="btn btn-ghost btn-sm" data-action="send" data-id="${inv.id}" title="Send via WhatsApp">💬</button>`);
    if (docType === 'estimate') {
      actions.push(`<button class="btn btn-ghost btn-sm" data-action="convert" data-id="${inv.id}" title="Convert to invoice">➜ Invoice</button>`);
    }
    actions.push(`<button class="btn btn-ghost btn-sm" data-action="delete" data-id="${inv.id}" title="Delete">🗑</button>`);
  }

  return `<tr data-row-id="${inv.id}" class="${isAdmin ? 'clickable' : ''}">
    <td>${inv.invoice_number}</td>
    <td>${customerLabel}</td>
    <td>$${Number(inv.total).toFixed(2)}</td>
    ${docType === 'invoice' ? `<td>$${Number(inv.amount_paid).toFixed(2)}</td>` : ''}
    <td>${inv.due_date ?? '—'}</td>
    <td><span class="badge badge-${inv.status}">${inv.status.replace(/_/g, ' ')}</span></td>
    <td style="text-align:right;white-space:nowrap">${actions.join(' ')}</td>
  </tr>`;
}