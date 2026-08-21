import { supabase } from './supabase.js';
import { monthKey, shiftMonth, monthRange, todayISO, round2, sum } from './utils.js';
import { isPersonal } from './accounts.js';
// Las formas de cobro se declaran una sola vez, en el motor de cierres
import { METHODS, closingTotal } from './closings.js';

/**
 * Estado en memoria de la app.
 *
 * Estrategia: para uso personal el volumen es pequeño (unos cientos de
 * movimientos al año), así que cargamos una ventana de meses completa y
 * calculamos todos los agregados en el cliente. Eso mantiene las reglas del
 * bloque de Análisis en un único sitio (analysis.js) y hace que navegar entre
 * pantallas sea instantáneo. Las vistas SQL (monthly_summary, daily_balance)
 * quedan disponibles para consultas puntuales y para el histórico profundo.
 */

const WINDOW_MONTHS = 13; // mes actual + 12 anteriores: suficiente para todas las reglas

export const state = {
  user: null,
  categories: [],
  expenses: [],
  incomes: [],
  debts: [],
  debtPayments: [],   // se cargan todos: son pocos y hacen falta para el saldo
  accounts: [],
  transfers: [],
  fixedItems: [],
  closings: [],
  partners: [],
  partnerBalances: [],   // saldo de los socios de cada espacio de empresa
  workspaces: [],
  workspaceId: null,   // espacio activo: Personal, Empresa…
  loadedFrom: null,   // fecha ISO más antigua cargada
  ready: false,
};

/* ------------------------------------------------------------ suscripción --- */

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

/* ------------------------------------------------------------------ auth --- */

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user ?? null;
  return data.session;
}

export function onAuthChange(fn) {
  return supabase.auth.onAuthStateChange((event, session) => {
    state.user = session?.user ?? null;
    fn(session, event);
  });
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  // Si el proyecto exige confirmación por email, no hay sesión todavía.
  return Boolean(data.session);
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/** Restaura una sesión descifrada por el bloqueo (PIN o huella). */
export async function restoreSession({ access_token, refresh_token }) {
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  state.user = data.session?.user ?? null;
  return data.session;
}

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

function clearState() {
  state.categories = [];
  state.expenses = [];
  state.incomes = [];
  state.debts = [];
  state.debtPayments = [];
  state.accounts = [];
  state.transfers = [];
  state.fixedItems = [];
  state.closings = [];
  state.partners = [];
  state.partnerBalances = [];
  state.workspaces = [];
  state.workspaceId = null;
  state.loadedFrom = null;
  state.ready = false;
}

export async function signOut() {
  await supabase.auth.signOut();
  clearState();
}

/**
 * Cierre de sesión SÓLO local: se olvida la sesión en este dispositivo pero no
 * se revoca el token en el servidor. Es lo que usa el bloqueo automático, para
 * que el token cifrado siga sirviendo al volver a desbloquear.
 */
export async function lockSession() {
  await supabase.auth.signOut({ scope: 'local' });
  clearState();
}

/* ------------------------------------------------------------- espacios --- */

const ACTIVE_KEY = 'finanzas.workspace';

/**
 * Carga los espacios del usuario y decide cuál es el activo.
 * Se guarda el último usado por dispositivo; si ya no existe (se borró, o es
 * de otra cuenta) se cae al espacio por defecto.
 */
export async function loadWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces').select('*').order('is_default', { ascending: false }).order('created_at');
  if (error) throw error;

  state.workspaces = data;
  if (!data.length) { state.workspaceId = null; return null; }

  let saved = null;
  try { saved = localStorage.getItem(ACTIVE_KEY); } catch { /* almacenamiento bloqueado */ }

  state.workspaceId = data.some((w) => w.id === saved) ? saved : data[0].id;
  return activeWorkspace();
}

export const activeWorkspace = () => state.workspaces.find((w) => w.id === state.workspaceId) || null;
export const isBusiness = () => activeWorkspace()?.kind === 'business';

