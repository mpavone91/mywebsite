import { RULES } from './config.js';
import {
  sum, avg, monthKey, shiftMonth, daysInMonth, elapsedDays, round2, eur, pct, monthLabel,
} from './utils.js';

/**
 * Motor de análisis — sección 2.5 de la spec.
 *
 * Todo lo que sale por pantalla en "Análisis" se calcula aquí, a partir de los
 * movimientos reales del usuario. Son funciones puras (entra data, sale data):
 * no tocan el DOM ni la red, así que se pueden probar y auditar de un vistazo.
 * Los umbrales viven en config.js -> RULES.
 */

/* ------------------------------------------------------------ agregados --- */

/** Totales de un mes: ingresos, gastos, saldo y tasa de ahorro. */
export function monthTotals(month, expenses, incomes) {
  const inMonth = (r) => r.date.slice(0, 7) === month;
  const exp = expenses.filter(inMonth);
  const inc = incomes.filter(inMonth);

  const income = round2(sum(inc, (r) => r.amount));
  const expense = round2(sum(exp, (r) => r.amount));

  return {
    month,
    income,
    expense,
    balance: round2(income - expense),
    savingsRate: income > 0 ? (income - expense) / income : null,
    recurringExpense: round2(sum(exp.filter((e) => e.is_recurring), (r) => r.amount)),
    expenseCount: exp.length,
    incomeCount: inc.length,
    hasData: exp.length + inc.length > 0,
  };
}

/** Desglose de gasto por categoría de un mes, de mayor a menor. */
export function categoryBreakdown(month, expenses, categories) {
  const exp = expenses.filter((e) => e.date.slice(0, 7) === month);
  const total = sum(exp, (e) => e.amount);
  const acc = new Map();

  for (const e of exp) {
    const key = e.category_id || '__none__';
    if (!acc.has(key)) {
      const cat = categories.find((c) => c.id === e.category_id);
      acc.set(key, {
        id: e.category_id || null,
        name: cat?.name || 'Sin categoría',
        color: cat?.color || '#94a3b8',
        bucket: cat?.bucket || 'wants',
        total: 0,
        count: 0,
      });
    }
    const row = acc.get(key);
    row.total += e.amount;
    row.count += 1;
  }

  return [...acc.values()]
    .map((r) => ({ ...r, total: round2(r.total), share: total > 0 ? r.total / total : 0 }))
    .sort((a, b) => b.total - a.total);
}

/** Serie de los últimos `count` meses con ingresos y gastos (para el gráfico). */
export function monthlySeries(count, expenses, incomes, from = monthKey()) {
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(from, -(count - 1 - i));
    const t = monthTotals(m, expenses, incomes);
    return { month: m, label: monthLabel(m, { short: true }), ...t };
  });
}

/**
 * Gasto acumulado del mes anterior hasta el mismo día del mes.
 * Comparar "mes a mes" a día 8 contra un mes cerrado engaña; esto no.
 */
export function prevMonthPace(month, expenses) {
  const prev = shiftMonth(month, -1);
  const day = elapsedDays(month);
  const upTo = expenses.filter((e) => e.date.slice(0, 7) === prev && Number(e.date.slice(8, 10)) <= day);
  return { month: prev, day, expense: round2(sum(upTo, (e) => e.amount)) };
}

/** Proyección de cierre de mes al ritmo de gasto actual. */
export function projection(month, expenses, incomes) {
  const t = monthTotals(month, expenses, incomes);
  const days = daysInMonth(month);
  const elapsed = elapsedDays(month);

  if (elapsed < 1) return null;

  const perDay = t.expense / elapsed;
  const projected = round2(perDay * days);

  return {
    perDay: round2(perDay),
    projected,
    daysElapsed: elapsed,
    daysTotal: days,
    daysLeft: days - elapsed,
    isClosed: elapsed >= days,
    // Cuánto quedaría al cierre si los ingresos se mantienen en lo ya registrado
    projectedBalance: round2(t.income - projected),
    // Cuánto se puede gastar al día para no cerrar en rojo
    safeDailyBudget: days > elapsed ? round2(Math.max(0, t.income - t.expense) / (days - elapsed)) : null,
  };
}

/** Gastos recurrentes (suscripciones) y su coste real anual. */
export function subscriptions(month, expenses, categories) {
  const items = expenses
    .filter((e) => e.date.slice(0, 7) === month && e.is_recurring)
    .map((e) => ({
      ...e,
      categoryName: categories.find((c) => c.id === e.category_id)?.name || 'Sin categoría',
      color: categories.find((c) => c.id === e.category_id)?.color || '#94a3b8',
    }))
    .sort((a, b) => b.amount - a.amount);

  const monthly = round2(sum(items, (i) => i.amount));
  return { items, monthly, yearly: round2(monthly * 12) };
}

