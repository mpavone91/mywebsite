import { sum, round2, monthKey, daysInMonth, elapsedDays, todayISO, eur, pct } from './utils.js';
import { businessExpenses } from './partners.js';

/**
 * Cierres diarios del local.
 *
 * Un cierre es el parte del día: lo que entró por cada forma de cobro. La app
 * guarda ese parte tal cual y además crea sus ingresos, así que la facturación
 * se puede mirar por aquí o desde el análisis de siempre; son los mismos euros
 * contados una sola vez.
 *
 * METHODS es la única lista de formas de cobro: de ella salen el formulario, el
 * total, el desglose y los ingresos, así que añadir una es tocar sólo eso (y su
 * columna en la tabla).
 */

export const METHODS = [
  { key: 'card', label: 'Tarjeta', icon: '💳', color: '#0ea5e9' },
  { key: 'online', label: 'Online', icon: '🌐', color: '#6366f1' },
  { key: 'cash', label: 'Efectivo', icon: '💵', color: '#78716c' },
  { key: 'reserva', label: 'Reserva', icon: '📅', color: '#f59e0b' },
];

export const closingTotal = (closing) =>
  round2(sum(METHODS, (m) => Number(closing[m.key]) || 0));

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Un día suelto sin parte es un olvido; un día de la semana entero sin un solo
// parte, habiendo pasado ya varias veces, es que el local cierra ese día.
const REST_DAY_MIN = 3;
// Si cambió el horario hace meses, lo viejo no debe seguir mandando
const REST_DAY_WINDOW = 90;

const isoWeekday = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Los días de la semana que el local no abre, deducidos de los partes.
 *
 * No se pregunta ni se configura: si desde que se lleva el registro han pasado
 * ya tres domingos y ninguno tiene parte, el local cierra los domingos. Un
 * martes olvidado no cuenta, porque los demás martes sí tienen parte.
 */
export function restDays(closings, upTo = todayISO()) {
  if (!closings.length) return [];

  const dates = new Set(closings.map((c) => c.date));
  const first = closings.reduce((a, c) => (c.date < a ? c.date : a), closings[0].date);
  const from = first < addDays(upTo, -REST_DAY_WINDOW) ? addDays(upTo, -REST_DAY_WINDOW) : first;

  const seen = [0, 0, 0, 0, 0, 0, 0];
  const withParte = [0, 0, 0, 0, 0, 0, 0];
  for (let day = from; day <= upTo; day = addDays(day, 1)) {
    const wd = isoWeekday(day);
    seen[wd] += 1;
    if (dates.has(day)) withParte[wd] += 1;
  }

  return seen
    .map((count, wd) => ({ wd, count, partes: withParte[wd] }))
    .filter((d) => d.count >= REST_DAY_MIN && d.partes === 0)
    .map((d) => d.wd);
}