/** Cambia de espacio. Quien llama se encarga de recargar los datos. */
export function setWorkspace(id) {
  if (!state.workspaces.some((w) => w.id === id)) return false;
  state.workspaceId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* almacenamiento bloqueado */ }
  state.ready = false;
  return true;
}

/** Crea el espacio de empresa con sus categorías y cuentas de cobro. */
export async function createBusinessWorkspace(name) {
  const { data, error } = await supabase.rpc('create_business_workspace', { ws_name: name });
  if (error) throw error;
  await loadWorkspaces();
  return data;
}

export async function renameWorkspace(id, name) {
  const { data, error } = await supabase
    .from('workspaces').update({ name: name.trim() }).eq('id', id).select().single();
  if (error) throw error;
  state.workspaces = state.workspaces.map((w) => (w.id === id ? data : w));
  emit();
  return data;
}

/* ----------------------------------------------------------------- carga --- */

function normalize(row) {
  return { ...row, amount: Number(row.amount) };
}

// Postgres devuelve los numeric como texto; los pasamos a número una sola vez
function normalizeDebt(row) {
  return {
    ...row,
    initial_amount: Number(row.initial_amount),
    annual_rate: Number(row.annual_rate),
    minimum_payment: Number(row.minimum_payment),
  };
}

function normalizeAccount(row) {
  return { ...row, opening_balance: Number(row.opening_balance) };
}

function normalizeClosing(row) {
  const out = { ...row, total: Number(row.total) };
  // Una forma de cobro añadida después llega ausente en los partes viejos
  for (const m of METHODS) out[m.key] = Number(row[m.key]) || 0;
  return out;
}

/** Toda consulta va acotada al espacio activo: las contabilidades no se mezclan. */
function inWorkspace(table) {
  return supabase.from(table).select('*').eq('workspace_id', state.workspaceId);
}

async function fetchRange(table, from, to) {
  let q = inWorkspace(table).gte('date', from).order('date', { ascending: false });
  if (to) q = q.lte('date', to);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(normalize);
}

/**
 * ¿El servidor ha rechazado el token por una cuestión de tiempo?
 *
 * "JWT issued at future" sale cuando el reloj del servicio que valida el token
 * va por detrás del que lo emitió: el token acaba de nacer y para el validador
 * todavía no existe. Se corrige solo en segundos, así que no es motivo para
 * echar a nadie de la app.
 */
function isTokenTimingError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('issued at future')
    || msg.includes('jwt expired')
    || msg.includes('invalid jwt')
    || msg.includes('bad_jwt');
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchEverything() {
  const from = `${shiftMonth(monthKey(), -(WINDOW_MONTHS - 1))}-01`;

  const [cats, expenses, incomes, debts, debtPayments, accounts, transfers, fixedItems,
    closings, partners] = await Promise.all([
    inWorkspace('categories').order('type').order('name'),
    fetchRange('expenses', from),
    fetchRange('incomes', from),
    inWorkspace('debts').order('created_at'),
    // Sin ventana temporal: el saldo pendiente sale de la suma de TODOS los pagos
    inWorkspace('debt_payments').order('date', { ascending: false }),
    inWorkspace('accounts').order('created_at'),
    // Igual que los pagos: el saldo de cada cuenta necesita el histórico entero
    inWorkspace('transfers').order('date', { ascending: false }),
    inWorkspace('fixed_items').order('kind').order('name'),
    inWorkspace('daily_closings').gte('date', from).order('date', { ascending: false }),
    inWorkspace('partners').order('created_at'),
  ]);
  for (const result of [cats, debts, debtPayments, accounts, transfers, fixedItems, closings, partners]) {
    if (result.error) throw result.error;
  }

  return {
    from, cats, expenses, incomes, debts, debtPayments, accounts, transfers, fixedItems,
    closings, partners,
  };
}