/**
 * Categorías disparadas: gasto del mes > media de los N meses anteriores + X%.
 * Sólo se comparan meses con datos, para no castigar meses en los que el
 * usuario no registró nada.
 */
export function categorySpikes(month, expenses, categories, lookback = 3) {
  const baseMonths = Array.from({ length: lookback }, (_, i) => shiftMonth(month, -(i + 1)))
    .filter((m) => expenses.some((e) => e.date.slice(0, 7) === m));

  if (!baseMonths.length) return [];

  const current = categoryBreakdown(month, expenses, categories);

  return current
    .map((row) => {
      const history = baseMonths.map((m) => round2(sum(
        expenses.filter((e) => e.date.slice(0, 7) === m && (e.category_id || null) === row.id),
        (e) => e.amount,
      )));
      const baseline = avg(history);
      const delta = round2(row.total - baseline);
      const ratio = baseline > 0 ? row.total / baseline - 1 : (row.total > 0 ? Infinity : 0);
      return { ...row, baseline: round2(baseline), baseMonths: baseMonths.length, delta, ratio };
    })
    .filter((r) => r.delta >= RULES.spikeMinAmount
      && (r.ratio === Infinity || r.ratio >= RULES.spikeThreshold))
    .sort((a, b) => b.delta - a.delta);
}

/** Gasto hormiga: muchos tickets pequeños que en conjunto pesan. */
export function antExpenses(month, expenses) {
  const exp = expenses.filter((e) => e.date.slice(0, 7) === month);
  const small = exp.filter((e) => e.amount < RULES.antMaxAmount);
  const total = round2(sum(small, (e) => e.amount));
  const monthTotal = sum(exp, (e) => e.amount);
  const share = monthTotal > 0 ? total / monthTotal : 0;

  return {
    count: small.length,
    total,
    share,
    average: small.length ? round2(total / small.length) : 0,
    yearly: round2(total * 12),
    flagged: small.length >= RULES.antMinCount
      || (small.length >= 5 && share >= RULES.antMinShare),
  };
}

/**
 * Reparto 50/30/20 real del usuario.
 * Necesidades / deseos salen del `bucket` de cada categoría de gasto;
 * el ahorro es lo que sobra (ingresos − gastos) más lo que haya ido a
 * categorías marcadas como "ahorro".
 */
export function fiftyThirtyTwenty(month, expenses, incomes, categories) {
  const t = monthTotals(month, expenses, incomes);
  const rows = categoryBreakdown(month, expenses, categories);

  const spent = { needs: 0, wants: 0, savings: 0 };
  for (const r of rows) spent[r.bucket] = round2(spent[r.bucket] + r.total);

  const leftover = round2(t.income - t.expense);
  const savings = round2(spent.savings + Math.max(0, leftover));

  const actual = {
    needs: spent.needs,
    wants: spent.wants,
    savings,
  };
  const target = t.income > 0
    ? {
      needs: round2(t.income * RULES.budget.needs),
      wants: round2(t.income * RULES.budget.wants),
      savings: round2(t.income * RULES.budget.savings),
    }
    : null;

  const share = t.income > 0
    ? { needs: actual.needs / t.income, wants: actual.wants / t.income, savings: actual.savings / t.income }
    : null;

  return { income: t.income, actual, target, share, leftover };
}

/**
 * Fondo de emergencia recomendado, a partir del gasto medio real.
 * Se calcula sobre meses cerrados: incluir el mes en curso a día 8 daría una
 * media artificialmente baja. Si no hay histórico, se usa el mes actual.
 */
export function emergencyFund(month, expenses, incomes, lookback = 3) {
  const closed = Array.from({ length: lookback }, (_, i) => shiftMonth(month, -(i + 1)))
    .map((m) => monthTotals(m, expenses, incomes))
    .filter((t) => t.hasData);

  const current = monthTotals(month, expenses, incomes);
  const months = closed.length ? closed : (current.hasData ? [current] : []);

  if (!months.length) return null;

  const avgExpense = round2(avg(months.map((m) => m.expense)));
  const avgSaving = round2(avg(months.map((m) => m.balance)));
  const targetAmount = round2(avgExpense * RULES.emergencyMonths);

  return {
    avgExpense,
    avgSaving,
    months: months.length,
    targetMonths: RULES.emergencyMonths,
    targetAmount,
    // Meses que tardaría en juntarlo al ritmo de ahorro actual
    monthsToReach: avgSaving > 0 ? Math.ceil(targetAmount / avgSaving) : null,
  };
}

