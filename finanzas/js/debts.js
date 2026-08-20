import { sum, round2, monthKey, shiftMonth, monthLabel, todayISO, eur } from './utils.js';
import { monthTotals } from './analysis.js';

/**
 * Motor de deudas.
 *
 * Igual que analysis.js: funciones puras, sin DOM ni red. El saldo pendiente
 * nunca se guarda, se deriva siempre de los pagos registrados, así que no
 * puede desincronizarse por muchos pagos que edites o borres.
 */

const MAX_MONTHS = 600; // 50 años: si no se liquida en ese plazo, no se liquida

/* ------------------------------------------------------------- situación --- */

/** Estado de una deuda: pagado, pendiente, progreso y próximo vencimiento. */
export function debtStatus(debt, payments) {
  const own = payments.filter((p) => p.debt_id === debt.id);
  const paid = round2(sum(own, (p) => p.amount));
  const balance = round2(Math.max(0, debt.initial_amount - paid));
  const settled = Boolean(debt.closed_at) || balance <= 0.005;

  const monthlyInterest = round2(balance * (Number(debt.annual_rate) || 0) / 100 / 12);

  return {
    ...debt,
    payments: own.sort((a, b) => (a.date < b.date ? 1 : -1)),
    paid,
    balance,
    progress: debt.initial_amount > 0 ? Math.min(paid / debt.initial_amount, 1) : 0,
    settled,
    paymentCount: own.length,
    lastPaymentDate: own.length ? own[0].date : null,
    monthlyInterest,
    // ¿la cuota mínima cubre siquiera los intereses del mes?
    coversInterest: debt.minimum_payment > monthlyInterest,
    nextDueDate: settled ? null : nextDue(debt.due_day),
  };
}