export async function loadAll(attempt = 0) {
  let data;
  try {
    data = await fetchEverything();
  } catch (err) {
    // Desfase de relojes en el servidor: pedimos un token nuevo y reintentamos
    if (attempt < 2 && isTokenTimingError(err)) {
      await supabase.auth.refreshSession().catch(() => {});
      await delay(1500 * (attempt + 1));
      return loadAll(attempt + 1);
    }
    throw err;
  }

  state.categories = data.cats.data;
  state.expenses = data.expenses;
  state.incomes = data.incomes;
  state.debts = data.debts.data.map(normalizeDebt);
  state.debtPayments = data.debtPayments.data.map(normalize);
  state.accounts = data.accounts.data.map(normalizeAccount);
  state.transfers = data.transfers.data.map(normalize);
  state.fixedItems = data.fixedItems.data.map(normalize);
  state.closings = data.closings.data.map(normalizeClosing);
  state.partners = data.partners.data;
  state.loadedFrom = data.from;
  state.ready = true;

  // Usuario recién creado sin categorías (p. ej. si el trigger no llegó a correr)
  if (!state.categories.length) {
    const { error } = await supabase.rpc('seed_default_categories');
    if (!error) {
      const again = await supabase.from('categories').select('*').order('type').order('name');
      if (!again.error) state.categories = again.data;
    }
  }

  emit();
  return true;
}

/** Mensaje en cristiano para los fallos de carga. */
export function describeLoadError(err) {
  if (isTokenTimingError(err)) {
    return 'El servidor ha rechazado la sesión por un desfase de reloj. Suele arreglarse solo en unos segundos.';
  }
  const msg = String(err?.message || '');
  if (/failed to fetch|network|offline/i.test(msg)) {
    return 'Sin conexión con el servidor. Comprueba tu internet.';
  }
  return msg || 'No se pudieron cargar los datos.';
}

/**
 * Amplía la ventana cargada hacia atrás (histórico de meses antiguos).
 * No hace nada si el mes pedido ya está en memoria.
 */
export async function ensureMonth(key) {
  const { from } = monthRange(key);
  if (state.loadedFrom && from >= state.loadedFrom) return;

  const to = state.loadedFrom
    ? new Date(new Date(state.loadedFrom).getTime() - 86400000).toISOString().slice(0, 10)
    : null;

  const [expenses, incomes] = await Promise.all([
    fetchRange('expenses', from, to),
    fetchRange('incomes', from, to),
  ]);

  state.expenses = [...state.expenses, ...expenses];
  state.incomes = [...state.incomes, ...incomes];
  state.loadedFrom = from;
  emit();
}

/* ------------------------------------------------------------------ CRUD --- */

/** Todo lo que se crea nace en el espacio activo. */
const stamped = (payload) => ({ ...payload, workspace_id: state.workspaceId });

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1));

export async function addExpense({
  amount, category_id, account_id, note, date, is_recurring, partner_id,
}) {
  const payload = {
    amount: round2(amount),
    category_id: category_id || null,
    account_id: account_id || null,
    note: note?.trim() || null,
    date: date || todayISO(),
    is_recurring: Boolean(is_recurring),
    // Con socio, el gasto es una retirada: mueve el dinero pero no es un gasto
    // del negocio. Lo decide partners.js, no aquí.
    partner_id: partner_id || null,
  };
  const { data, error } = await supabase.from('expenses').insert(stamped(payload)).select().single();
  if (error) throw error;
  state.expenses = [normalize(data), ...state.expenses].sort(byDateDesc);
  emit();
  return data;
}

export async function addIncome({ amount, category_id, account_id, source, date, is_recurring }) {
  const payload = {
    amount: round2(amount),
    category_id: category_id || null,
    account_id: account_id || null,
    source: source?.trim() || null,
    date: date || todayISO(),
    is_recurring: Boolean(is_recurring),
  };
  const { data, error } = await supabase.from('incomes').insert(stamped(payload)).select().single();
  if (error) throw error;
  state.incomes = [normalize(data), ...state.incomes].sort(byDateDesc);
  emit();
  return data;
}

