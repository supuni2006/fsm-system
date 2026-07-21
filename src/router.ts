type RouteHandler = (params: Record<string, string>) => void | Promise<void>;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .replace(/\//g, '\\/')
    .replace(/:([A-Za-z0-9_]+)/g, (_m, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { pattern: new RegExp(`^${pattern}$`), keys };
}

export function route(path: string, handler: RouteHandler) {
  const { pattern, keys } = compile(path);
  routes.push({ pattern, keys, handler });
}

export function navigate(path: string) {
  window.location.hash = `#${path}`;
}

async function resolve() {
  const hash = window.location.hash.replace(/^#/, '') || '/login';
  const path = hash.split('?')[0];

  for (const r of routes) {
    const match = path.match(r.pattern);
    if (match) {
      const params: Record<string, string> = {};
      r.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
      await r.handler(params);
      return;
    }
  }
  // fallback
  navigate('/login');
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
