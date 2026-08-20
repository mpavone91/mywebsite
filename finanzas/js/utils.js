import { LOCALE, CURRENCY } from './config.js';

/* --------------------------------------------------------------- dinero --- */

const money0 = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: CURRENCY, maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** 1234.5 -> "1.234,50 €". Con `round` a true redondea a euros enteros. */
export function eur(n, round = false) {
  const v = Number(n) || 0;
  return (round ? money0 : money2).format(v);
}

/** Igual que eur() pero con signo explícito: "+1.200,00 €" / "−340,00 €". */
export function eurSigned(n, round = false) {
  const v = Number(n) || 0;
  const s = eur(Math.abs(v), round);
  if (v > 0) return `+${s}`;
  if (v < 0) return `−${s}`;
  return s;
}

export function pct(n, decimals = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals).replace('.', ',')} %`;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ---------------------------------------------------------------- fechas --- */
// Trabajamos siempre con fechas "YYYY-MM-DD" en hora local: la columna es `date`
// (sin zona horaria), así que convertir a UTC sólo introduce errores de un día.

export function todayISO(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-08" del mes actual (o del ISO/Date que le pases). */
export function monthKey(input = new Date()) {
  if (typeof input === 'string') return input.slice(0, 7);
  return todayISO(input).slice(0, 7);
}

/** Desplaza un mes "2026-08" n meses: shiftMonth('2026-08', -3) -> '2026-05'. */
export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Primer y último día del mes, en ISO. */
export function monthRange(key) {
  return { from: `${key}-01`, to: `${key}-${String(daysInMonth(key)).padStart(2, '0')}` };
}

/**
 * Días transcurridos del mes: el día de hoy si es el mes en curso,
 * el mes completo si ya pasó, 0 si es futuro. Se usa en la proyección.
 */
export function elapsedDays(key) {
  const now = monthKey();
  if (key < now) return daysInMonth(key);
  if (key > now) return 0;
  return new Date().getDate();
}

const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-08" -> "Agosto 2026" (o "Agosto" si es del año en curso y short). */
export function monthLabel(key, { short = false, capitalize = true } = {}) {
  const [y, m] = key.split('-').map(Number);
  let name = monthNames[m - 1];
  if (short) name = name.slice(0, 3);
  if (capitalize) name = name[0].toUpperCase() + name.slice(1);
  return y === new Date().getFullYear() && short ? name : `${name} ${y}`;
}

/** "2026-08-20" -> "Jue 20 ago" · "Hoy" · "Ayer". */
export function dayLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'Hoy';
  const d = new Date(`${iso}T00:00:00`);
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (iso === todayISO(yest)) return 'Ayer';
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
    .format(d)
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------- DOM --- */

/** Escapa texto que viene del usuario antes de meterlo en innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------------------------------------------ varios --- */

export function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

export const sum = (items, fn = (x) => x) => items.reduce((a, b) => a + (Number(fn(b)) || 0), 0);

/** Media de un array; null si está vacío (para distinguir "0" de "sin datos"). */
export function avg(nums) {
  if (!nums.length) return null;
  return sum(nums) / nums.length;
}

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el(`<div class="toast ${kind}">${esc(message)}</div>`);
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, kind === 'err' ? 4200 : 2200);
}

/** Vibración corta de confirmación en móvil (si el dispositivo lo soporta). */
export function haptic(ms = 12) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* no-op */ } }
}
