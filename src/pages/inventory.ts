import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';

export async function renderInventory(profile: Profile) {
  const content = renderShell(profile, '/inventory', 'Inventory', 'Track parts, stock levels, and reorder points.');
  const canEdit = profile.role === 'admin';

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Parts &amp; stock</h2>${canEdit ? `<button class="btn btn-amber" id="new-btn">+ New Item</button>` : ''}</div>
      <div id="table"></div>
    </div>
  `;

  async function load() {
    const { data } = await supabase.from('inventory_items').select('*').order('name');
    const el = document.getElementById('table')!;
    if (!data?.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">📦</div>No inventory items yet.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>SKU</th><th>Name</th><th>On hand</th><th>Reorder at</th><th>Unit price</th><th>Status</th></tr></thead>
        <tbody>${data
          .map((i) => {
            const low = i.quantity_on_hand <= i.reorder_level;
            return `<tr><td>${i.sku}</td><td>${i.name}</td><td>${i.quantity_on_hand}</td><td>${i.reorder_level}</td><td>$${Number(i.unit_price).toFixed(2)}</td>
              <td><span class="badge ${low ? 'badge-urgent' : 'badge-completed'}">${low ? 'Reorder now' : 'In stock'}</span></td></tr>`;
          })
          .join('')}</tbody>
      </table>
    `;
  }

  if (canEdit) {
    document.getElementById('new-btn')!.addEventListener('click', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal">
          <div class="modal-head"><h2>New Inventory Item</h2><button class="modal-close" id="close">✕</button></div>
          <div id="err" class="form-error" style="display:none"></div>
          <form id="form">
            <div class="form-row">
              <div class="field"><label>SKU</label><input id="sku" required /></div>
              <div class="field"><label>Name</label><input id="name" required /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Unit cost</label><input id="unit_cost" type="number" step="0.01" value="0" /></div>
              <div class="field"><label>Unit price</label><input id="unit_price" type="number" step="0.01" value="0" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Quantity on hand</label><input id="qty" type="number" value="0" /></div>
              <div class="field"><label>Reorder level</label><input id="reorder" type="number" value="5" /></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
              <button type="submit" class="btn btn-amber">Save Item</button>
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
        const { error } = await supabase.from('inventory_items').insert({
          sku: (backdrop.querySelector('#sku') as HTMLInputElement).value,
          name: (backdrop.querySelector('#name') as HTMLInputElement).value,
          unit_cost: Number((backdrop.querySelector('#unit_cost') as HTMLInputElement).value),
          unit_price: Number((backdrop.querySelector('#unit_price') as HTMLInputElement).value),
          quantity_on_hand: Number((backdrop.querySelector('#qty') as HTMLInputElement).value),
          reorder_level: Number((backdrop.querySelector('#reorder') as HTMLInputElement).value)
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
  }

  await load();
}
