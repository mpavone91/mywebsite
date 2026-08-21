import { el, toast } from './utils.js';
import {
  state, getSession, onAuthChange, loadAll, subscribe, signOut,
  lockSession, restoreSession, currentSession, describeLoadError,
  loadWorkspaces, isBusiness, loadPartnerBalances,
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
import { renderAccounts } from './views/accounts.js';
import { renderPlan } from './views/plan.js';
import { renderClosings } from './views/closings.js';
import { renderPartners } from './views/partners.js';
import { renderExpenses } from './views/expenses.js';
import { openWorkspaceSheet } from './views/workspaces.js';
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
  '/plan': { title: 'Plan', render: renderPlan },
  '/cierres': { title: 'Cierres', render: renderClosings },
  '/socios': { title: 'Socios', render: renderPartners },
  '/gastos-negocio': { title: 'Gastos', render: renderExpenses },
  '/cuentas': { title: 'Cuentas', render: renderAccounts },
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
  '/plan': '<path d="M4 4h16v16H4zM8 3v3M16 3v3M4 10h16M8 14h3M8 17h6"/>',
  '/cierres': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  '/socios': '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M17 11a3 3 0 1 0-1-5.8M21 20v-1a5 5 0 0 0-3-4.6"/>',
  '/gastos-negocio': '<path d="M3 6h18v12H3zM3 10h18M7 14h4M17 14h.01"/>',
  '/cuentas': '<path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/>',
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
// Último fallo de carga, para poder ofrecer un reintento en vez de una pantalla muerta
let loadError = null;

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
    root.replaceChildren(loadError ? loadErrorScreen() : skeletonScreen(), navBar('/'));
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

/** Pantalla de "no se pudo cargar", con reintento a mano. */
function loadErrorScreen() {
  const screen = el(`
    <div class="screen">
      <div class="screen-head"><div><h1>Vaya</h1><p>No se han podido cargar tus datos</p></div></div>
      <div class="card insight is-alert">
        <div class="icon">⚠️</div>
        <div>
          <h3>Algo ha fallado al conectar</h3>
          <p data-msg></p>
          <div class="action">
            <button class="btn btn-primary" data-retry>Reintentar</button>
          </div>
        </div>
      </div>
      <button class="btn btn-ghost btn-block" data-signout style="margin-top:12px">Cerrar sesión</button>
    </div>
  `);

  screen.querySelector('[data-msg]').textContent = describeLoadError(loadError);

  const retry = screen.querySelector('[data-retry]');
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    retry.innerHTML = '<span class="spinner"></span>';
    loadError = null;
    render();
    await hydrate();
  });

  screen.querySelector('[data-signout]').addEventListener('click', async () => {
    lock.disable();
    await signOut();
    loadError = null;
    history.replaceState(null, '', '#/');
    render();
  });

  return screen;
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
      ${isBusiness() ? item('/cierres', 'Cierres') : item('/plan', 'Plan')}
      ${isBusiness() ? item('/gastos-negocio', 'Gastos') : item('/cuentas', 'Cuentas')}
      ${isBusiness() ? item('/socios', 'Socios') : item('/deudas', 'Deudas')}
      ${item('/analisis', 'Análisis')}
      ${item('/historico', 'Histórico')}
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

    // Categorías salió de la barra al entrar Cuentas: se gestionan de aquí,
    // que es donde uno va cuando quiere configurar algo.
    const toWorkspaces = el('<button class="btn btn-block" data-workspaces>Cambiar de espacio</button>');
    toWorkspaces.addEventListener('click', () => {
      close(true);
      openWorkspaceSheet({ onSwitch: reloadWorkspace });
    });
    content.prepend(toWorkspaces);

    // En un espacio de empresa la barra lleva Cierres, Gastos y Socios; Plan,
    // Deudas y Cuentas se alcanzan desde aquí: siguen estando, cambian de sitio.
    if (isBusiness()) {
      const toAccounts = el('<button class="btn btn-block" data-accounts>Cuentas del negocio</button>');
      toAccounts.addEventListener('click', () => { close(true); location.hash = '/cuentas'; });
      content.prepend(toAccounts);

      const toDebts = el('<button class="btn btn-block" data-debts>Deudas del negocio</button>');
      toDebts.addEventListener('click', () => { close(true); location.hash = '/deudas'; });
      content.prepend(toDebts);

      const toPlan = el('<button class="btn btn-block" data-plan>Plan de gastos fijos</button>');
      toPlan.addEventListener('click', () => { close(true); location.hash = '/plan'; });
      content.prepend(toPlan);
    }

    const toCategories = el('<button class="btn btn-block" data-categories>Gestionar categorías</button>');
    toCategories.addEventListener('click', () => {
      close(true);
      location.hash = '/categorias';
    });
    content.prepend(toCategories);

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
document.addEventListener('switch-workspace', () => { reloadWorkspace(); });

/* ---------------------------------------------------------------- arranque --- */

function handleShortcut() {
  const shortcut = SHORTCUTS[currentPath()];
  if (!shortcut || !state.user || !state.ready) return;

  // Volvemos a la home para que al cerrar el panel quede una pantalla útil
  history.replaceState(null, '', '#/');
  render();
  shortcut();
}

// Sin este cerrojo, dos eventos de sesión solapados lanzarían dos cargas a la
// vez; y como la carga renueva el token cuando el servidor lo rechaza, eso
// realimentaba el propio evento y acababa en un bucle de repintados.
let hydrating = false;

/** Cambiar de espacio recarga la contabilidad entera y vuelve a la home. */
async function reloadWorkspace() {
  history.replaceState(null, '', '#/');
  render();
  await hydrate();
}

async function hydrate() {
  if (hydrating) return;
  hydrating = true;
  try {
    if (!state.ready) {
      loadError = null;
      render();
      try {
        // Los espacios primero: sin espacio activo no se sabe qué cargar
        if (!state.workspaceId) await loadWorkspaces();
        await loadAll();
        // El saldo de los socios cruza espacios: en Personal hace falta para
        // poder decir cuánto le debes al negocio. No bloquea la carga.
        loadPartnerBalances().then(() => { if (!rendering) render(); });
      } catch (err) {
        loadError = err;
        toast(describeLoadError(err), 'err');
      }
    }
    render();
    handleShortcut();
  } finally {
    hydrating = false;
  }
}

async function boot() {
  await getSession();
  render();

  if (state.user) {
    await hydrate();
    maybeOfferLock();
  }

  onAuthChange(async (session, event) => {
    if (!session) { render(); return; }

    // El token rota cada hora: hay que volver a cifrarlo o el PIN se quedaría
    // con uno caducado.
    if (lock.isUnlocked()) lock.persistSession(session).catch(() => {});

    // Una rotación de token no es un login: los datos ya están cargados y
    // volver a pedirlos aquí es lo que realimentaba el bucle.
    if (event === 'TOKEN_REFRESHED') return;

    // Si la última carga falló, el usuario decide cuándo reintentar desde la
    // pantalla de error, en vez de que la app lo intente sola sin parar.
    if (loadError) return;

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
