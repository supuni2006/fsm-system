import { sendDocumentViaEmail } from '@/lib/documents';

interface Options {
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  storagePath: string;
  filename: string;
  defaultCaption: string;
  source: 'service_report' | 'invoice' | 'estimate';
  sourceId: string;
  onSent?: () => void;
}

export function openSendEmailModal(opts: Options) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-head"><h2>Send via Email</h2><button class="modal-close" id="close">✕</button></div>
      <div id="err" class="form-error" style="display:none"></div>
      ${
        opts.customerEmail
          ? `
        <p style="font-size:13.5px;color:var(--ink-soft)">
          Send <strong>${opts.filename}</strong> to <strong>${opts.customerName}</strong> at ${opts.customerEmail}.
        </p>
        <div class="field"><label>Message</label><textarea id="caption" rows="3">${opts.defaultCaption}</textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          <button type="button" class="btn btn-amber" id="send">Send</button>
        </div>`
          : `<div class="form-error" style="display:block">This customer has no email on file. Add one on their customer record first.</div>
             <div class="form-actions"><button type="button" class="btn btn-ghost" id="cancel">Close</button></div>`
      }
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#close')!.addEventListener('click', close);
  backdrop.querySelector('#cancel')!.addEventListener('click', close);

  const sendBtn = backdrop.querySelector('#send') as HTMLButtonElement | null;
  sendBtn?.addEventListener('click', async () => {
    const errBox = backdrop.querySelector('#err') as HTMLElement;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      await sendDocumentViaEmail({
        storage_path: opts.storagePath,
        filename: opts.filename,
        caption: (backdrop.querySelector('#caption') as HTMLTextAreaElement).value,
        customer_id: opts.customerId,
        source: opts.source,
        source_id: opts.sourceId
      });
      close();
      opts.onSent?.();
    } catch (err: any) {
      errBox.textContent = err.message ?? 'Failed to send.';
      errBox.style.display = 'block';
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  });
}