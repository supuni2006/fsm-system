import { signUp } from '@/lib/auth';
import { navigate } from '@/router';
import type { UserRole } from '@/types/database.types';

export function renderRegister() {
  const app = document.getElementById('app')!;
  let selectedRole: UserRole = 'customer';

  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><div class="mark">F</div><span>FieldFlow</span></div>
        <h1>Create your account</h1>
        <p class="auth-sub">Choose the role that matches how you'll use FieldFlow.</p>
        <div id="error" class="form-error" style="display:none"></div>

        <div class="role-toggle" id="role-toggle">
          <button type="button" data-role="admin">Admin</button>
          <button type="button" data-role="technician">Technician</button>
          <button type="button" data-role="customer" class="active">Customer</button>
        </div>

        <form id="register-form">
          <div class="field"><label for="full_name">Full name</label><input id="full_name" required /></div>
          <div class="field"><label for="phone">Phone (for WhatsApp updates)</label><input id="phone" placeholder="+94771234567" required /></div>
          <div class="field"><label for="email">Email</label><input id="email" type="email" required /></div>
          <div class="field"><label for="password">Password</label><input id="password" type="password" minlength="6" required /></div>
          <button class="btn btn-amber btn-block" type="submit" id="submit-btn">Create account</button>
        </form>
        <div class="form-hint">Already have an account? <a id="to-login">Sign in</a></div>
      </div>
    </div>
  `;

  document.getElementById('to-login')!.addEventListener('click', () => navigate('/login'));

  const toggle = document.getElementById('role-toggle')!;
  toggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRole = btn.dataset.role as UserRole;
    });
  });

  const form = document.getElementById('register-form') as HTMLFormElement;
  const errorBox = document.getElementById('error')!;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      await signUp({
        email: (document.getElementById('email') as HTMLInputElement).value.trim(),
        password: (document.getElementById('password') as HTMLInputElement).value,
        fullName: (document.getElementById('full_name') as HTMLInputElement).value.trim(),
        phone: (document.getElementById('phone') as HTMLInputElement).value.trim(),
        role: selectedRole
      });
      navigate('/dashboard');
    } catch (err: any) {
      errorBox.textContent = err.message ?? 'Could not create account.';
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });
}
