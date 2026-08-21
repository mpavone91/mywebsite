import {
  sum, avg, round2, monthKey, shiftMonth, daysInMonth, elapsedDays, eur, pct, monthLabel,
} from './utils.js';
import { debtsOverview } from './debts.js';
import { isPersonal } from './accounts.js';

/**
 * Plan mensual.
 *
 * Los movimientos cuentan lo que ha pasado; el plan declara con qué cuentas
 * cada mes. La resta entre los dos responde la pregunta que importa: cuánto
 * queda libre para gastar, o cuánto falta por ingresar.
 *
 * Tres bloques, y ninguno se solapa con otro:
 *
 *   ingresos fijos − gastos fijos − cuotas de deuda = margen del mes
 *
 * Las cuotas salen de la pantalla de Deudas, no se apuntan a mano: si se
 * apuntaran en los dos sitios se restarían dos veces.
 */

export const FREQUENCIES = [
  { value: 'monthly', label: 'Al mes', short: '/mes', factor: 1 },
  { value: 'weekly', label: 'A la semana', short: '/sem', factor: 52 / 12 },
  { value: 'quarterly', label: 'Cada trimestre', short: '/trim', factor: 1 / 3 },
  { value: 'yearly', label: 'Al año', short: '/año', factor: 1 / 12 },
];

export const frequencyMeta = (value) =>
  FREQUENCIES.find((f) => f.value === value) || FREQUENCIES[0];

/** Lo declarado, llevado a su equivalente mensual. */
export function declaredMonthly(item) {
  return round2(Number(item.amount) * frequencyMeta(item.frequency).factor);
}

/**
 * Lo que supone al mes un apunte.
 * Con `estimate` (de estimateItem) devuelve la media real cuando la hay; sin
 * él, el importe declarado. Se mantiene el nombre porque es lo que usan las
 * vistas y la mayoría de apuntes son de importe fijo.
 */
export function monthlyAmount(item, estimate = null) {
  if (estimate && estimate.source === 'average') return estimate.monthly;
  return declaredMonthly(item);
}

/* ------------------------------------------------------- importe variable --- */

const normalize = (text) => (text || '').trim().toLowerCase();

/**
 * ¿Este movimiento es de los que alimentan el apunte?
 *
 * Se reconoce por la palabra clave en la nota (o la fuente, si es un ingreso).
 * A propósito NO vale sólo la categoría: "Luz" y "Alquiler" suelen compartir
 * categoría, y mezclarlos daría una media sin sentido.
 */
export function matchesItem(item, row) {
  const key = normalize(item.match_text || item.name);
  if (!key) return false;
  const text = normalize(item.kind === 'income' ? row.source : row.note);
  return Boolean(text) && text.includes(key);
}

/**
 * Media mensual real de un apunte variable.
 *
 * Se suma todo lo registrado en la ventana y se reparte entre los meses que
 * abarca de verdad — desde el primer movimiento encontrado —, no entre los
 * meses pedidos. Así una factura que llega cada dos meses da su equivalente
 * mensual correcto, y quien lleva sólo dos meses registrando no ve su media
 * dividida entre seis.
 *
 * La ventana termina en el mes anterior: el mes en curso está a medias y
 * arrastraría la media hacia abajo.
 */
export function averageFor(item, { expenses, incomes }, month = monthKey()) {
  const rows = (item.kind === 'income' ? incomes : expenses).filter((r) => matchesItem(item, r));
  if (!rows.length) return null;

  const lookback = Math.max(Number(item.lookback_months) || 6, 2);
  const window = Array.from({ length: lookback }, (_, i) => shiftMonth(month, -(i + 1)));
  const oldest = window[window.length - 1];
  const newest = window[0];

  const inWindow = rows.filter((r) => {
    const m = r.date.slice(0, 7);
    return m >= oldest && m <= newest;
  });
  if (!inWindow.length) return null;

  const months = [...new Set(inWindow.map((r) => r.date.slice(0, 7)))].sort();
  const firstMonth = months[0];
  // Meses que abarca de verdad, del primer registro al último mes cerrado
  const span = window.filter((m) => m >= firstMonth).length || 1;

  const total = round2(sum(inWindow, (r) => r.amount));
  const perMonth = months.map((m) => round2(sum(
    inWindow.filter((r) => r.date.slice(0, 7) === m), (r) => r.amount,
  )));

  return {
    monthly: round2(total / span),
    total,
    span,
    count: inWindow.length,
    monthsWithData: months.length,
    min: round2(Math.min(...perMonth)),
    max: round2(Math.max(...perMonth)),
    lastMonth: months[months.length - 1],
  };
}