/**
 * Ingresos recurrentes registrados el mes pasado que aún faltan este mes.
 * (Sección 2.1: "la app recuerda pedirlos cada mes").
 */
export function missingRecurringIncomes(month, incomes) {
  const prev = shiftMonth(month, -1);
  // La fuente manda: si el mes pasado entró "MOMU" y este mes ya hay un ingreso
  // con esa fuente, no molestamos aunque se haya categorizado distinto.
  const keyOf = (i) => (i.source?.trim() ? `s:${i.source.trim().toLowerCase()}` : `c:${i.category_id || ''}`);

  const thisMonth = new Set(incomes.filter((i) => i.date.slice(0, 7) === month).map(keyOf));

  const pending = new Map();
  for (const i of incomes) {
    if (i.date.slice(0, 7) !== prev || !i.is_recurring) continue;
    if (thisMonth.has(keyOf(i))) continue;
    pending.set(keyOf(i), { source: i.source || 'Ingreso recurrente', amount: i.amount, category_id: i.category_id });
  }
  return [...pending.values()];
}

/* ------------------------------------------------------------- insights --- */

/**
 * Genera las tarjetas del bloque "Análisis".
 * Cada una nace de un cálculo concreto: el texto siempre lleva la cifra que lo
 * justifica, para que se pueda contrastar con los datos.
 */
