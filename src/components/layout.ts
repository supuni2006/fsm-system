import type { Profile } from '@/types/database.types';
import { signOut } from '@/lib/auth';
import { navigate } from '@/router';

interface NavItem { path: string; label: string; icon: string; roles: Profile['role'][]; }

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '◧', roles: ['admin', 'technician', 'customer'] },
  { path: '/work-orders', label: 'Work Orders', icon: '🛠', roles: ['admin', 'technician', 'customer'] },
  { path: '/customers', label: 'Customers', icon: '👤', roles: ['admin'] },
  { path: '/technicians', label: 'Technicians', icon: '🧑‍🔧', roles: ['admin'] },
  { path: '/inventory', label: 'Inventory', icon: '📦', roles: ['admin', 'technician'] },
  { path: '/invoices', label: 'Invoices', icon: '🧾', roles: ['admin', 'customer'] },
  { path: '/whatsapp', label: 'WhatsApp Chat', icon: '💬', roles: ['admin', 'technician'] },
  { path: '/reminders', label: 'Reminders', icon: '⏰', roles: ['admin'] },
  { path: '/reports', label: 'Reports', icon: '📊', roles: ['admin'] }
];
export function renderShell(profile: Profile, activePath: string, title: string, subtitle = ''): HTMLElement {
  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';

  const items = NAV.filter((n) => n.roles.includes(profile.role))
    .map(
      (n) => `<a class="nav-link ${activePath === n.path ? 'active' : ''}" data-path="${n.path}">
        <span>${n.icon}</span> ${n.label}
      </a>`
    )
    .join('');

  sidebar.innerHTML = `
    <div class="auth-brand"><div class="mark">F</div><span>FieldFlow</span></div>
    <nav class="nav-group">${items}</nav>
    <div class="sidebar-foot">
      <div class="user-chip">
        <div class="dot">${initials(profile.full_name)}</div>
        <div>
          <div>${profile.full_name}</div>
          <div class="role">${profile.role}</div>
        </div>
      </div>
      <button class="signout-link" id="signout-btn">Sign out</button>
    </div>
  `;

  sidebar.querySelectorAll<HTMLElement>('.nav-link').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.path!));
  });
  sidebar.querySelector('#signout-btn')!.addEventListener('click', async () => {
    await signOut();
    navigate('/login');
  });

  const main = document.createElement('main');
  main.className = 'main';
  main.innerHTML = `
    <div class="topbar">
      <div>
        <h1>${title}</h1>
        ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
      </div>
      <div id="topbar-actions"></div>
    </div>
    <div id="page-content"></div>
  `;

  shell.appendChild(sidebar);
  shell.appendChild(main);
  app.appendChild(shell);

  return main.querySelector('#page-content')!;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${status.replace(/_/g, ' ')}</span>`;
}
