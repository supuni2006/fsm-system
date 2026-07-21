import { supabase } from '@/lib/supabase';
import type { Attachment } from '@/types/database.types';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Mounts an upload widget + gallery inside `container`.
 * Scoped to a single work order (images from the field, PDFs like reports/warranties).
 */
export async function mountAttachments(container: HTMLElement, workOrderId: string, uploadedBy: string) {
  container.innerHTML = `
    <div class="dropzone" id="dropzone">
      📎 Click or drag images / PDFs here (max 25MB each)
      <input type="file" id="file-input" multiple accept="${ACCEPTED.join(',')}" style="display:none" />
    </div>
    <div class="file-chip-grid" id="file-grid"></div>
  `;

  const dropzone = container.querySelector('#dropzone') as HTMLElement;
  const input = container.querySelector('#file-input') as HTMLInputElement;
  const grid = container.querySelector('#file-grid') as HTMLElement;

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('dragover', (e) => e.preventDefault());
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) handleFiles(input.files);
  });

  async function handleFiles(files: FileList) {
    for (const file of Array.from(files)) {
      if (!ACCEPTED.includes(file.type)) {
        alert(`${file.name}: unsupported file type. Only images and PDFs are allowed.`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        alert(`${file.name}: file exceeds the 25MB limit.`);
        continue;
      }
      await uploadOne(file);
    }
    await refresh();
  }

  async function uploadOne(file: File) {
    const path = `work_orders/${workOrderId}/${Date.now()}-${sanitize(file.name)}`;
    const { error: uploadError } = await supabase.storage.from('attachments').upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });
    if (uploadError) {
      alert(`Upload failed for ${file.name}: ${uploadError.message}`);
      return;
    }
    await supabase.from('attachments').insert({
      work_order_id: workOrderId,
      storage_path: path,
      file_name: file.name,
      file_type: file.type === 'application/pdf' ? 'pdf' : 'image',
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: uploadedBy
    } as Partial<Attachment>);
  }

  async function refresh() {
    const { data } = await supabase
      .from('attachments')
      .select('*')
      .eq('work_order_id', workOrderId)
      .order('created_at', { ascending: false });

    grid.innerHTML = '';
    for (const att of data ?? []) {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      if (att.file_type === 'image') {
        const { data: signed } = await supabase.storage.from('attachments').createSignedUrl(att.storage_path, 3600);
        chip.innerHTML = `<img src="${signed?.signedUrl ?? ''}" alt="${att.file_name}" /><div class="name">${att.file_name}</div>`;
      } else {
        chip.innerHTML = `<div class="pdf-icon">PDF</div><div class="name">${att.file_name}</div>`;
      }
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', async () => {
        const { data: signed } = await supabase.storage.from('attachments').createSignedUrl(att.storage_path, 3600);
        if (signed?.signedUrl) window.open(signed.signedUrl, '_blank');
      });
      grid.appendChild(chip);
    }
  }

  await refresh();
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}
