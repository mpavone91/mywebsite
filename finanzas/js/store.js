import { supabase } from './supabase.js';
import { monthKey, shiftMonth, monthRange, todayISO, round2 } from './utils.js';

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
  return supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user ?? null;
    fn(session);
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

export async function signOut() {
  await supabase.auth.signOut();
  state.categories = [];
  state.expenses = [];
  state.incomes = [];
  state.loadedFrom = null;
  state.ready = false;
}

/* ----------------------------------------------------------------- carga --- */

function normalize(row) {
  return { ...row, amount: Number(row.amount) };
}

async function fetchRange(table, from, to) {
  let q = supabase.from(table).select('*').gte('date', from).order('date', { ascending: false });
  if (to) q = q.lte('date', to);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(normalize);
}

export async function loadAll() {
  const from = `${shiftMonth(monthKey(), -(WINDOW_MONTHS - 1))}-01`;

  const [cats, expenses, incomes] = await Promise.all([
    supabase.from('categories').select('*').order('type').order('name'),
    fetchRange('expenses', from),
    fetchRange('incomes', from),
  ]);
  if (cats.error) throw cats.error;

  state.categories = cats.data;
  state.expenses = expenses;
  state.incomes = incomes;
  state.loadedFrom = from;
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

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1));

export async function addExpense({ amount, category_id, note, date, is_recurring }) {
  const payload = {
    amount: round2(amount),
    category_id: category_id || null,
    note: note?.trim() || null,
    date: date || todayISO(),
    is_recurring: Boolean(is_recurring),
  };
  const { data, error } = await supabase.from('expenses').insert(payload).select().single();
  if (error) throw error;
  state.expenses = [normalize(data), ...state.expenses].sort(byDateDesc);
  emit();
  return data;
}

export async function addIncome({ amount, category_id, source, date, is_recurring }) {
  const payload = {
    amount: round2(amount),
    category_id: category_id || null,
    source: source?.trim() || null,
    date: date || todayISO(),
    is_recurring: Boolean(is_recurring),
  };
  const { data, error } = await supabase.from('incomes').insert(payload).select().single();
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
    .insert({ name: name.trim(), type, color, bucket })
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
