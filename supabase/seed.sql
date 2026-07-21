-- Optional sample data. Run after creating your first admin user via the app's
-- Register screen (role: Admin), since profiles/customers reference auth.users.
-- Replace the UUIDs below with real ids from `select id, email from auth.users;`

-- insert into public.customers (contact_name, company_name, phone, email, service_address)
-- values
--   ('Nadia Perera', 'Perera Cold Storage', '+94771234567', 'nadia@example.com', '12 Galle Rd, Colombo'),
--   ('Ruwan Silva', null, '+94779876543', 'ruwan@example.com', '88 Kandy Rd, Kadawatha');

-- insert into public.inventory_items (sku, name, unit_cost, unit_price, quantity_on_hand, reorder_level)
-- values
--   ('FLT-001', 'HVAC Air Filter 20x25', 4.50, 12.00, 40, 10),
--   ('CMP-014', 'Compressor Relay', 18.00, 45.00, 6, 5);
