import { route, startRouter, navigate } from '@/router';
import { getCurrentProfile } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
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

/**
 * Renders a setup screen instead of leaving #app blank when the required
 * Supabase env vars haven't been configured yet. Without this check the
 * app used to fail silently: createClient() would throw during module
 * import, main.ts would never finish running, and the router would never
 * mount anything into #app — so the browser just showed a blank page with
 * no clue why.
 */
function renderConfigMissing() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><div class="mark">F</div><span>FieldFlow</span></div>
        <h1>Supabase isn't configured yet</h1>
        <p class="auth-sub">
          FieldFlow can't start because <code>VITE_SUPABASE_URL</code> and
          <code>VITE_SUPABASE_ANON_KEY</code> are missing.
        </p>
        <div class="form-error" style="display:block">
          Copy <code>.env.example</code> to <code>.env</code> in the project root, fill in your
          Supabase project URL and anon key (Project Settings → API in the Supabase
          dashboard), then restart the dev server with <code>npm run dev</code>.
        </div>
      </div>
    </div>
  `;
}

function bootstrap() {
  if (!isSupabaseConfigured) {
    renderConfigMissing();
    return;
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
}

bootstrap();