export async function updateMovement(kind, id, patch) {
  const table = kind === 'income' ? 'incomes' : 'expenses';
  if (patch.amount !== undefined) patch.amount = round2(patch.amount);
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  const key = kind === 'income' ? 'incomes' : 'expenses';
  state[key] = state[key].map((r) => (r.id === id ? normalize(data) : r)).sort(byDateDesc);
  emit();
  return data;
}

export async function deleteMovement(kind, id) {
  const table = kind === 'income' ? 'incomes' : 'expenses';
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  const key = kind === 'income' ? 'incomes' : 'expenses';
  state[key] = state[key].filter((r) => r.id !== id);
  emit();
}

export async function addCategory({ name, type, color, bucket }) {
  const { data, error } = await supabase
    .from('categories')
    .insert(stamped({ name: name.trim(), type, color, bucket }))
    .select()
    .single();
  if (error) throw error;
  state.categories = [...state.categories, data].sort(sortCategories);
  emit();
  return data;
}

export async function updateCategory(id, patch) {
  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().single();
  if (error) throw error;
  state.categories = state.categories.map((c) => (c.id === id ? data : c)).sort(sortCategories);
  emit();
  return data;
}

/**
 * Borra una categoría. Si tiene movimientos asociados los deja huérfanos
 * (category_id -> null por la FK), así que preferimos archivarla.
 */
export async function deleteCategory(id) {
  const used = state.expenses.some((e) => e.category_id === id)
    || state.incomes.some((i) => i.category_id === id);

  if (used) {
    return updateCategory(id, { is_archived: true });
  }
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
  state.categories = state.categories.filter((c) => c.id !== id);
  emit();
  return null;
}

/* --------------------------------------------------------- cierres diarios --- */

const takingsCategory = () =>
  state.categories.find((c) => c.type === 'income' && /facturaci/i.test(c.name))
  || categoriesOf('income')[0]
  || null;

const accountByRole = (role) => state.accounts.find((a) => a.role === role) || null;

/**
 * Crea los ingresos de un cierre: uno por forma de cobro con importe, cada uno
 * en su cuenta. Son ingresos normales y corrientes, así que el cierre del mes,
 * el análisis y el histórico los ven sin saber nada de cierres.
 */
async function createClosingIncomes(closing) {
  const category = takingsCategory();
  const rows = METHODS
    .filter((m) => Number(closing[m.key]) > 0)
    .map((m) => ({
      workspace_id: state.workspaceId,
      closing_id: closing.id,
      amount: round2(closing[m.key]),
      category_id: category?.id || null,
      // El rol de la cuenta de cobro coincide con la forma de pago: card/online/cash
      account_id: accountByRole(m.key)?.id || null,
      source: `Cierre ${m.label}`,
      date: closing.date,
      is_recurring: false,
    }));

  if (!rows.length) return [];

  const { data, error } = await supabase.from('incomes').insert(rows).select();
  if (error) throw error;
  return data.map(normalize);
}

export async function addClosing({ date, note, ...amounts }) {
  const payload = { date: date || todayISO(), note: note?.trim() || null };
  for (const m of METHODS) payload[m.key] = round2(amounts[m.key] || 0);

  if (closingTotal(payload) <= 0) {
    throw new Error('El cierre tiene que llevar algún importe');
  }

  const { data, error } = await supabase
    .from('daily_closings').insert(stamped(payload)).select().single();
  if (error) throw error;

  const closing = normalizeClosing(data);
  try {
    const incomes = await createClosingIncomes(closing);
    state.incomes = [...incomes, ...state.incomes].sort(byDateDesc);
  } catch (err) {
    // Sin sus ingresos el cierre miente, así que se deshace entero
    await supabase.from('daily_closings').delete().eq('id', closing.id);
    throw err;
  }

  state.closings = [closing, ...state.closings].sort(byDateDesc);
  emit();
  return closing;
}

/**
 * Edita un cierre. Los ingresos se rehacen en vez de parchearse: son tres como
 * mucho, y así no hay que razonar sobre qué método pasó de tener importe a no
 * tenerlo.
 */
