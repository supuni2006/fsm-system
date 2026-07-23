import { renderShell } from '@/components/layout';
import { listTechnicians, createTechnician, updateTechnician, setTechnicianActive, deleteTechnician } from '@/lib/technicians';
import type { Profile } from '@/types/database.types';

export async function renderTechnicians(profile: Profile) {
  const content = renderShell(profile, '/technicians', 'Technicians', 'Register technicians and manage who can be assigned jobs.');
  const canDelete = profile.role === 'admin';

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>All technicians</h2>
        <button class="btn btn-amber" id="new-btn">+ Register Technician</button>
      </div>
      <div id="table"></div>
    </div>
  `;

  async function load() {
    const el = document.getElementById('table')!;
    el.innerHTML = `<div class="empty-state">Loading…</div>`;

    let technicians: Profile[];
    try {
      technicians = await listTechnicians();
    } catch (err: any) {
      el.innerHTML = `<div class="empty-state">Could not load technicians: ${err.message}</div>`;
      return;
    }

    if (!technicians.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">🧑‍🔧</div>No technicians yet. Register one to start assigning jobs.</div>`;
      return;
    }

    el.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Skills</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${technicians
            .map(
              (t) => `<tr data-id="${t.id}">
                <td>${t.full_name}</td>
                <td>${t.phone ?? '—'}</td>
                <td>${(t.skills ?? []).join(', ') || '—'}</td>
                <td><span class="badge ${t.is_active ? 'badge-completed' : 'badge-cancelled'}">${t.is_active ? 'active' : 'inactive'}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-sm edit-btn">Edit</button>
                  <button class="btn btn-ghost btn-sm toggle-btn">${t.is_active ? 'Deactivate' : 'Activate'}</button>
                  ${canDelete ? `<button class="btn btn-ghost btn-sm delete-btn" title="Delete">🗑</button>` : ''}
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;

    el.querySelectorAll<HTMLElement>('tr[data-id]').forEach((row) => {
      const id = row.dataset.id!;
      const tech = technicians.find((t) => t.id === id)!;
      row.querySelector('.edit-btn')!.addEventListener('click', () => openEditModal(tech, load));
      row.querySelector('.toggle-btn')!.addEventListener('click', async () => {
        await setTechnicianActive(id, !tech.is_active);
        load();
      });
      row.querySelector('.delete-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete ${tech.full_name}? This permanently removes their account and can't be undone.`)) return;
        try {
          await deleteTechnician(id);
          load();
        } catch (err: any) {
          alert(err.message ?? 'Failed to delete technician.');
        }
      });
    });
  }

  document.getElementById('new-btn')!.addEventListener('click', () => openRegisterModal(load));

  await load();
}

function openRegisterModal(onDone: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>Register Technician</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <form id="form">
        <div class="field"><label>Full name</label><input id="full_name" required /></div>
        <div class="form-row">
          <div class="field"><label>Email</label><input id="email" type="email" required /></div>
          <div class="field"><label>Password</label><input id="password" type="password" minlength="6" required /></div>
        </div>
        <div class="field"><label>Phone (for WhatsApp updates)</label><input id="phone" placeholder="+94771234567" /></div>
        <div class="field"><label>Skills</label><input id="skills" placeholder="solar, hvac, electrical (comma-separated)" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          <button type="submit" class="btn btn-amber" id="submit-btn">Register Technician</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const submitBtn = backdrop.querySelector('#submit-btn') as HTMLButtonElement;
  backdrop.querySelector('#form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    const skillsRaw = (backdrop.querySelector('#skills') as HTMLInputElement).value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering…';
    try {
      await createTechnician({
        full_name: (backdrop.querySelector('#full_name') as HTMLInputElement).value.trim(),
        email: (backdrop.querySelector('#email') as HTMLInputElement).value.trim(),
        password: (backdrop.querySelector('#password') as HTMLInputElement).value,
        phone: (backdrop.querySelector('#phone') as HTMLInputElement).value.trim() || undefined,
        skills: skillsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      });
      close();
      onDone();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Failed to register technician.';
      errBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register Technician';
    }
  });
}

function openEditModal(tech: Profile, onDone: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>Edit Technician</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      <form id="form">
        <div class="field"><label>Full name</label><input id="full_name" value="${escapeAttr(tech.full_name)}" required /></div>
        <div class="field"><label>Phone</label><input id="phone" value="${escapeAttr(tech.phone ?? '')}" placeholder="+94771234567" /></div>
        <div class="field"><label>Skills</label><input id="skills" value="${escapeAttr((tech.skills ?? []).join(', '))}" placeholder="solar, hvac, electrical (comma-separated)" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          <button type="submit" class="btn btn-amber" id="submit-btn">Save Changes</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const submitBtn = backdrop.querySelector('#submit-btn') as HTMLButtonElement;
  backdrop.querySelector('#form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    const skillsRaw = (backdrop.querySelector('#skills') as HTMLInputElement).value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      await updateTechnician(tech.id, {
        full_name: (backdrop.querySelector('#full_name') as HTMLInputElement).value.trim(),
        phone: (backdrop.querySelector('#phone') as HTMLInputElement).value.trim() || null,
        skills: skillsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      });
      close();
      onDone();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Failed to save changes.';
      errBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes';
    }
  });
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}