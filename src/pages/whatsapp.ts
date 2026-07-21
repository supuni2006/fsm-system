import { supabase } from '@/lib/supabase';
import { renderShell } from '@/components/layout';
import type { Profile } from '@/types/database.types';

export async function renderWhatsapp(profile: Profile) {
  const content = renderShell(profile, '/whatsapp', 'WhatsApp Chat', 'Conversations synced live from WhatsApp Business.');
  content.innerHTML = `
    <div class="chat-layout">
      <div class="chat-list" id="chat-list"></div>
      <div class="chat-pane" id="chat-pane">
        <div class="empty-state" style="margin:auto">Select a conversation to view messages.</div>
      </div>
    </div>
  `;

  let activeConvId: string | null = null;

  async function loadConversations() {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('*, customers(contact_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    const list = document.getElementById('chat-list')!;
    if (!data?.length) {
      list.innerHTML = `<div class="empty-state">No conversations yet. They'll appear here once a customer messages your WhatsApp number.</div>`;
      return;
    }
    list.innerHTML = data
      .map(
        (c: any) => `<div class="chat-list-item ${c.id === activeConvId ? 'active' : ''}" data-id="${c.id}">
          <div class="name">${c.customers?.contact_name ?? c.wa_phone_number}</div>
          <div class="preview">${c.wa_phone_number}${c.unread_count ? ` · ${c.unread_count} new` : ''}</div>
        </div>`
      )
      .join('');
    list.querySelectorAll<HTMLElement>('.chat-list-item').forEach((el) => {
      el.addEventListener('click', () => openConversation(el.dataset.id!));
    });
  }

  async function openConversation(convId: string) {
    activeConvId = convId;
    await loadConversations();

    const { data: conv } = await supabase.from('whatsapp_conversations').select('*, customers(contact_name)').eq('id', convId).single();
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    const pane = document.getElementById('chat-pane')!;
    pane.innerHTML = `
      <div class="chat-head">${conv?.customers?.contact_name ?? conv?.wa_phone_number}</div>
      <div class="chat-messages" id="messages">
        ${(messages ?? [])
          .map(
            (m: any) => `<div class="bubble ${m.direction}">
              ${m.body ?? ''}
              ${m.media_url ? `<div style="margin-top:6px"><a href="${m.media_url}" target="_blank" style="color:inherit">📎 Attachment</a></div>` : ''}
              <div class="meta">${new Date(m.created_at).toLocaleTimeString()}</div>
            </div>`
          )
          .join('') || '<div class="empty-state" style="margin:auto">No messages yet.</div>'}
      </div>
      <div class="chat-input">
        <input id="msg-input" placeholder="Type a message…" />
        <button class="btn btn-amber" id="send-btn">Send</button>
      </div>
    `;
    const messagesEl = document.getElementById('messages')!;
    messagesEl.scrollTop = messagesEl.scrollHeight;

    document.getElementById('send-btn')!.addEventListener('click', () => sendMessage(convId));
    document.getElementById('msg-input')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') sendMessage(convId);
    });
  }

  async function sendMessage(convId: string) {
    const input = document.getElementById('msg-input') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    // Calls the send-whatsapp-message Edge Function, which talks to the
    // WhatsApp Business Cloud API using the server-side access token.
    const { data: sessionData } = await supabase.auth.getSession();
    const { data: userData } = await supabase.auth.getUser();

    await supabase.from('whatsapp_messages').insert({
      conversation_id: convId,
      direction: 'outbound',
      body: text,
      status: 'queued',
      sent_by: userData.user?.id
    });

    try {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token}`
        },
        body: JSON.stringify({ conversation_id: convId, text })
      });
    } catch (err) {
      console.error('Failed to send WhatsApp message', err);
    }

    await openConversation(convId);
  }

  // Live updates via Supabase Realtime
  supabase
    .channel('whatsapp-messages-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, () => {
      if (activeConvId) openConversation(activeConvId);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, () => loadConversations())
    .subscribe();

  await loadConversations();
}