export async function updateClosing(id, patch) {
  const payload = { ...patch };
  for (const m of METHODS) if (payload[m.key] !== undefined) payload[m.key] = round2(payload[m.key] || 0);
  if (payload.note !== undefined) payload.note = payload.note?.trim() || null;

  const { data, error } = await supabase
    .from('daily_closings').update(payload).eq('id', id).select().single();
  if (error) throw error;

  const closing = normalizeClosing(data);

  const { error: delError } = await supabase.from('incomes').delete().eq('closing_id', id);
  if (delError) throw delError;
  state.incomes = state.incomes.filter((i) => i.closing_id !== id);

  const incomes = await createClosingIncomes(closing);
  state.incomes = [...incomes, ...state.incomes].sort(byDateDesc);
  state.closings = state.closings.map((c) => (c.id === id ? closing : c)).sort(byDateDesc);
  emit();
  return closing;
}

/** Borra el cierre; sus ingresos se van con él por la FK en cascada. */
export async function deleteClosing(id) {
  const { error } = await supabase.from('daily_closings').delete().eq('id', id);
  if (error) throw error;
  state.closings = state.closings.filter((c) => c.id !== id);
  state.incomes = state.incomes.filter((i) => i.closing_id !== id);
  emit();
}

export const closingForDate = (date) => state.closings.find((c) => c.date === date) || null;

/* ------------------------------------------------------------------ socios --- */

export async function addPartner({ name, color, is_me, note }) {
  const payload = {
    name: name.trim(),
    color: color || '#6366f1',
    is_me: Boolean(is_me),
    note: note?.trim() || null,
  };
  const { data, error } = await supabase.from('partners').insert(stamped(payload)).select().single();
  if (error) throw error;
  state.partners = [...state.partners, data];
  emit();
  return data;
}

export async function updatePartner(id, patch) {
  const payload = { ...patch };
  if (payload.name !== undefined) payload.name = payload.name.trim();
  const { data, error } = await supabase
    .from('partners').update(payload).eq('id', id).select().single();
  if (error) throw error;
  state.partners = state.partners.map((p) => (p.id === id ? data : p));
  emit();
  return data;
}

/**
 * Un socio con movimientos no se borra: su saldo dejaría de cuadrar y las
 * retiradas se quedarían huérfanas. La FK lo impide en el servidor; aquí se
 * avisa antes, en castellano.
 */
export async function deletePartner(id) {
  const usado = state.expenses.some((e) => e.partner_id === id)
    || state.incomes.some((i) => i.partner_id === id);
  if (usado) throw new Error('Ese socio tiene movimientos: no se puede borrar sin descuadrar su saldo');

  const { error } = await supabase.from('partners').delete().eq('id', id);
  if (error) throw error;
  state.partners = state.partners.filter((p) => p.id !== id);
  emit();
}

/**
 * Retirada: un socio paga algo suyo con dinero del negocio.
 *
 * Es un gasto normal para la cuenta de la que sale —ese dinero ya no está—
 * pero marcado con el socio, así que queda fuera del resultado del mes.
 */
export const addDraw = ({ partner_id, amount, account_id, note, date }) =>
  addExpense({ partner_id, amount, account_id, note, date, category_id: null });

/**
 * Aportación: el socio devuelve dinero al negocio.
 *
 * Entra en la cuenta del negocio como ingreso marcado (no es facturación) y,
 * si el socio es uno mismo, se apunta además el gasto en el espacio personal:
 * ese dinero sí ha salido del bolsillo.
 */