/**
 * Importe con el que entra un apunte en el plan, y de dónde sale.
 * Un apunte variable sin histórico todavía cae en el importe declarado, para
 * que el plan enseñe algo mientras se acumulan registros.
 */
export function estimateItem(item, data, month = monthKey()) {
  if (item.amount_mode !== 'average') {
    return { monthly: declaredMonthly(item), source: 'fixed', stats: null };
  }

  const stats = averageFor(item, data, month);
  if (!stats) {
    return { monthly: declaredMonthly(item), source: 'estimate', stats: null };
  }
  return { monthly: stats.monthly, source: 'average', stats };
}

/* --------------------------------------------------------- correspondencia --- */

/**
 * ¿Ya está registrado este mes el movimiento de un apunte?
 *
 * Primero por la palabra clave, que es lo que escribe la app al registrarlo
 * desde el plan. Como respaldo vale un movimiento recurrente de la misma
 * categoría por un importe parecido, para reconocer lo que se apuntó a mano.
 */
export function findRegistered(item, month, { expenses, incomes }) {
  const rows = (item.kind === 'income' ? incomes : expenses)
    .filter((r) => r.date.slice(0, 7) === month);

  const byText = rows.find((r) => matchesItem(item, r));
  if (byText) return byText;

  if (!item.category_id) return null;
  const target = declaredMonthly(item);
  return rows.find((r) => r.category_id === item.category_id
    && r.is_recurring
    && Math.abs(r.amount - target) <= Math.max(target * 0.05, 1)) || null;
}

/* ------------------------------------------------------------- panorama --- */

/**
 * Foto completa del plan para un mes.
 * `data` es el estado del store: apuntes fijos, deudas, movimientos y cuentas.
 */
export function planOverview(data, month = monthKey()) {
  const {
    fixedItems = [], debts = [], debtPayments = [],
    expenses = [], incomes = [], accounts = [],
  } = data;

  const active = fixedItems.filter((f) => f.is_active);
  const decorate = (item) => {
    const estimate = estimateItem(item, { expenses, incomes }, month);
    return {
      ...item,
      monthly: estimate.monthly,
      estimate,
      registered: findRegistered(item, month, { expenses, incomes }),
    };
  };

  const fixedIncomes = active.filter((f) => f.kind === 'income').map(decorate);
  const fixedExpenses = active.filter((f) => f.kind === 'expense').map(decorate);

  const income = round2(sum(fixedIncomes, (f) => f.monthly));
  const expense = round2(sum(fixedExpenses, (f) => f.monthly));

  // Las cuotas vienen de Deudas para no contarlas dos veces
  const debtView = debtsOverview(debts, debtPayments);
  const quotas = debtView.minimums;

  const margin = round2(income - expense - quotas);
  const days = daysInMonth(month);
  const elapsed = Math.min(elapsedDays(month), days);
  const daysLeft = Math.max(days - elapsed, 0);

  // Gasto variable real: lo de tu bolsillo este mes que no es un fijo ya contado
  const fixedIds = new Set(fixedExpenses.map((f) => f.registered?.id).filter(Boolean));
  const variableSpent = round2(sum(
    expenses.filter((e) => e.date.slice(0, 7) === month
      && isPersonal(e.account_id, accounts)
      && !fixedIds.has(e.id)
      && !e.is_recurring),
    (e) => e.amount,
  ));

  const left = round2(margin - variableSpent);

  return {
    month,
    fixedIncomes,
    fixedExpenses,
    income,
    expense,
    quotas,
    margin,
    // Cuánto se puede gastar al día sin salirse del plan
    dailyAllowance: days > 0 ? round2(margin / days) : 0,
    shortfall: margin < 0 ? round2(-margin) : 0,
    variableSpent,
    left,
    daysLeft,
    leftPerDay: daysLeft > 0 ? round2(left / daysLeft) : null,
    // Qué parte de los ingresos fijos se come cada bloque
    expenseShare: income > 0 ? expense / income : null,
    quotaShare: income > 0 ? quotas / income : null,
    marginShare: income > 0 ? margin / income : null,
    totalDebt: debtView.balance,
    activeDebts: debtView.active.length,
    pending: [...fixedIncomes, ...fixedExpenses].filter((f) => !f.registered),
    hasPlan: active.length > 0,
  };
}

/**
 * Ingreso fijo sugerido a partir del histórico: la media mensual de lo
 * ingresado en los últimos meses cerrados. Es lo que pide una nómina que
 * varía de un mes a otro.
 */
