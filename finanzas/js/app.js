import { el, toast } from './utils.js';
import { state, getSession, onAuthChange, loadAll, subscribe, signOut } from './store.js';
import { destroyCharts } from './charts.js';
import { openSheet, skeletonScreen } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAnalysis } from './views/analysis.js';
import { renderHistory } from './views/history.js';
import { renderCategories } from './views/categories.js';
import { renderAuth, accountSheetContent } from './views/auth.js';
import { openExpenseSheet, openIncomeSheet } from './views/add-movement.js';

const root = document.getElementById('app');

/* ----------------------------------------------------------------- rutas --- */

const ROUTES = {
  '/': { title: 'Hoy', render: renderDashboard },
  '/analisis': { title: 'Análisis', render: renderAnalysis },
  '/historico': { title: 'Histórico', render: renderHistory },
  '/categorias': { title: 'Categorías', render: renderCategories },
};

// Atajos directos: permiten crear un acceso en la pantalla de inicio del móvil
// que abra la app ya con el formulario de gasto encima.
const SHORTCUTS = {
  '/gasto': openExpenseSheet,
  '/ingreso': openIncomeSheet,
};

const ICONS = {
  '/': '<path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5"/>',
  '/analisis': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  '/historico': '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2"/>',
  '/categorias': '<path d="M4 6h16M4 12h16M4 18h10M2.5 6h.01M2.5 12h.01M2.5 18h.01"/>',
};

function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/* -------------------------------------------------------------- renderizado --- */

let rendering = false;

function render() {
  if (!state.user) {
    destroyCharts();
    root.replaceChildren(renderAuth());
    return;
  }

  if (!state.ready) {
    root.replaceChildren(skeletonScreen(), navBar('/'));
    return;
  }

  const path = currentPath();
  const route = ROUTES[path] || ROUTES['/'];

  // Chart.js mantiene instancias vivas ligadas a canvas que vamos a tirar
  destroyCharts();

  rendering = true;
  try {
    root.replaceChildren(appHeaderless(route.render()), navBar(ROUTES[path] ? path : '/'));
  } finally {
    rendering = false;
  }

  document.title = `${route.title} · Finanzas`;
}

// Envuelve la pantalla (punto único por si más adelante añadimos cabecera global)
function appHeaderless(node) {
  return node;
}

function navBar(active) {
  const item = (path, label) => `
    <a href="#${path}" class="${path === active ? 'active' : ''}" ${path === active ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round">${ICONS[path]}</svg>
      <span>${label}</span>
    </a>`;

  return el(`
    <nav class="nav">
      ${item('/', 'Hoy')}
      ${item('/analisis', 'Análisis')}
      ${item('/historico', 'Histórico')}
      ${item('/categorias', 'Categorías')}
    </nav>
  `);
}

/** Panel de cuenta (se abre desde el botón del header del dashboard). */
function openAccountSheet() {
  openSheet('Tu cuenta', (close) => accountSheetContent(state.user, async () => {
    close(true);
    await signOut();
    history.replaceState(null, '', '#/');
    render();
  }));
}
document.addEventListener('open-account', openAccountSheet);

/* ---------------------------------------------------------------- arranque --- */

async function handleShortcut() {
  const path = currentPath();
  const shortcut = SHORTCUTS[path];
  if (!shortcut || !state.user || !state.ready) return;

  // Volvemos a la home para que al cerrar el panel quede una pantalla útil
  history.replaceState(null, '', '#/');
  render();
  shortcut();
}

async function boot() {
  await getSession();
  render();

  if (state.user) {
    try {
      await loadAll();
    } catch (err) {
      toast(err.message || 'No se pudieron cargar los datos', 'err');
    }
    render();
    handleShortcut();
  }

  onAuthChange(async (session) => {
    if (session) {
      if (!state.ready) {
        render();
        try {
          await loadAll();
        } catch (err) {
          toast(err.message || 'No se pudieron cargar los datos', 'err');
        }
      }
      render();
      handleShortcut();
    } else {
      render();
    }
  });

  // Re-render cuando cambian los datos (altas, ediciones, borrados)
  subscribe(() => { if (!rendering) render(); });

  window.addEventListener('hashchange', () => {
    if (SHORTCUTS[currentPath()]) handleShortcut();
    else render();
  });
}

boot();
