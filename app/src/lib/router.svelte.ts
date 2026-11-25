export type Route =
  | { name: 'dashboard' }
  | { name: 'tracker'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new'; template?: string }
  | { name: 'settings' }
  | { name: 'about' };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [a, b, c] = path.split('/');
  if (a === 't' && b && c === 'edit') return { name: 'edit', id: b };
  if (a === 't' && b) return { name: 'tracker', id: b };
  if (a === 'new') return { name: 'new', template: b };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'about') return { name: 'about' };
  return { name: 'dashboard' };
}

export const router = $state({ route: parse(location.hash) as Route });
window.addEventListener('hashchange', () => {
  router.route = parse(location.hash);
  window.scrollTo(0, 0);
});

/** Paramètres après « ? » dans le hash (#/settings?auth_error=…). */
export function hashParams(): URLSearchParams {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}

export function go(path: string) {
  location.hash = '#/' + path.replace(/^\//, '');
}

export function back() {
  if (history.length > 1) history.back();
  else go('');
}
