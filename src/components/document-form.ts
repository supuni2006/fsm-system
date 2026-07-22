import { supabase } from '@/lib/supabase';
import { createDocument, updateDocument, computeTotals, type DocumentFormValues } from '@/lib/documents';
import type { Invoice, InvoiceLineItem } from '@/types/database.types';

interface Options {
  docType: 'estimate' | 'invoice';
  existing?: Invoice & { invoice_line_items?: InvoiceLineItem[] };
  onSaved: () => void;
}

let rowSeq = 0;

export async function openDocumentModal(opts: Options) {
  const { docType, existing, onSaved } = opts;
  const isEdit = !!existing;
  const label = docType === 'estimate' ? 'Estimate' : 'Invoice';

  const { data: customers } = await supabase.from('customers').select('id, contact_name, company_name').order('contact_name');
  const { data: workOrders } = await supabase.from('work_orders').select('id, wo_number, title').order('created_at', { ascending: false });

  let lineItems: { key: number; description: string; quantity: number; unit_price: number }[] = existing?.invoice_line_items?.length
    ? existing.invoice_line_items.map((l) => ({ key: rowSeq++, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) }))
    : [{ key: rowSeq++, description: '', quantity: 1, unit_price: 0 }];

  const initialTaxRate = existing && Number(existing.subtotal) > 0 ? (Number(existing.tax) / Number(existing.subtotal)) * 100 : 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-head"><h2>${isEdit ? `Edit ${label}` : `New ${label}`}</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <form id="doc-form">
        <div class="form-row">
          <div class="field"><label>Customer</label>
            <select id="customer_id" required>
              <option value="">Select…</option>
              ${(customers ?? [])
                .map((c) => `<option value="${c.id}" ${existing?.customer_id === c.id ? 'selected' : ''}>${c.company_name ?? c.contact_name}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field"><label>Related work order (optional)</label>
            <select id="work_order_id">
              <option value="">None</option>
              ${(workOrders ?? [])
                .map((w) => `<option value="${w.id}" ${existing?.work_order_id === w.id ? 'selected' : ''}>${w.wo_number} — ${w.title}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>${docType === 'estimate' ? 'Valid until' : 'Due date'}</label>
            <input type="date" id="due_date" value="${existing?.due_date ?? ''}" />
          </div>
          <div class="field"><label>Tax rate (%)</label>
            <input type="number" id="tax_rate" step="0.01" min="0" value="${initialTaxRate.toFixed(2)}" />
          </div>
        </div>

        <label style="display:block;margin:14px 0 6px">Line items</label>
        <div id="line-items"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-line">+ Add line item</button>

        <div class="field" style="margin-top:14px"><label>Notes</label><textarea id="notes" rows="2">${existing?.notes ?? ''}</textarea></div>

        <div style="text-align:right;margin-top:10px;font-size:13.5px;color:var(--ink-soft)" id="totals-preview"></div>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          <button type="submit" class="btn btn-amber" id="submit">${isEdit ? 'Save changes' : `Create ${label}`}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const linesEl = backdrop.querySelector('#line-items') as HTMLElement;
  const totalsEl = backdrop.querySelector('#totals-preview') as HTMLElement;
  const taxInput = backdrop.querySelector('#tax_rate') as HTMLInputElement;

  function renderLines() {
    linesEl.innerHTML = lineItems
      .map(
        (li) => `
      <div class="form-row" data-key="${li.key}" style="align-items:flex-end;margin-bottom:6px">
        <div class="field" style="flex:3"><input placeholder="Description" class="li-desc" value="${escapeAttr(li.description)}" /></div>
        <div class="field" style="flex:1"><input type="number" min="0" step="0.01" class="li-qty" value="${li.quantity}" /></div>
        <div class="field" style="flex:1"><input type="number" min="0" step="0.01" class="li-price" value="${li.unit_price}" /></div>
        <button type="button" class="btn btn-ghost btn-sm li-remove" title="Remove line" ${lineItems.length === 1 ? 'disabled' : ''}>✕</button>
      </div>`
      )
      .join('');

    linesEl.querySelectorAll<HTMLElement>('[data-key]').forEach((row) => {
      const key = Number(row.dataset.key);
      const item = lineItems.find((l) => l.key === key)!;
      (row.querySelector('.li-desc') as HTMLInputElement).addEventListener('input', (e) => {
        item.description = (e.target as HTMLInputElement).value;
      });
      (row.querySelector('.li-qty') as HTMLInputElement).addEventListener('input', (e) => {
        item.quantity = Number((e.target as HTMLInputElement).value) || 0;
        updateTotals();
      });
      (row.querySelector('.li-price') as HTMLInputElement).addEventListener('input', (e) => {
        item.unit_price = Number((e.target as HTMLInputElement).value) || 0;
        updateTotals();
      });
      row.querySelector('.li-remove')!.addEventListener('click', () => {
        lineItems = lineItems.filter((l) => l.key !== key);
        renderLines();
        updateTotals();
      });
    });
    updateTotals();
  }

  function updateTotals() {
    const { subtotal, tax, total } = computeTotals(lineItems, Number(taxInput.value) || 0);
    totalsEl.innerHTML = `Subtotal $${subtotal.toFixed(2)} &nbsp;·&nbsp; Tax $${tax.toFixed(2)} &nbsp;·&nbsp; <strong>Total $${total.toFixed(2)}</strong>`;
  }

  taxInput.addEventListener('input', updateTotals);
  backdrop.querySelector('#add-line')!.addEventListener('click', () => {
    lineItems.push({ key: rowSeq++, description: '', quantity: 1, unit_price: 0 });
    renderLines();
  });

  renderLines();

  backdrop.querySelector('#doc-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    errBox.style.display = 'none';

    const values: DocumentFormValues = {
      doc_type: docType,
      customer_id: (backdrop.querySelector('#customer_id') as HTMLSelectElement).value,
      work_order_id: (backdrop.querySelector('#work_order_id') as HTMLSelectElement).value || null,
      due_date: (backdrop.querySelector('#due_date') as HTMLInputElement).value || null,
      notes: (backdrop.querySelector('#notes') as HTMLTextAreaElement).value || null,
      tax_rate: Number(taxInput.value) || 0,
      line_items: lineItems.map(({ description, quantity, unit_price }) => ({ description, quantity, unit_price }))
    };

    if (!values.customer_id) {
      errBox.textContent = 'Please select a customer.';
      errBox.style.display = 'block';
      return;
    }
    if (!values.line_items.some((l) => l.description.trim())) {
      errBox.textContent = 'Add at least one line item.';
      errBox.style.display = 'block';
      return;
    }

    try {
      if (isEdit) {
        await updateDocument(existing!.id, values);
      } else {
        await createDocument(values);
      }
      close();
      onSaved();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Something went wrong.';
      errBox.style.display = 'block';
    }
  });
}

function escapeAttr(str: string): string {
  return (str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}