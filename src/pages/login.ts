import { signIn } from '@/lib/auth';
import { navigate } from '@/router';

export function renderLogin() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><div class="mark">F</div><span>FieldFlow</span></div>
        <h1>Welcome back</h1>
        <p class="auth-sub">Sign in to your dispatch, technician, or customer account.</p>
        <div id="error" class="form-error" style="display:none"></div>
        <form id="login-form">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" required autocomplete="email" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" required autocomplete="current-password" />
          </div>
          <button class="btn btn-amber btn-block" type="submit" id="submit-btn">Sign in</button>
        </form>
        <div class="form-hint">No account yet? <a id="to-register">Create one</a></div>
      </div>
    </div>
  `;

  document.getElementById('to-register')!.addEventListener('click', () => navigate('/register'));

  const form = document.getElementById('login-form') as HTMLFormElement;
  const errorBox = document.getElementById('error')!;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const email = (document.getElementById('email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      errorBox.textContent = err.message ?? 'Could not sign in. Check your credentials.';
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
}
