import { sum, round2, monthKey, daysInMonth, elapsedDays, eur, pct } from './utils.js';

/**
 * Cierres diarios del local.
 *
 * Un cierre es el parte del día: tarjeta, online y efectivo. La app guarda ese
 * parte tal cual y además crea sus ingresos, así que la facturación se puede
 * mirar por aquí o desde el análisis de siempre; son los mismos euros contados
 * una sola vez.
 */

export const METHODS = [
  { key: 'card', label: 'Tarjeta', icon: '💳', color: '#0ea5e9' },
  { key: 'online', label: 'Online', icon: '🌐', color: '#6366f1' },
  { key: 'cash', label: 'Efectivo', icon: '💵', color: '#78716c' },
];

export const closingTotal = (closing) =>
  round2(Number(closing.card || 0) + Number(closing.online || 0) + Number(closing.cash || 0));

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
    // Proyección a fin de mes al ritmo de los días que llevan parte
    projected: rows.length && elapsed > 0 && elapsed < days
      ? round2((total / rows.length) * days * (rows.length / elapsed))
      : null,
    // Días del mes ya pasados sin parte: puede ser cierre semanal o un olvido
    missing: Math.max(elapsed - rows.length, 0),
  };
}

/** Resultado del mes: facturación menos gastos. */
export function monthResult(closings, expenses, month = monthKey()) {
  const income = takings(closings, month).total;
  const spent = round2(sum(
    expenses.filter((e) => e.date.slice(0, 7) === month), (e) => e.amount,
  ));

  return {
    income,
    expense: spent,
    result: round2(income - spent),
    margin: income > 0 ? (income - spent) / income : null,
  };
}

/* -------------------------------------------------------------- insights --- */

/** Tarjetas de análisis del negocio, en el formato del resto. */
export function closingInsights({ closings = [], expenses = [] }, month = monthKey()) {
  const out = [];
  const view = takings(closings, month);
  if (!view.closings) return out;

  const result = monthResult(closings, expenses, month);

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

  if (view.missing >= 3) {
    out.push({
      id: 'closings-missing',
      level: 'warn',
      icon: '📭',
      title: `Faltan ${view.missing} partes por registrar`,
      body: `Del día 1 al ${view.daysElapsed} hay ${view.closings} cierres apuntados. Si el local abre a diario, la facturación del mes está incompleta.`,
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