export async function addContribution({
  partner_id, amount, account_id, note, date, personal = null,
}) {
  const partner = state.partners.find((p) => p.id === partner_id);
  const payload = {
    amount: round2(amount),
    account_id: account_id || null,
    partner_id,
    category_id: null,
    source: note?.trim() || `Aportación de ${partner?.name || 'socio'}`,
    date: date || todayISO(),
    is_recurring: false,
  };

  const { data, error } = await supabase.from('incomes').insert(stamped(payload)).select().single();
  if (error) throw error;

  // El espejo en lo personal, si se ha pedido: el mismo dinero visto desde el
  // otro lado. Va con workspace_id explícito porque es de OTRO espacio.
  if (personal?.workspace_id) {
    const { error: mirrorError } = await supabase.from('expenses').insert({
      workspace_id: personal.workspace_id,
      amount: round2(amount),
      account_id: personal.account_id || null,
      category_id: personal.category_id || null,
      // El concepto que escribió ("devolución") no dice nada fuera del negocio:
      // en su espacio personal lo que se entiende es de dónde viene el gasto.
      note: `Aportación al negocio${note?.trim() ? ` · ${note.trim()}` : ''}`,
      date: payload.date,
      is_recurring: false,
      partner_income_id: data.id,
    });
    // Si el espejo falla, la aportación al negocio sigue siendo cierta: no se
    // deshace, se avisa. Deshacerla mentiría sobre el dinero que ya entró.
    if (mirrorError) {
      state.incomes = [normalize(data), ...state.incomes].sort(byDateDesc);
      emit();
      throw new Error('La aportación se guardó, pero no se pudo apuntar el gasto en tu espacio personal');
    }
  }

  state.incomes = [normalize(data), ...state.incomes].sort(byDateDesc);
  emit();
  return normalize(data);
}

/** Deshace una aportación y, con ella, el gasto personal que generó. */
export async function deleteContribution(id) {
  const { error } = await supabase.from('incomes').delete().eq('id', id);
  if (error) throw error;
  state.incomes = state.incomes.filter((i) => i.id !== id);
  state.expenses = state.expenses.filter((e) => e.partner_income_id !== id);
  emit();
}

/**
 * Saldo de los socios de TODOS los espacios, no sólo del activo.
 *
 * Hace falta en lo personal: estando en Personal hay que poder decir cuánto le
 * debes al negocio, y esos movimientos viven en el espacio de empresa.
 */
export async function loadPartnerBalances() {
  const { data, error } = await supabase.from('partner_balances').select('*');
  if (error) {
    // Es información de apoyo: si falla, la app sigue funcionando sin ella
    state.partnerBalances = [];
    return [];
  }
  state.partnerBalances = data.map((r) => ({
    ...r,
    drawn: Number(r.drawn),
    contributed: Number(r.contributed),
    balance: Number(r.balance),
  }));
  return state.partnerBalances;
}

/** Lo que debes tú al negocio, mirado desde tu espacio personal. */
export const myBusinessDebt = () => {
  const mine = state.partnerBalances.filter((r) => r.is_me && r.workspace_id !== state.workspaceId);
  return mine.length
    ? { balance: round2(sum(mine, (r) => r.balance)), rows: mine }
    : null;
};

/* ---------------------------------------------------------------- cuentas --- */

export async function addAccount(payload) {
  const { data, error } = await supabase.from('accounts').insert(stamped(cleanAccount(payload))).select().single();
  if (error) throw error;
  state.accounts = [...state.accounts, normalizeAccount(data)];
  emit();
  return data;
}

export async function updateAccount(id, patch) {
  const { data, error } = await supabase.from('accounts').update(cleanAccount(patch)).eq('id', id).select().single();
  if (error) throw error;
  state.accounts = state.accounts.map((a) => (a.id === id ? normalizeAccount(data) : a));
  emit();
  return data;
}

/**
 * Borra una cuenta si no se ha usado; si tiene movimientos la archiva, para no
 * dejar el histórico sin saber de dónde salió cada euro.
 */
export async function deleteAccount(id) {
  const used = state.expenses.some((e) => e.account_id === id)
    || state.incomes.some((i) => i.account_id === id)
    || state.transfers.some((t) => t.from_account_id === id || t.to_account_id === id);

  if (used) return updateAccount(id, { is_archived: true });

  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) throw error;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  emit();
  return null;
}

