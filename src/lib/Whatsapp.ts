import { supabase } from '@/lib/supabase';

export interface SendMessageTarget {
  conversationId?: string;
  customerId?: string;
  technicianId?: string;
  phone?: string;
  text: string;
}

export interface SendMessageResult {
  conversationId: string;
  waMessageId: string | null;
}

/**
 * Sends an outbound WhatsApp text message via the `send-whatsapp-message`
 * edge function. If `conversationId` isn't given, the function looks up (or
 * creates) a conversation for the given customer/technician/phone — so this
 * works both for replying in the Chat page and for starting a brand-new
 * conversation from the Customers or Technicians pages.
 */
export async function sendWhatsappMessage(target: SendMessageTarget): Promise<SendMessageResult> {
  const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
    body: {
      conversation_id: target.conversationId,
      customer_id: target.customerId,
      technician_id: target.technicianId,
      phone: target.phone,
      text: target.text
    }
  });
  if (error) throw new Error(await extractError(error));
  return { conversationId: data.conversation_id, waMessageId: data.wa_message_id ?? null };
}

async function extractError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    return body?.error?.message || body?.error || error.message || 'Request failed';
  } catch {
    return error?.message ?? 'Request failed';
  }
}