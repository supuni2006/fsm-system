// Hand-authored types mirroring supabase/migrations/0001_init_schema.sql.
// Once the project is linked, replace this file with the CLI-generated version:
//   npx supabase gen types typescript --project-id YOUR_REF > src/types/database.types.ts

export type UserRole = 'admin' | 'technician' | 'customer';
export type WorkOrderStatus =
  | 'unassigned' | 'assigned' | 'accepted' | 'scheduled' | 'en_route' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'void';
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type ReminderChannel = 'whatsapp' | 'email' | 'sms' | 'in_app';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  skills: string[] | null;
  home_base_lat: number | null;
  home_base_lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  profile_id: string | null;
  company_name: string | null;
  contact_name: string;
  email: string | null;
  phone: string;
  billing_address: string | null;
  service_address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  customer_id: string;
  name: string;
  category: string | null;
  serial_number: string | null;
  model: string | null;
  install_date: string | null;
  location: string | null;
  warranty_expiry: string | null;
  notes: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_cost: number;
  unit_price: number;
  quantity_on_hand: number;
  reorder_level: number;
  warehouse_location: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  wo_number: string;
  customer_id: string;
  asset_id: string | null;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  assigned_technician_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  assigned_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  service_address: string | null;
  service_lat: number | null;
  service_lng: number | null;
  signature_url: string | null;
  start_email_token: string | null;
  start_email_token_expires_at: string | null;
  start_email_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderNote {
  id: string;
  work_order_id: string;
  author_id: string | null;
  note: string;
  created_at: string;
}

export interface WorkOrderPart {
  id: string;
  work_order_id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
}

export interface Attachment {
  id: string;
  work_order_id: string | null;
  customer_id: string | null;
  storage_path: string;
  file_name: string;
  file_type: 'image' | 'pdf' | string;
  mime_type: string;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export type DocType = 'estimate' | 'invoice';

export interface Invoice {
  id: string;
  invoice_number: string;
  doc_type: DocType;
  work_order_id: string | null;
  customer_id: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  amount_paid: number;
  due_date: string | null;
  notes: string | null;
  pdf_storage_path: string | null;
  converted_from_estimate_id: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceReport {
  id: string;
  report_number: string;
  work_order_id: string;
  summary: string | null;
  work_performed: string | null;
  recommendations: string | null;
  pdf_storage_path: string | null;
  generated_by: string | null;
  generated_at: string | null;
  sent_at: string | null;
  sent_to_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface WhatsappConversation {
  id: string;
  customer_id: string | null;
  technician_id: string | null;
  wa_phone_number: string;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface WhatsappMessage {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  wa_message_id: string | null;
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  status: MessageStatus;
  sent_by: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  work_order_id: string | null;
  invoice_id: string | null;
  customer_id: string | null;
  recipient_profile_id: string | null;
  channel: ReminderChannel;
  message: string;
  remind_at: string;
  status: ReminderStatus;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

// Minimal Database generic so supabase-js typed queries compile.
// Extend per-table `Row`/`Insert`/`Update` shapes as needed.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: Partial<Profile> };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer> };
      assets: { Row: Asset; Insert: Partial<Asset>; Update: Partial<Asset> };
      inventory_items: { Row: InventoryItem; Insert: Partial<InventoryItem>; Update: Partial<InventoryItem> };
      work_orders: { Row: WorkOrder; Insert: Partial<WorkOrder>; Update: Partial<WorkOrder> };
      work_order_notes: { Row: WorkOrderNote; Insert: Partial<WorkOrderNote>; Update: Partial<WorkOrderNote> };
      work_order_parts: { Row: WorkOrderPart; Insert: Partial<WorkOrderPart>; Update: Partial<WorkOrderPart> };
      attachments: { Row: Attachment; Insert: Partial<Attachment>; Update: Partial<Attachment> };
      invoices: { Row: Invoice; Insert: Partial<Invoice>; Update: Partial<Invoice> };
      invoice_line_items: { Row: InvoiceLineItem; Insert: Partial<InvoiceLineItem>; Update: Partial<InvoiceLineItem> };
      service_reports: { Row: ServiceReport; Insert: Partial<ServiceReport>; Update: Partial<ServiceReport> };
      whatsapp_conversations: { Row: WhatsappConversation; Insert: Partial<WhatsappConversation>; Update: Partial<WhatsappConversation> };
      whatsapp_messages: { Row: WhatsappMessage; Insert: Partial<WhatsappMessage>; Update: Partial<WhatsappMessage> };
      reminders: { Row: Reminder; Insert: Partial<Reminder>; Update: Partial<Reminder> };
    };
  };
}