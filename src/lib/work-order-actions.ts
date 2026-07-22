import { supabase } from '@/lib/supabase';

/**
 * Guided work-order lifecycle actions: assign -> notify -> accept/decline -> start -> end.
 *
 * These are thin wrappers around `work_orders` updates. Status history is logged
 * automatically by the `trg_wo_status_log` trigger (see 0001_init_schema.sql), so
 * callers don't need to touch `work_order_status_history` directly.
 *
 * RLS (0002_rls_policies.sql): admins can update any work order; a technician can
 * only update a work order currently assigned to them (`wo_technician_update`).
 */

// ---------------- Assign (admin) ----------------

export interface AssignResult {
  whatsappSent: boolean;
  whatsappError?: string;
}

/**
 * Assigns a technician and puts the work order into 'assigned' (awaiting the
 * technician's response). Best-effort notifies the technician over WhatsApp via
 * the `send-work-order-assignment` edge function — a failure there doesn't roll
 * back the assignment, it's just surfaced to the caller so the UI can say so.
 */
export async function assignTechnician(workOrderId: string, technicianId: string): Promise<AssignResult> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      assigned_technician_id: technicianId,
      status: 'assigned',
      assigned_at: new Date().toISOString(),
      accepted_at: null,
      declined_at: null,
      decline_reason: null
    })
    .eq('id', workOrderId);
  if (error) throw new Error(error.message);

  try {
    const { error: fnError } = await supabase.functions.invoke('send-work-order-assignment', {
      body: { work_order_id: workOrderId }
    });
    if (fnError) return { whatsappSent: false, whatsappError: await extractError(fnError) };
    return { whatsappSent: true };
  } catch (err: any) {
    return { whatsappSent: false, whatsappError: err?.message ?? 'Failed to send WhatsApp notification.' };
  }
}

// ---------------- Technician guided actions ----------------

/** Technician confirms they'll take the job. 'assigned' -> 'accepted'. */
export async function acceptWorkOrder(workOrderId: string): Promise<void> {
  const { error } = await supabase
    .from('work_orders')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', workOrderId);
  if (error) throw new Error(error.message);
}

/**
 * Technician turns down the job. Sends it back to the unassigned pool so an
 * admin can hand it to someone else, keeping the reason for reference.
 */
export async function declineWorkOrder(workOrderId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      status: 'unassigned',
      assigned_technician_id: null,
      declined_at: new Date().toISOString(),
      decline_reason: reason || null
    })
    .eq('id', workOrderId);
  if (error) throw new Error(error.message);
}

/** Technician is on site and beginning work. 'accepted' -> 'in_progress'. */
export async function startWork(workOrderId: string): Promise<void> {
  const { error } = await supabase
    .from('work_orders')
    .update({ status: 'in_progress', actual_start: new Date().toISOString() })
    .eq('id', workOrderId);
  if (error) throw new Error(error.message);
}

/** Technician wraps up the job. 'in_progress' -> 'completed'. */
export async function endWork(workOrderId: string): Promise<void> {
  const { error } = await supabase
    .from('work_orders')
    .update({ status: 'completed', actual_end: new Date().toISOString() })
    .eq('id', workOrderId);
  if (error) throw new Error(error.message);
}

async function extractError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    return body?.error?.message || body?.error || error.message || 'Request failed';
  } catch {
    return error?.message ?? 'Request failed';
  }
}