export function buildInsights(month, { expenses, incomes, categories }) {
  const out = [];
  const t = monthTotals(month, expenses, incomes);
  const label = monthLabel(month);

  if (!t.hasData) {
    return [{
      id: 'empty',
      level: 'info',
      icon: '👋',
      title: `Sin movimientos en ${label}`,
      body: 'Registra tus ingresos y gastos y aquí aparecerá el análisis: tasa de ahorro, categorías disparadas, suscripciones y proyección de cierre.',
    }];
  }

  /* --- 1. Tasa de ahorro ------------------------------------------------- */
  if (t.income === 0) {
    out.push({
      id: 'no-income',
      level: 'warn',
      icon: '📥',
      title: 'No hay ingresos registrados este mes',
      body: `Llevas ${eur(t.expense)} de gasto y ningún ingreso apuntado, así que no se puede calcular la tasa de ahorro.`,
      action: 'Añade tu nómina u otros ingresos para que el análisis tenga sentido.',
    });
  } else {
    const rate = t.savingsRate;
    if (rate < 0) {
      out.push({
        id: 'savings-negative',
        level: 'alert',
        icon: '🚨',
        title: `Estás gastando más de lo que ingresas`,
        body: `En ${label} llevas ${eur(t.expense)} de gasto frente a ${eur(t.income)} de ingresos: ${eur(Math.abs(t.balance))} de más (tasa de ahorro ${pct(rate, 1)}).`,
        action: `Para cerrar en positivo tendrías que recortar ${eur(Math.abs(t.balance))} en lo que queda de mes.`,
      });
    } else if (rate < RULES.savingsRateTarget) {
      const gap = round2(t.income * RULES.savingsRateTarget - t.balance);
      out.push({
        id: 'savings-low',
        level: 'warn',
        icon: '⚠️',
        title: `Tasa de ahorro baja: ${pct(rate, 1)}`,
        body: `Estás ahorrando ${eur(t.balance)} de ${eur(t.income)} ingresados. El mínimo saludable es un ${pct(RULES.savingsRateTarget)}.`,
        action: `Te faltan ${eur(gap)} este mes para llegar al ${pct(RULES.savingsRateTarget)}.`,
      });
    } else if (rate >= RULES.savingsRateGood) {
      out.push({
        id: 'savings-good',
        level: 'good',
        icon: '✅',
        title: `Buen mes: ahorras el ${pct(rate, 1)}`,
        body: `Llevas ${eur(t.balance)} de saldo positivo sobre ${eur(t.income)} de ingresos.`,
        action: `A este ritmo son ${eur(round2(t.balance * 12), true)} al año.`,
      });
    } else {
      out.push({
        id: 'savings-ok',
        level: 'info',
        icon: '🙂',
        title: `Tasa de ahorro: ${pct(rate, 1)}`,
        body: `Vas por encima del mínimo del ${pct(RULES.savingsRateTarget)}, pero por debajo del ${pct(RULES.savingsRateGood)} recomendado por la regla 50/30/20.`,
        action: `Subir al ${pct(RULES.savingsRateGood)} serían ${eur(round2(t.income * RULES.savingsRateGood - t.balance))} más este mes.`,
      });
    }
  }

  /* --- 2. Categorías disparadas ------------------------------------------ */
  for (const spike of categorySpikes(month, expenses, categories).slice(0, 3)) {
    const pctText = spike.ratio === Infinity
      ? 'no habías gastado nada en esta categoría los meses anteriores'
      : `un ${pct(spike.ratio)} más que tu media de los últimos ${spike.baseMonths} meses (${eur(spike.baseline)})`;
    out.push({
      id: `spike-${spike.id || 'none'}`,
      level: 'warn',
      icon: '📈',
      title: `${spike.name} se ha disparado`,
      body: `Llevas ${eur(spike.total)} en ${spike.name}: ${pctText}.`,
      action: `Son ${eur(spike.delta)} por encima de lo habitual, en ${spike.count} ${spike.count === 1 ? 'movimiento' : 'movimientos'}.`,
    });
  }

  /* --- 3. Gasto hormiga -------------------------------------------------- */
  const ants = antExpenses(month, expenses);
  if (ants.flagged) {
    out.push({
      id: 'ants',
      level: 'warn',
      icon: '🐜',
      title: 'Gasto hormiga',
      body: `${ants.count} gastos de menos de ${eur(RULES.antMaxAmount, true)} suman ${eur(ants.total)} este mes — el ${pct(ants.share)} de todo lo que has gastado (media de ${eur(ants.average)} por ticket).`,
      action: `Manteniendo el ritmo son ${eur(ants.yearly, true)} al año en compras pequeñas.`,
    });
  }

  /* --- 4. Coste real de los gastos recurrentes --------------------------- */
  const subs = subscriptions(month, expenses, categories);
  if (subs.monthly > 0) {
    const shareOfIncome = t.income > 0 ? ` (el ${pct(subs.monthly / t.income)} de tus ingresos)` : '';
    out.push({
      id: 'subs',
      level: subs.monthly > t.income * 0.15 ? 'warn' : 'info',
      icon: '🔁',
      title: `Gastos fijos: ${eur(subs.yearly, true)} al año`,
      body: `Tienes ${subs.items.length} ${subs.items.length === 1 ? 'gasto recurrente' : 'gastos recurrentes'} (alquiler, cuotas, suscripciones…) por ${eur(subs.monthly)} al mes${shareOfIncome}. Al año son ${eur(subs.yearly, true)}.`,
      action: subs.items.length
        ? `La más cara: ${subs.items[0].note || subs.items[0].categoryName} (${eur(subs.items[0].amount)}/mes, ${eur(round2(subs.items[0].amount * 12), true)}/año).`
        : null,
    });
  }

  /* --- 5. Proyección de cierre de mes ------------------------------------ */
  const proj = projection(month, expenses, incomes);
  if (proj && !proj.isClosed && proj.daysElapsed >= 3) {
    const willOverspend = proj.projectedBalance < 0;
    out.push({
      id: 'projection',
      level: willOverspend ? 'alert' : 'info',
      icon: '🔮',
      title: `Cierre previsto: ${eur(proj.projected, true)} de gasto`,
      body: `Vas a ${eur(proj.perDay)}/día (${eur(t.expense)} en ${proj.daysElapsed} días). A ese ritmo cerrarás el día ${proj.daysTotal} con ${eur(proj.projected, true)} gastados y un saldo de ${eur(proj.projectedBalance, true)}.`,
      action: willOverspend
        ? `Para no cerrar en rojo te quedan ${eur(proj.safeDailyBudget)}/día durante los ${proj.daysLeft} días que faltan.`
        : `Puedes gastar hasta ${eur(proj.safeDailyBudget)}/día los ${proj.daysLeft} días que quedan y seguir en positivo.`,
    });
  }

  /* --- 6. Regla 50/30/20 ------------------------------------------------- */
  const budget = fiftyThirtyTwenty(month, expenses, incomes, categories);
  if (budget.target) {
    const over = [];
    if (budget.actual.needs > budget.target.needs) over.push(`necesidades (${pct(budget.share.needs)} vs 50 %, ${eur(round2(budget.actual.needs - budget.target.needs))} de más)`);
    if (budget.actual.wants > budget.target.wants) over.push(`deseos (${pct(budget.share.wants)} vs 30 %, ${eur(round2(budget.actual.wants - budget.target.wants))} de más)`);

    out.push({
      id: 'budget-503020',
      level: over.length ? 'info' : 'good',
      icon: '⚖️',
      title: over.length ? 'Tu reparto se sale del 50/30/20' : 'Tu reparto encaja en el 50/30/20',
      body: over.length
        ? `Este mes vas ${pct(budget.share.needs)} necesidades · ${pct(budget.share.wants)} deseos · ${pct(budget.share.savings)} ahorro. Te pasas en ${over.join(' y ')}.`
        : `Este mes vas ${pct(budget.share.needs)} necesidades · ${pct(budget.share.wants)} deseos · ${pct(budget.share.savings)} ahorro. Dentro de objetivo.`,
      action: 'Puedes reasignar qué categoría es necesidad o deseo desde la pantalla Categorías.',
    });
  }

  /* --- 7. Qué recortar primero (con datos, no genérico) ------------------ */
  const cut = recommendCut(month, expenses, categories);
  if (cut) {
    out.push({
      id: 'cut',
      level: 'info',
      icon: '✂️',
      title: `Por dónde empezar: ${cut.name}`,
      body: `Es tu mayor gasto prescindible del mes: ${eur(cut.total)} en ${cut.count} ${cut.count === 1 ? 'movimiento' : 'movimientos'}${cut.spiking ? ', y además está por encima de tu media habitual' : ''}.`,
      action: `Recortarlo un 30 % te dejaría ${eur(cut.saving)} al mes — ${eur(cut.yearlySaving, true)} al año.`,
    });
  }

  /* --- 8. Fondo de emergencia -------------------------------------------- */
  const fund = emergencyFund(month, expenses, incomes);
  if (fund && fund.avgExpense > 0) {
    out.push({
      id: 'emergency',
      level: 'info',
      icon: '🛟',
      title: `Fondo de emergencia: ${eur(fund.targetAmount, true)}`,
      body: `Tu gasto medio de los últimos ${fund.months} ${fund.months === 1 ? 'mes' : 'meses'} es ${eur(fund.avgExpense)}. El colchón recomendado son ${fund.targetMonths} meses de gastos: ${eur(fund.targetAmount, true)}.`,
      action: fund.monthsToReach
        ? `Ahorrando como ahora (${eur(fund.avgSaving)}/mes) lo tendrías en ${fund.monthsToReach} meses.`
        : 'Ahora mismo no estás ahorrando de media, así que el fondo no crece.',
    });
  }

  /* --- 9. Ingresos recurrentes pendientes -------------------------------- */
  for (const p of missingRecurringIncomes(month, incomes)) {
    out.push({
      id: `recurring-income-${p.source}`,
      level: 'info',
      icon: '📅',
      title: `¿Ya te ha entrado "${p.source}"?`,
      body: `El mes pasado registraste ${eur(p.amount)} de ${p.source} y este mes todavía no aparece.`,
      action: 'Si ya lo has cobrado, apúntalo para que el saldo del mes sea real.',
    });
  }

  // Lo urgente arriba: primero lo que va mal, luego los avisos, luego el resto.
  const rank = { alert: 0, warn: 1, good: 2, info: 3 };
  return out
    .map((insight, i) => ({ insight, i }))
    .sort((a, b) => (rank[a.insight.level] - rank[b.insight.level]) || (a.i - b.i))
    .map(({ insight }) => insight);
}

