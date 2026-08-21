import { sum, round2, monthKey, eur } from './utils.js';

/**
 * Cuenta corriente de socios.
 *
 * Cuando un socio paga algo suyo con dinero del negocio, el negocio no ha
 * gastado: ha prestado. Y cuando aporta dinero, no ha facturado: le han
 * devuelto parte de ese préstamo.
 *
 * Por eso estos movimientos van marcados con `partner_id`: siguen moviendo el
 * dinero de la cuenta de la que salen o en la que entran —eso pasó de verdad—
 * pero quedan fuera del resultado del mes y del análisis de gasto. Lo que dejan
 * vivo es el saldo del socio: lo que ha sacado menos lo que ha devuelto.
 *
 * El saldo no se guarda en ningún sitio: se deriva siempre de los movimientos,
 * igual que el pendiente de una deuda, así que no puede desincronizarse.
 */

/** Retiradas: gastos del negocio que en realidad son de un socio. */
export const isDraw = (movement) => Boolean(movement.partner_id);

/** Lo que de verdad ha gastado el negocio: sin las retiradas de los socios. */
export const businessExpenses = (expenses) => expenses.filter((e) => !e.partner_id);

/** Lo que de verdad ha ingresado el negocio: sin las aportaciones. */
export const businessIncomes = (incomes) => incomes.filter((i) => !i.partner_id);

/**
 * Saldo de cada socio, con su movimiento del mes.
 *
 * `balance` positivo = ese socio le debe dinero al negocio.
 * `balance` negativo = ha puesto más de lo que ha sacado; el negocio le debe.
 */
export function partnerBalances({ partners = [], expenses = [], incomes = [] }, month = monthKey()) {
  const rows = partners.map((p) => {
    const draws = expenses.filter((e) => e.partner_id === p.id);
    const contributions = incomes.filter((i) => i.partner_id === p.id);

    const drawn = round2(sum(draws, (e) => e.amount));
    const contributed = round2(sum(contributions, (i) => i.amount));
    const inMonth = (rowsIn) => rowsIn.filter((r) => r.date.slice(0, 7) === month);

    const last = [...draws, ...contributions]
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;

    return {
      ...p,
      drawn,
      contributed,
      balance: round2(drawn - contributed),
      drawnThisMonth: round2(sum(inMonth(draws), (e) => e.amount)),
      contributedThisMonth: round2(sum(inMonth(contributions), (i) => i.amount)),
      movements: draws.length + contributions.length,
      lastMovement: last,
    };
  });

  const withBalance = rows.filter((r) => r.movements > 0);
  const total = round2(sum(rows, (r) => r.balance));

  return {
    rows: rows.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'es')),
    // Lo que los socios le deben al negocio en conjunto
    total,
    drawn: round2(sum(rows, (r) => r.drawn)),
    contributed: round2(sum(rows, (r) => r.contributed)),
    drawnThisMonth: round2(sum(rows, (r) => r.drawnThisMonth)),
    active: withBalance.length,
    me: rows.find((r) => r.is_me) || null,
  };
}

/** El reparto en porcentaje, para ver de un vistazo quién ha sacado más. */
export function drawShare(view) {
  const total = view.drawn;
  return view.rows
    .filter((r) => r.drawn > 0)
    .map((r) => ({ ...r, share: total > 0 ? r.drawn / total : 0 }));
}

/* -------------------------------------------------------------- insights --- */

/** Tarjetas de análisis sobre los socios, en el formato del resto. */
export function partnerInsights({ partners = [], expenses = [], incomes = [] }, month = monthKey()) {
  const out = [];
  const view = partnerBalances({ partners, expenses, incomes }, month);
  if (!view.active) return out;

  const debtors = view.rows.filter((r) => r.balance > 0);

  if (debtors.length) {
    const top = debtors[0];
    out.push({
      id: 'partner-balance',
      level: 'info',
      icon: '🤝',
      title: `Los socios deben ${eur(view.total)} al negocio`,
      body: debtors.length === 1
        ? `Todo es de ${top.name}: ha sacado ${eur(top.drawn)} y ha devuelto ${eur(top.contributed)}.`
        : `${debtors.map((r) => `${r.name} ${eur(r.balance)}`).join(' · ')}.`,
      action: view.drawnThisMonth > 0
        ? `Este mes han salido ${eur(view.drawnThisMonth)} por esta vía.`
        : 'Este mes no ha salido nada por esta vía.',
    });
  }

  // Una retirada grande frente a lo que factura el local se nota en la caja
  const monthExpenses = businessExpenses(expenses).filter((e) => e.date.slice(0, 7) === month);
  const spent = round2(sum(monthExpenses, (e) => e.amount));
  if (view.drawnThisMonth > 0 && spent > 0 && view.drawnThisMonth > spent * 0.5) {
    out.push({
      id: 'partner-heavy',
      level: 'warn',
      icon: '⚠️',
      title: 'Los socios están sacando mucho este mes',
      body: `${eur(view.drawnThisMonth)} de retiradas frente a ${eur(spent)} de gastos del negocio. No es un gasto del local, pero sale de la misma caja.`,
      action: 'Cuadra que quede bastante para proveedores y nóminas.',
    });
  }

  return out;
}
