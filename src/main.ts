import { route, startRouter, navigate } from '@/router';
import { getCurrentProfile } from '@/lib/auth';
import { renderLogin } from '@/pages/login';
import { renderRegister } from '@/pages/register';
import { renderDashboard } from '@/pages/dashboard';
import { renderWorkOrdersList, renderWorkOrderDetail } from '@/pages/work-orders';
import { renderCustomers } from '@/pages/customers';
import { renderInventory } from '@/pages/inventory';
import { renderInvoices } from '@/pages/invoices';
import { renderReports } from '@/pages/reports';
import { renderWhatsapp } from '@/pages/whatsapp';
import { renderReminders } from '@/pages/reminders';

function guarded(fn: (profile: any, params: Record<string, string>) => void) {
  return async (params: Record<string, string>) => {
    const profile = await getCurrentProfile();
    if (!profile) {
      navigate('/login');
      return;
    }
    fn(profile, params);
  };
}

route('/login', renderLogin);
route('/register', renderRegister);
route('/dashboard', guarded((p) => renderDashboard(p)));
route('/work-orders', guarded((p) => renderWorkOrdersList(p)));
route('/work-orders/:id', guarded((p, params) => renderWorkOrderDetail(p, params.id)));
route('/customers', guarded((p) => renderCustomers(p)));
route('/inventory', guarded((p) => renderInventory(p)));
route('/invoices', guarded((p) => renderInvoices(p)));
route('/whatsapp', guarded((p) => renderWhatsapp(p)));
route('/reminders', guarded((p) => renderReminders(p)));
route('/reports', guarded((p) => renderReports(p)));

startRouter();