function cleanAccount(p) {
  const out = { ...p };
  if (out.name !== undefined) out.name = out.name.trim();
  if (out.opening_balance !== undefined) out.opening_balance = round2(out.opening_balance || 0);
  if (out.note !== undefined) out.note = out.note?.trim() || null;
  return out;
}

/* -------------------------------------------------------------- traspasos --- */

export async function addTransfer({ from_account_id, to_account_id, amount, date, note }) {
  if (from_account_id === to_account_id) throw new Error('Elige dos cuentas distintas');

  const payload = {
    from_account_id,
    to_account_id,
    amount: round2(amount),
    date: date || todayISO(),
    note: note?.trim() || null,
  };
  const { data, error } = await supabase.from('transfers').insert(stamped(payload)).select().single();
  if (error) throw error;
  state.transfers = [normalize(data), ...state.transfers].sort(byDateDesc);
  emit();
  return data;
}

export async function deleteTransfer(id) {
  const { error } = await supabase.from('transfers').delete().eq('id', id);
  if (error) throw error;
  state.transfers = state.transfers.filter((t) => t.id !== id);
  emit();
}

export function accountsList({ includeArchived = false } = {}) {
  return state.accounts.filter((a) => includeArchived || !a.is_archived);
}

export const accountById = (id) => state.accounts.find((a) => a.id === id) || null;

/**
 * Movimientos que sí salen de tu bolsillo. Es lo que se pasa al motor de
 * análisis: el dinero del negocio no puede ensuciar tu tasa de ahorro.
 */
export function personalData() {
  const personal = (row) => isPersonal(row.account_id, state.accounts) && !row.partner_id;
  return {
    categories: state.categories,
    // Las retiradas y aportaciones de los socios mueven dinero pero no son
    // gasto ni ingreso: quedan fuera de los totales y del análisis.
    expenses: state.expenses.filter(personal),
    incomes: state.incomes.filter(personal),
  };
}

/* ------------------------------------------------------------ plan fijo --- */

export async function addFixedItem(payload) {
  const { data, error } = await supabase.from('fixed_items').insert(stamped(cleanFixed(payload))).select().single();
  if (error) throw error;
  state.fixedItems = [...state.fixedItems, normalize(data)].sort(sortFixed);
  emit();
  return data;
}

export async function updateFixedItem(id, patch) {
  const { data, error } = await supabase.from('fixed_items').update(cleanFixed(patch)).eq('id', id).select().single();
  if (error) throw error;
  state.fixedItems = state.fixedItems.map((f) => (f.id === id ? normalize(data) : f)).sort(sortFixed);
  emit();
  return data;
}

export async function deleteFixedItem(id) {
  const { error } = await supabase.from('fixed_items').delete().eq('id', id);
  if (error) throw error;
  state.fixedItems = state.fixedItems.filter((f) => f.id !== id);
  emit();
}

function cleanFixed(p) {
  const out = { ...p };
  if (out.amount !== undefined) out.amount = round2(out.amount);
  if (out.name !== undefined) out.name = out.name.trim();
  if (out.note !== undefined) out.note = out.note?.trim() || null;
  if (out.day_of_month !== undefined) out.day_of_month = out.day_of_month || null;
  if (out.category_id !== undefined) out.category_id = out.category_id || null;
  if (out.account_id !== undefined) out.account_id = out.account_id || null;
  return out;
}

const sortFixed = (a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.name.localeCompare(b.name, 'es'));

/* ----------------------------------------------------------------- deudas --- */

export async function addDebt(payload) {
  const { data, error } = await supabase.from('debts').insert(stamped(cleanDebt(payload))).select().single();
  if (error) throw error;
  state.debts = [...state.debts, normalizeDebt(data)];
  emit();
  return data;
}

export async function updateDebt(id, patch) {
  const { data, error } = await supabase.from('debts').update(cleanDebt(patch)).eq('id', id).select().single();
  if (error) throw error;
  state.debts = state.debts.map((d) => (d.id === id ? normalizeDebt(data) : d));
  emit();
  return data;
}