/** "domingo" · "domingos y lunes" — para contarlo en castellano. */
export function restDaysLabel(days) {
  // "lunes" ya es plural; "domingo" y "sábado" no
  const names = days.map((wd) => (WEEKDAYS[wd].endsWith('s') ? WEEKDAYS[wd] : `${WEEKDAYS[wd]}s`));
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/** Facturación de un mes, con el peso de cada forma de cobro. */
export function takings(closings, month = monthKey()) {
  const rows = closings
    .filter((c) => c.date.slice(0, 7) === month)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const total = round2(sum(rows, closingTotal));
  const byMethod = METHODS.map((m) => {
    const value = round2(sum(rows, (c) => Number(c[m.key]) || 0));
    return { ...m, value, share: total > 0 ? value / total : 0 };
  });

  const days = daysInMonth(month);
  const elapsed = Math.min(elapsedDays(month), days);
  const best = rows.reduce((a, b) => (!a || closingTotal(b) > closingTotal(a) ? b : a), null);

  // Los días que el local cierra no son partes que falten, ni cuentan para la
  // proyección: el mes tiene menos días de apertura, no menos facturación.
  const closed = restDays(closings, `${month}-${String(elapsed || 1).padStart(2, '0')}`);
  const openDays = (upTo) => {
    let n = 0;
    for (let d = 1; d <= upTo; d += 1) {
      if (!closed.includes(isoWeekday(`${month}-${String(d).padStart(2, '0')}`))) n += 1;
    }
    return n;
  };
  const openElapsed = openDays(elapsed);
  const openTotal = openDays(days);

  return {
    month,
    rows,
    total,
    byMethod,
    closings: rows.length,
    // Media por día con parte, no por día natural: los días cerrados no cuentan
    average: rows.length ? round2(total / rows.length) : 0,
    best,
    daysElapsed: elapsed,
    daysTotal: days,
    // Días de la semana que el local no abre, y los días de apertura que salen
    closedWeekdays: closed,
    openElapsed,
    openTotal,
    // Proyección a fin de mes: la media de un día abierto por los que quedan
    projected: rows.length && elapsed > 0 && elapsed < days
      ? round2((total / rows.length) * openTotal)
      : null,
    // Días de apertura ya pasados sin parte. Los de cierre no cuentan: no
    // falta el parte del domingo si el domingo el local no abre.
    missing: Math.max(openElapsed - rows.length, 0),
  };
}

/** Resultado del mes: facturación menos gastos. */
export function monthResult(closings, expenses, month = monthKey()) {
  const income = takings(closings, month).total;
  const ofMonth = expenses.filter((e) => e.date.slice(0, 7) === month);

  // Lo que un socio saca para sí no es un gasto del local: es un préstamo. Si
  // contara aquí, el resultado del mes bajaría por algo que el negocio no ha
  // consumido, y dejaría de servir para saber si el local gana dinero.
  const spent = round2(sum(businessExpenses(ofMonth), (e) => e.amount));
  const drawn = round2(sum(ofMonth.filter((e) => e.partner_id), (e) => e.amount));

  return {
    income,
    expense: spent,
    drawn,
    result: round2(income - spent),
    margin: income > 0 ? (income - spent) / income : null,
    // Lo que de verdad ha quedado en caja este mes, retiradas incluidas
    cash: round2(income - spent - drawn),
  };
}

/* -------------------------------------------------------------- insights --- */

/** Tarjetas de análisis del negocio, en el formato del resto. */
export function closingInsights(data, month = monthKey()) {
  const { closings = [], expenses = [], fixedItems = [] } = data;
  const out = [];
  const view = takings(closings, month);
  if (!view.closings) return out;

  const result = monthResult(closings, expenses, month);

  // Con un plan de gastos fijos declarado, el resultado "con lo apuntado" y el
  // mínimo a facturar dirían cosas distintas del mismo mes y parecerían
  // contradecirse. Manda el del plan, que cuenta el mes entero.
  const conPlan = fixedItems.some((f) => f.is_active && f.kind === 'expense');

  if (!conPlan) {
    out.push({
      id: 'takings',
      level: result.result < 0 ? 'alert' : 'info',
      icon: '🧾',
      title: result.result < 0
        ? `El mes va en pérdidas: ${eur(result.result)}`
        : `Resultado del mes: ${eur(result.result)}`,
      body: `${eur(view.total)} facturados en ${view.closings} ${view.closings === 1 ? 'día' : 'días'} de parte, menos ${eur(result.expense)} de gastos.`,
      action: result.margin !== null
        ? `Margen del ${pct(result.margin)} · media de ${eur(view.average)} por día abierto.`
        : null,
    });
  }

  if (view.missing >= 3) {
    const cierra = view.closedWeekdays.length
      ? ` (sin contar los ${restDaysLabel(view.closedWeekdays)}, que el local no abre)`
      : '';
    out.push({
      id: 'closings-missing',
      level: 'warn',
      icon: '📭',
      title: `Faltan ${view.missing} partes por registrar`,
      body: `Del día 1 al ${view.daysElapsed} el local ha abierto ${view.openElapsed} días${cierra} y hay ${view.closings} cierres apuntados. La facturación del mes está incompleta.`,
      action: 'Los días sin parte no cuentan en la media ni en la proyección.',
    });
  }

  const cash = view.byMethod.find((m) => m.key === 'cash');
  if (cash && cash.share > 0.5) {
    out.push({
      id: 'closings-cash',
      level: 'info',
      icon: '💵',
      title: `El ${pct(cash.share)} de lo que facturas es efectivo`,
      body: `${eur(cash.value)} de ${eur(view.total)} entran en caja. Conviene cuadrar la caja a menudo y no dejar que se acumule.`,
    });
  }

  return out;
}
