import { el, toast } from './utils.js';
import {
  state, getSession, onAuthChange, loadAll, subscribe, signOut,
  lockSession, restoreSession, currentSession,
} from './store.js';
import { destroyCharts } from './charts.js';
import { openSheet, skeletonScreen } from './ui.js';
import * as lock from './lock.js';
import { purgePlainSession } from './supabase.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAnalysis } from './views/analysis.js';
import { renderHistory } from './views/history.js';
import { renderCategories } from './views/categories.js';
import { renderDebts } from './views/debts.js';
import { renderAuth, accountSheetContent } from './views/auth.js';
import { renderLockScreen, openLockSetupSheet, lockSettings } from './views/lock.js';
import { openExpenseSheet, openIncomeSheet } from './views/add-movement.js';

const root = document.getElementById('app');

// Tras 5 minutos en segundo plano se vuelve a pedir el PIN
const AUTO_LOCK_MS = 5 * 60 * 1000;
const ASKED_KEY = 'finanzas.lock.asked';

/* ----------------------------------------------------------------- rutas --- */

const ROUTES = {
  '/': { title: 'Hoy', render: renderDashboard },
  '/deudas': { title: 'Deudas', render: renderDebts },
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
  '/deudas': '<path d="M3 7h18v11H3zM3 11h18M7 15h3"/>',
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
// El usuario ha pedido entrar con contraseña en vez de con el PIN
let usePasswordLogin = false;

function render() {
  if (!state.user) {
    destroyCharts();
    if (lock.isConfigured() && !usePasswordLogin) {
      root.replaceChildren(renderLockScreen({
        onUnlock: unlock,
        onUsePassword: () => { usePasswordLogin = true; render(); },
      }));
    } else {
      root.replaceChildren(renderAuth());
    }
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
    root.replaceChildren(route.render(), navBar(ROUTES[path] ? path : '/'));
  } finally {
    rendering = false;
  }

  document.title = `${route.title} · Finanzas`;
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
      ${item('/deudas', 'Deudas')}
      ${item('/analisis', 'Análisis')}
      ${item('/historico', 'Histórico')}
      ${item('/categorias', 'Categorías')}
    </nav>
  `);
}

/* --------------------------------------------------------------- bloqueo --- */

/** Restaura la sesión que el PIN o la huella acaban de descifrar. */
async function unlock(tokens) {
  root.replaceChildren(skeletonScreen());
  try {
    await restoreSession(tokens);
    // onAuthChange se encarga de cargar los datos y pintar
  } catch {
    toast('La sesión guardada ha caducado. Entra con tu contraseña.', 'err');
    lock.disable();
    usePasswordLogin = true;
    render();
  }
}

let hiddenAt = null;

function watchAutoLock() {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt || !lock.isConfigured() || !state.user) return;

    const away = Date.now() - hiddenAt;
    hiddenAt = null;
    if (away < AUTO_LOCK_MS) return;

    lock.lockNow();
    await lockSession();
    render();
  });
}

// El arranque y onAuthChange pueden coincidir: sin esta bandera síncrona los
// dos llegarían a abrir el panel y saldría duplicado.
let offeringLock = false;

/** Ofrece configurar el acceso rápido una sola vez tras el primer login. */
async function maybeOfferLock() {
  if (offeringLock || lock.isConfigured() || localStorage.getItem(ASKED_KEY)) return;
  if (!window.crypto?.subtle || !window.isSecureContext) return;

  offeringLock = true;
  const session = await currentSession();
  if (!session) { offeringLock = false; return; }

  localStorage.setItem(ASKED_KEY, '1');
  try {
    await openLockSetupSheet({
      session,
      user: state.user,
      onDone: () => {
        // A partir de aquí la sesión sólo vive cifrada
        purgePlainSession();
        render();
      },
    });
  } finally {
    offeringLock = false;
  }
}

/* ------------------------------------------------------------ panel cuenta --- */

function openAccountSheet() {
  openSheet('Tu cuenta', (close) => {
    const content = accountSheetContent(state.user, async () => {
      close(true);
      lock.disable();
      await signOut();
      history.replaceState(null, '', '#/');
      render();
    });

    currentSession().then((session) => {
      if (!session) return;
      content.prepend(lockSettings({
        session,
        user: state.user,
        onChanged: () => {
          purgePlainSession();
          close(true);
          render();
        },
      }));
    });

    return content;
  });
}
document.addEventListener('open-account', openAccountSheet);

/* ---------------------------------------------------------------- arranque --- */

function handleShortcut() {
  const shortcut = SHORTCUTS[currentPath()];
  if (!shortcut || !state.user || !state.ready) return;

  // Volvemos a la home para que al cerrar el panel quede una pantalla útil
  history.replaceState(null, '', '#/');
  render();
  shortcut();
}

async function hydrate() {
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
}

async function boot() {
  await getSession();
  render();

  if (state.user) {
    await hydrate();
    maybeOfferLock();
  }

  onAuthChange(async (session) => {
    if (!session) { render(); return; }

    // El token rota cada hora: hay que volver a cifrarlo o el PIN se quedaría
    // con uno caducado.
    if (lock.isUnlocked()) lock.persistSession(session).catch(() => {});

    await hydrate();
    maybeOfferLock();
  });

  // Re-render cuando cambian los datos (altas, ediciones, borrados)
  subscribe(() => { if (!rendering) render(); });

  window.addEventListener('hashchange', () => {
    if (SHORTCUTS[currentPath()]) handleShortcut();
    else render();
  });

  watchAutoLock();
}

boot();