/** Próximo día de pago a partir del día del mes configurado. */
export function nextDue(dueDay) {
  if (!dueDay) return null;
  const now = new Date();
  const clamp = (y, m) => Math.min(dueDay, new Date(y, m, 0).getDate());

  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  if (now.getDate() > clamp(y, m)) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const d = clamp(y, m);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Días que faltan para una fecha ISO (negativo si ya pasó). */
export function daysUntil(iso) {
  if (!iso) return null;
  const a = new Date(`${todayISO()}T00:00:00`);
  const b = new Date(`${iso}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

/** Resumen de todas las deudas vivas. */
export function debtsOverview(debts, payments) {
  const rows = debts.map((d) => debtStatus(d, payments));
  const active = rows.filter((r) => !r.settled);

  const balance = round2(sum(active, (r) => r.balance));
  const initial = round2(sum(active, (r) => r.initial_amount));
  const paid = round2(sum(rows, (r) => r.paid));

  return {
    rows: rows.sort(byUrgency),
    active,
    settled: rows.filter((r) => r.settled),
    balance,
    initial,
    paid,
    // Progreso sobre el total contratado, incluidas las ya liquidadas
    progress: sum(rows, (r) => r.initial_amount) > 0
      ? paid / sum(rows, (r) => r.initial_amount)
      : 0,
    minimums: round2(sum(active, (r) => r.minimum_payment)),
    monthlyInterest: round2(sum(active, (r) => r.monthlyInterest)),
    worstRate: active.length ? Math.max(...active.map((r) => Number(r.annual_rate) || 0)) : 0,
    stuck: active.filter((r) => (Number(r.annual_rate) || 0) > 0 && !r.coversInterest),
  };
}

// Primero las vivas, y dentro de ellas las de vencimiento más cercano
function byUrgency(a, b) {
  if (a.settled !== b.settled) return a.settled ? 1 : -1;
  if (a.nextDueDate && b.nextDueDate && a.nextDueDate !== b.nextDueDate) {
    return a.nextDueDate < b.nextDueDate ? -1 : 1;
  }
  return b.balance - a.balance;
}

/* ---------------------------------------------------------- amortización --- */

const ORDER = {
  // Avalancha: primero el interés más caro (ahorra más dinero)
  avalanche: (a, b) => b.rate - a.rate || a.balance - b.balance,
  // Bola de nieve: primero el saldo más pequeño (se liquida antes, motiva más)
  snowball: (a, b) => a.balance - b.balance || b.rate - a.rate,
};

/**
 * Simula la amortización mes a mes.
 *
 * Cada mes: se aplican intereses, se pagan los mínimos y todo lo que sobre
 * (el `extra` más los mínimos de las deudas ya liquidadas) va a la deuda
 * objetivo según la estrategia. Es el método "bola de nieve" clásico.
 */
export function simulatePayoff(debtRows, { extra = 0, strategy = 'avalanche' } = {}) {
  const lines = debtRows
    .filter((d) => !d.settled && d.balance > 0.005)
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      rate: (Number(d.annual_rate) || 0) / 100 / 12,
      minimum: Number(d.minimum_payment) || 0,
      interestPaid: 0,
      payoffMonth: null,
    }));

  const empty = {
    months: 0, totalInterest: 0, totalPaid: 0, lines: [],
    stalls: false, monthlyOutlay: 0, payoffMonth: null,
  };
  if (!lines.length) return empty;

  const minimums = sum(lines, (l) => l.minimum);
  const monthlyOutlay = round2(minimums + extra);

  let months = 0;
  let totalInterest = 0;
  let totalPaid = 0;
  let stalls = false;
  const remaining = () => sum(lines, (l) => Math.max(0, l.balance));

  while (remaining() > 0.005) {
    if (months >= MAX_MONTHS) { stalls = true; break; }
    const before = remaining();
    months += 1;

    for (const l of lines) {
      if (l.balance <= 0.005) continue;
      const interest = l.balance * l.rate;
      l.balance += interest;
      l.interestPaid += interest;
      totalInterest += interest;
    }

    let budget = monthlyOutlay;

    // Mínimos de las deudas que siguen vivas
    for (const l of lines) {
      if (l.balance <= 0.005 || budget <= 0.005) continue;
      const pay = Math.min(l.minimum, l.balance, budget);
      l.balance -= pay;
      budget -= pay;
      totalPaid += pay;
    }

    // El sobrante ataca la deuda objetivo
    const targets = lines.filter((l) => l.balance > 0.005).sort(ORDER[strategy] || ORDER.avalanche);
    for (const l of targets) {
      if (budget <= 0.005) break;
      const pay = Math.min(budget, l.balance);
      l.balance -= pay;
      budget -= pay;
      totalPaid += pay;
    }

    for (const l of lines) {
      if (l.balance <= 0.005 && l.payoffMonth === null) {
        l.balance = 0;
        l.payoffMonth = months;
      }
    }

    // Si el saldo total no ha bajado, el pago no cubre ni los intereses
    if (remaining() >= before - 0.005) { stalls = true; break; }
  }

  return {
    months,
    stalls,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    monthlyOutlay,
    payoffMonth: stalls ? null : shiftMonth(monthKey(), months),
    lines: lines.map((l) => ({
      ...l,
      interestPaid: round2(l.interestPaid),
      payoffLabel: l.payoffMonth ? monthLabel(shiftMonth(monthKey(), l.payoffMonth)) : null,
    })),
  };
}

/**
 * Cuánto puede aportar de más al mes, a partir de lo que realmente le ha
 * sobrado los últimos meses cerrados. Como los pagos de deuda ya se registran
 * como gasto, este sobrante es dinero libre de verdad.
 */
export function monthlyCapacity(expenses, incomes, lookback = 3) {
  const months = Array.from({ length: lookback }, (_, i) => shiftMonth(monthKey(), -(i + 1)))
    .map((m) => monthTotals(m, expenses, incomes))
    .filter((t) => t.hasData);

  if (!months.length) return { capacity: 0, months: 0, basedOn: [] };

  const average = sum(months, (m) => m.balance) / months.length;
  return {
    // Dejamos un colchón del 20 %: destinar hasta el último euro nunca aguanta
    capacity: round2(Math.max(0, average * 0.8)),
    average: round2(average),
    months: months.length,
    basedOn: months.map((m) => m.month),
  };
}

/** Compara pagar sólo los mínimos contra las dos estrategias con aportación extra. */
export function comparePlans(debtRows, extra) {
  const baseline = simulatePayoff(debtRows, { extra: 0, strategy: 'avalanche' });
  if (extra <= 0) return { baseline, avalanche: null, snowball: null, best: null };

  const avalanche = simulatePayoff(debtRows, { extra, strategy: 'avalanche' });
  const snowball = simulatePayoff(debtRows, { extra, strategy: 'snowball' });

  return {
    baseline,
    avalanche,
    snowball,
    best: avalanche.totalInterest <= snowball.totalInterest ? 'avalanche' : 'snowball',
    interestGap: round2(Math.abs(avalanche.totalInterest - snowball.totalInterest)),
    monthsSaved: baseline.stalls ? null : baseline.months - avalanche.months,
    interestSaved: baseline.stalls ? null : round2(baseline.totalInterest - avalanche.totalInterest),
  };
}

/** Escalones de aportación extra, para enseñar el efecto de cada uno. */
export function extraOptions(debtRows, capacity) {
  const raw = [capacity * 0.25, capacity * 0.5, capacity]
    .map((v) => Math.round(v / 10) * 10)
    .filter((v) => v >= 10);

  const levels = [...new Set(raw)];
  if (!levels.length) return [];

  const baseline = simulatePayoff(debtRows, { extra: 0 });

  return levels.map((extra) => {
    const plan = simulatePayoff(debtRows, { extra, strategy: 'avalanche' });
    return {
      extra,
      plan,
      monthsSaved: baseline.stalls || plan.stalls ? null : baseline.months - plan.months,
      interestSaved: baseline.stalls || plan.stalls ? null : round2(baseline.totalInterest - plan.totalInterest),
    };
  });
}

/* -------------------------------------------------------------- insights --- */

/**
 * Tarjetas del bloque de análisis referidas a deudas.
 * Mismo formato que las de analysis.js para que se pinten igual.
 */
export function debtInsights(debts, payments, { expenses, incomes, month = monthKey() } = {}) {
  const out = [];
  const view = debtsOverview(debts, payments);
  if (!view.active.length) return out;

  const income = monthTotals(month, expenses, incomes).income;
  const { capacity } = monthlyCapacity(expenses, incomes);
  const plans = comparePlans(view.active, capacity);

  /* --- 1. Cuota mínima frente a los ingresos ----------------------------- */
  if (income > 0) {
    const share = view.minimums / income;
    if (share > 0.35) {
      out.push({
        id: 'debt-ratio',
        level: 'alert',
        icon: '⛓️',
        title: `Tus deudas se llevan el ${Math.round(share * 100)} % de tus ingresos`,
        body: `Pagas ${eur(view.minimums)} al mes de cuotas mínimas sobre ${eur(income)} de ingresos. Por encima del 35 % la situación se considera de sobreendeudamiento.`,
        action: 'Antes de asumir cualquier gasto nuevo, prioriza bajar este porcentaje.',
      });
    }
  }

  /* --- 2. Deudas que no bajan con el mínimo ------------------------------ */
  for (const d of view.stuck) {
    out.push({
      id: `debt-stuck-${d.id}`,
      level: 'alert',
      icon: '🕳️',
      title: `"${d.name}" no baja con la cuota mínima`,
      body: `Genera ${eur(d.monthlyInterest)} de intereses al mes y pagas ${eur(d.minimum_payment)}: el saldo sube en vez de bajar.`,
      action: `Tendrías que pagar más de ${eur(d.monthlyInterest)} al mes sólo para empezar a amortizar.`,
    });
  }

  /* --- 3. Fecha de salida al ritmo actual -------------------------------- */
  if (plans.baseline.stalls) {
    out.push({
      id: 'debt-never',
      level: 'alert',
      icon: '🚨',
      title: 'Con las cuotas mínimas no saldrías de la deuda',
      body: `Debes ${eur(view.balance)} y los intereses suman ${eur(view.monthlyInterest)} al mes, más de lo que amortizas.`,
      action: 'Cualquier aportación extra que hagas va directa a reducir capital.',
    });
  } else if (plans.baseline.months > 0) {
    out.push({
      id: 'debt-payoff',
      level: view.balance > 0 ? 'info' : 'good',
      icon: '📆',
      title: `Libre de deudas en ${monthLabel(plans.baseline.payoffMonth)}`,
      body: `Te quedan ${eur(view.balance)} en ${view.active.length} ${view.active.length === 1 ? 'deuda' : 'deudas'}. Pagando ${eur(view.minimums)}/mes tardarías ${plans.baseline.months} meses y pagarías ${eur(plans.baseline.totalInterest)} de intereses.`,
      action: `Ya has amortizado ${eur(view.paid)} del total.`,
    });
  }

  /* --- 4. Cuánto aportar de más ----------------------------------------- */
  if (plans.avalanche && plans.monthsSaved > 0) {
    out.push({
      id: 'debt-extra',
      level: 'info',
      icon: '🚀',
      title: `Con ${eur(capacity)} más al mes saldrías ${plans.monthsSaved} meses antes`,
      body: `Es lo que te ha sobrado de media los últimos meses, dejando un colchón del 20 %. Pasarías de ${plans.baseline.months} a ${plans.avalanche.months} meses.`,
      action: `Te ahorrarías ${eur(plans.interestSaved)} de intereses. Empieza por "${targetName(plans.avalanche)}".`,
    });
  }

  /* --- 5. Qué estrategia le conviene ------------------------------------ */
  if (plans.avalanche && plans.snowball && plans.interestGap >= 20) {
    const winner = plans.best === 'avalanche' ? plans.avalanche : plans.snowball;
    out.push({
      id: 'debt-strategy',
      level: 'info',
      icon: '🎯',
      title: plans.best === 'avalanche' ? 'Te conviene el método avalancha' : 'Te conviene el método bola de nieve',
      body: plans.best === 'avalanche'
        ? `Atacar primero la deuda con el interés más alto te ahorra ${eur(plans.interestGap)} frente a empezar por la más pequeña.`
        : `Empezar por la deuda más pequeña te sale ${eur(plans.interestGap)} más barato en tu caso, además de liquidar una deuda antes.`,
      action: `Primera deuda a atacar: "${targetName(winner)}".`,
    });
  }

  return out;
}

function targetName(plan) {
  const first = plan.lines
    .filter((l) => l.payoffMonth !== null)
    .sort((a, b) => a.payoffMonth - b.payoffMonth)[0];
  return first?.name || plan.lines[0]?.name || '—';
}

export const DEBT_KINDS = [
  { value: 'card', label: 'Tarjeta de crédito' },
  { value: 'loan', label: 'Préstamo' },
  { value: 'personal', label: 'Préstamo personal / familiar' },
  { value: 'mortgage', label: 'Hipoteca' },
  { value: 'other', label: 'Otra' },
];

export const kindLabel = (kind) => DEBT_KINDS.find((k) => k.value === kind)?.label || 'Otra';