export function suggestFixedIncome(incomes, accounts = [], { months = 12, categoryId = null } = {}) {
  const keys = Array.from({ length: months }, (_, i) => shiftMonth(monthKey(), -(i + 1)));

  const totals = keys.map((m) => round2(sum(
    incomes.filter((i) => i.date.slice(0, 7) === m
      && isPersonal(i.account_id, accounts)
      && (!categoryId || i.category_id === categoryId)),
    (i) => i.amount,
  )));

  // Sólo cuentan los meses en los que hubo algún ingreso: un mes a cero suele
  // significar "no lo apunté", no "no cobré", y hundiría la media.
  const withData = totals.filter((t) => t > 0);
  if (!withData.length) return null;

  return {
    average: round2(avg(withData)),
    months: withData.length,
    min: round2(Math.min(...withData)),
    max: round2(Math.max(...withData)),
    lookback: months,
  };
}

/* -------------------------------------------------------------- insights --- */

/** Tarjetas del plan, en el mismo formato que el resto del análisis. */
export function planInsights(data, month = monthKey()) {
  const out = [];
  const plan = planOverview(data, month);
  if (!plan.hasPlan) return out;

  /* --- 1. Margen del mes ------------------------------------------------- */
  if (plan.margin < 0) {
    out.push({
      id: 'plan-shortfall',
      level: 'alert',
      icon: '🧮',
      title: `Te faltan ${eur(plan.shortfall)} al mes`,
      body: `Tus ingresos fijos (${eur(plan.income)}) no cubren tus gastos fijos (${eur(plan.expense)}) más las cuotas de deuda (${eur(plan.quotas)}).`,
      action: `Necesitas ingresar ${eur(plan.shortfall)} más al mes, o recortar esa cantidad de tus fijos, sólo para quedarte a cero.`,
    });
  } else if (plan.income > 0) {
    out.push({
      id: 'plan-margin',
      level: plan.marginShare < 0.1 ? 'warn' : 'info',
      icon: '🧮',
      title: `Te quedan ${eur(plan.margin)} al mes tras los fijos`,
      body: `De ${eur(plan.income)} de ingresos fijos se van ${eur(plan.expense)} en gastos fijos y ${eur(plan.quotas)} en cuotas de deuda. Son ${eur(plan.dailyAllowance)} al día para todo lo demás.`,
      action: plan.marginShare < 0.1
        ? `Ese margen es sólo el ${pct(plan.marginShare)} de lo que ingresas: cualquier imprevisto te deja en rojo.`
        : `El margen es el ${pct(plan.marginShare)} de tus ingresos fijos.`,
    });
  }

  /* --- 2. Cómo va el mes contra el plan ---------------------------------- */
  if (plan.margin > 0 && plan.variableSpent > 0) {
    const over = plan.left < 0;
    out.push({
      id: 'plan-progress',
      level: over ? 'alert' : plan.left < plan.margin * 0.2 ? 'warn' : 'good',
      icon: over ? '🚧' : '🎯',
      title: over
        ? `Te has pasado ${eur(-plan.left)} del margen de ${monthLabel(month)}`
        : `Te quedan ${eur(plan.left)} de margen este mes`,
      body: `Llevas ${eur(plan.variableSpent)} de gasto variable sobre los ${eur(plan.margin)} que te dejan libres los fijos.`,
      action: over
        ? 'Lo que gastes de más sale de tu ahorro o entra como deuda nueva.'
        : plan.leftPerDay !== null
          ? `Son ${eur(plan.leftPerDay)} al día durante los ${plan.daysLeft} días que quedan.`
          : null,
    });
  }

  /* --- 3. Peso de los fijos --------------------------------------------- */
  if (plan.income > 0 && plan.expenseShare > 0.6) {
    out.push({
      id: 'plan-heavy',
      level: 'warn',
      icon: '⚖️',
      title: `Tus gastos fijos se llevan el ${pct(plan.expenseShare)} de lo que ingresas`,
      body: `${eur(plan.expense)} de ${eur(plan.income)} están comprometidos antes de empezar el mes. Por encima del 60 % queda muy poco margen de maniobra.`,
      action: 'Mira la lista de fijos: suele haber uno o dos que ya no compensan.',
    });
  }

  /* --- 4. Fijos que aún no se han registrado este mes -------------------- */
  if (plan.pending.length) {
    const total = round2(sum(plan.pending, (p) => p.monthly));
    out.push({
      id: 'plan-pending',
      level: 'info',
      icon: '📋',
      title: `${plan.pending.length} ${plan.pending.length === 1 ? 'fijo pendiente' : 'fijos pendientes'} de registrar`,
      body: `${plan.pending.map((p) => p.name).slice(0, 4).join(', ')}${plan.pending.length > 4 ? '…' : ''} suman ${eur(total)} este mes.`,
      action: 'Desde la pantalla Plan los registras de un toque, con su importe ya puesto.',
    });
  }

  return out;
}