/**
 * Elige la categoría por la que conviene empezar a recortar: la de mayor
 * gasto entre las marcadas como "deseos", priorizando las que además
 * están disparadas respecto a su media.
 */
export function recommendCut(month, expenses, categories) {
  const spikes = new Set(categorySpikes(month, expenses, categories).map((s) => s.id));
  const candidates = categoryBreakdown(month, expenses, categories)
    .filter((r) => r.bucket === 'wants' && r.total > 0);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const bias = (spikes.has(b.id) ? 1 : 0) - (spikes.has(a.id) ? 1 : 0);
    return bias !== 0 ? bias : b.total - a.total;
  });

  const top = candidates[0];
  const saving = round2(top.total * 0.3);
  return { ...top, spiking: spikes.has(top.id), saving, yearlySaving: round2(saving * 12) };
}

/** Paquete completo para la pantalla de Análisis / Histórico de un mes. */
export function analyzeMonth(month, { expenses, incomes, categories }) {
  return {
    month,
    totals: monthTotals(month, expenses, incomes),
    previous: monthTotals(shiftMonth(month, -1), expenses, incomes),
    pace: prevMonthPace(month, expenses),
    byCategory: categoryBreakdown(month, expenses, categories),
    series: monthlySeries(6, expenses, incomes, month),
    projection: projection(month, expenses, incomes),
    subscriptions: subscriptions(month, expenses, categories),
    budget: fiftyThirtyTwenty(month, expenses, incomes, categories),
    ants: antExpenses(month, expenses),
    spikes: categorySpikes(month, expenses, categories),
    emergency: emergencyFund(month, expenses, incomes),
    insights: buildInsights(month, { expenses, incomes, categories }),
  };
}
