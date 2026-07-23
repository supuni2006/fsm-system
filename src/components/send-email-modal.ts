import { sendEmail } from "@/lib/email";

interface Options {
  customerName: string;
  customerEmail: string | null;
  filename: string;
  subject: string;
  html?: string;
  attachment?: {
    filename: string;
    content: string; // Base64
  };
  onSent?: () => void;
}

export function openSendEmailModal(opts: Options) {
  const backdrop = document.createElement("div");

  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="max-width:500px">
      <div class="modal-head">
        <h2>Send Email</h2>
        <button class="modal-close" id="close">✕</button>
      </div>

      <div id="err" class="form-error" style="display:none"></div>

      ${
        opts.customerEmail
          ? `
        <p style="font-size:13.5px;color:var(--ink-soft)">
          Send <strong>${opts.filename}</strong> to
          <strong>${opts.customerName}</strong>
          (${opts.customerEmail})
        </p>

        <div class="field">
          <label>Subject</label>
          <input id="subject" value="${opts.subject}">
        </div>

        <div class="field">
          <label>Message</label>
          <textarea id="message" rows="6">${
            opts.html ??
            `<p>Please find your document attached.</p>`
          }</textarea>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="cancel">Cancel</button>
          <button class="btn btn-primary" id="send">Send Email</button>
        </div>
      `
          : `
        <div class="form-error" style="display:block">
          This customer has no email address on file.
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="cancel">Close</button>
        </div>
      `
      }
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.querySelector("#close")?.addEventListener("click", close);
  backdrop.querySelector("#cancel")?.addEventListener("click", close);

  const sendBtn = backdrop.querySelector("#send") as HTMLButtonElement | null;

  sendBtn?.addEventListener("click", async () => {
    const errBox = backdrop.querySelector("#err") as HTMLElement;

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    try {
      await sendEmail({
        to: opts.customerEmail!,
        subject: (
          backdrop.querySelector("#subject") as HTMLInputElement
        ).value,
        html: (
          backdrop.querySelector("#message") as HTMLTextAreaElement
        ).value,
        attachments: opts.attachment ? [opts.attachment] : undefined,
      });

      close();
      opts.onSent?.();
    } catch (err: any) {
      errBox.style.display = "block";
      errBox.textContent = err.message ?? "Failed to send email.";

      sendBtn.disabled = false;
      sendBtn.textContent = "Send Email";
    }
  });
}