/**
 * Borra una deuda y sus pagos (cascade en la FK). Los gastos asociados a esos
 * pagos NO se borran: ya salieron de tu bolsillo y el cierre del mes tiene que
 * seguir cuadrando.
 */
export async function deleteDebt(id) {
  const { error } = await supabase.from('debts').delete().eq('id', id);
  if (error) throw error;
  state.debts = state.debts.filter((d) => d.id !== id);
  state.debtPayments = state.debtPayments.filter((p) => p.debt_id !== id);
  emit();
}

function cleanDebt(p) {
  const out = { ...p };
  if (out.initial_amount !== undefined) out.initial_amount = round2(out.initial_amount);
  if (out.minimum_payment !== undefined) out.minimum_payment = round2(out.minimum_payment || 0);
  if (out.annual_rate !== undefined) out.annual_rate = Number(out.annual_rate) || 0;
  if (out.due_day !== undefined) out.due_day = out.due_day || null;
  if (out.name !== undefined) out.name = out.name.trim();
  if (out.creditor !== undefined) out.creditor = out.creditor?.trim() || null;
  if (out.note !== undefined) out.note = out.note?.trim() || null;
  return out;
}

/**
 * Registra un pago. Por defecto crea también el gasto correspondiente, para
 * que el pago cuente en el saldo del mes; si el gasto ya estaba apuntado a
 * mano, se puede desactivar con `createExpense: false`.
 */
export async function addDebtPayment({ debt_id, amount, date, note, account_id, createExpense = true }) {
  const debt = state.debts.find((d) => d.id === debt_id);
  const value = round2(amount);
  let expense = null;

  if (createExpense) {
    const categoryId = debt?.category_id
      || categoriesOf('expense').find((c) => /deuda/i.test(c.name))?.id
      || null;
    expense = await addExpense({
      amount: value,
      category_id: categoryId,
      account_id: account_id || null,
      note: `Pago ${debt?.name || 'deuda'}`,
      date: date || todayISO(),
      is_recurring: false,
    });
  }

  const payload = {
    debt_id,
    amount: value,
    date: date || todayISO(),
    note: note?.trim() || null,
    expense_id: expense?.id || null,
  };

  const { data, error } = await supabase.from('debt_payments').insert(stamped(payload)).select().single();
  if (error) {
    // No dejamos el gasto huérfano si el pago no llegó a grabarse
    if (expense) await deleteMovement('expense', expense.id).catch(() => {});
    throw error;
  }

  state.debtPayments = [normalize(data), ...state.debtPayments];
  emit();
  return data;
}

/** Borra un pago y, si lo generó, el gasto asociado. */
export async function deleteDebtPayment(id) {
  const payment = state.debtPayments.find((p) => p.id === id);
  const { error } = await supabase.from('debt_payments').delete().eq('id', id);
  if (error) throw error;

  state.debtPayments = state.debtPayments.filter((p) => p.id !== id);
  if (payment?.expense_id) {
    await deleteMovement('expense', payment.expense_id).catch(() => {});
  }
  emit();
}

function sortCategories(a, b) {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.name.localeCompare(b.name, 'es');
}

/* --------------------------------------------------------------- helpers --- */

export function categoriesOf(type, { includeArchived = false } = {}) {
  return state.categories
    .filter((c) => c.type === type && (includeArchived || !c.is_archived))
    .sort(sortCategories);
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) || null;
}

/**
 * Categorías de gasto ordenadas por uso reciente (últimos 60 días).
 * Es lo que hace que "añadir gasto" sea de 2 taps: lo más probable, primero.
 */
export function frequentExpenseCategories() {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceISO = todayISO(since);

  const uses = new Map();
  for (const e of state.expenses) {
    if (e.date < sinceISO || !e.category_id) continue;
    uses.set(e.category_id, (uses.get(e.category_id) || 0) + 1);
  }

  return categoriesOf('expense').sort((a, b) => {
    const diff = (uses.get(b.id) || 0) - (uses.get(a.id) || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'es');
  });
}
