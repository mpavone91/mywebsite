import { sum, round2, monthKey, eur, pct } from './utils.js';
import { estimateItem, findRegistered } from './plan.js';
import { businessExpenses } from './partners.js';
import { takings } from './closings.js';

/**
 * Cuánto hay que facturar.
 *
 * La pregunta del negocio no es "cuánto me queda libre" —eso es de lo personal,
 * donde el ingreso es fijo y el gasto variable—, sino la contraria: el gasto es
 * lo previsible y la facturación lo que hay que salir a buscar cada día.
 *
 * De ahí salen tres cifras:
 *
 *   mínimo    = lo que cuesta tener el local abierto (fijos + lo variable real)
 *   objetivo  = mínimo + lo que uno quiere ganar
 *   al día    = cada una repartida entre los días que el local abre
 *
 * Y una cuarta que explica el desconcierto de facturar mucho y no ver el dinero:
 * la facturación menos TODO lo que sale, retiradas de socios incluidas.
 */

/** Coste fijo del mes: los apuntes del plan, en su equivalente mensual. */
export function fixedCost({ fixedItems = [], expenses = [], incomes = [] }, month = monthKey()) {
  const items = fixedItems
    .filter((f) => f.is_active && f.kind === 'expense')
    .map((f) => {
      const estimate = estimateItem(f, { expenses, incomes }, month);
      return {
        ...f,
        monthly: estimate.monthly,
        estimate,
        // Qué movimiento del mes corresponde a este fijo, para no contarlo
        // otra vez entre los variables
        registered: findRegistered(f, month, { expenses, incomes }),
      };
    })
    .sort((a, b) => b.monthly - a.monthly);

  return {
    items,
    total: round2(sum(items, (f) => f.monthly)),
    // Lo que está declarado pero todavía no se ha pagado este mes
    pending: round2(sum(items.filter((f) => !f.registered), (f) => f.monthly)),
  };
}

/**
 * El cuadro completo del mes.
 *
 * `variable` es lo gastado de verdad este mes que no corresponde a un apunte
 * fijo ya contado: proveedores, reposiciones, imprevistos. Se cuenta tal cual,
 * sin proyectar, porque proyectar el gasto variable de un local con dos semanas
 * de datos da un número que no se sostiene.
 */
export function breakEven(data, month = monthKey()) {
  const {
    fixedItems = [], expenses = [], incomes = [], closings = [], profitGoal = 0,
  } = data;

  const sales = takings(closings, month);
  const fixed = fixedCost({ fixedItems, expenses, incomes }, month);

  const ofMonth = businessExpenses(expenses).filter((e) => e.date.slice(0, 7) === month);
  // Los gastos que ya son un apunte del plan no se cuentan dos veces
  const fixedIds = new Set(fixed.items.map((f) => f.registered?.id || null).filter(Boolean));
  // Todo lo que no sea el pago de un fijo ya declarado cuenta como variable,
  // esté marcado como recurrente o no: en un local se gasta a diario y lo que
  // importa es el dinero que sale, no cómo se etiquetó.
  const variableRows = ofMonth.filter((e) => !fixedIds.has(e.id));
  const variable = round2(sum(variableRows, (e) => e.amount));

  // Lo que se han llevado los socios: no es coste del local, pero sale de la caja
  const drawn = round2(sum(
    expenses.filter((e) => e.partner_id && e.date.slice(0, 7) === month),
    (e) => e.amount,
  ));

  const minimum = round2(fixed.total + variable);
  const target = round2(minimum + Number(profitGoal || 0));

  const openTotal = sales.openTotal || sales.daysTotal;
  const openElapsed = sales.openElapsed || sales.daysElapsed;
  const perDay = (n) => (openTotal > 0 ? round2(n / openTotal) : 0);

  // A estas alturas del mes, cuánto debería llevar facturado
  const expectedSoFar = openTotal > 0 ? round2(minimum * (openElapsed / openTotal)) : 0;

  return {
    month,
    billed: sales.total,
    fixed: fixed.total,
    fixedPending: fixed.pending,
    fixedItems: fixed.items,
    variable,
    variableRows,
    drawn,
    minimum,
    target,
    profitGoal: round2(Number(profitGoal || 0)),
    openTotal,
    openElapsed,
    openLeft: Math.max(openTotal - openElapsed, 0),
    minimumPerDay: perDay(minimum),
    targetPerDay: perDay(target),
    // Lo que queda de verdad: por aquí se va el dinero que no se ve
    left: round2(sales.total - minimum - drawn),
    // Sobre el mínimo: positivo = el local se paga solo y sobra
    overMinimum: round2(sales.total - minimum),
    expectedSoFar,
    onTrack: sales.total >= expectedSoFar,
    coverage: minimum > 0 ? sales.total / minimum : null,
    // Cuánto falta por facturar para llegar a cada cifra
    missingToMinimum: Math.max(round2(minimum - sales.total), 0),
    missingToTarget: Math.max(round2(target - sales.total), 0),
    hasPlan: fixed.items.length > 0,
  };
}

/**
 * Reparto de la facturación: adónde ha ido cada euro.
 *
 * Es la respuesta a "he facturado 8.000 y en la cuenta tengo 700": el dinero no
 * desaparece, se reparte, y hasta que no se ve el reparto no se entiende.
 */
export function billingSplit(view) {
  const parts = [
    { key: 'fixed', label: 'Gastos fijos', value: view.fixed, color: '#a855f7' },
    { key: 'variable', label: 'Gastos variables', value: view.variable, color: '#f59e0b' },
    { key: 'drawn', label: 'Retiradas de socios', value: view.drawn, color: '#ec4899' },
    {
      key: 'left',
      label: view.left >= 0 ? 'Queda en el negocio' : 'Falta por cubrir',
      value: Math.abs(view.left),
      color: view.left >= 0 ? '#16a34a' : '#ef4444',
    },
  ].filter((p) => p.value > 0);

  const total = round2(sum(parts, (p) => p.value));
  return parts.map((p) => ({ ...p, share: total > 0 ? p.value / total : 0 }));
}

/* -------------------------------------------------------------- insights --- */

/** Tarjetas de análisis del negocio sobre lo que cuesta tenerlo abierto. */
export function breakEvenInsights(data, month = monthKey()) {
  const out = [];
  const view = breakEven(data, month);
  if (!view.hasPlan && view.variable === 0) return out;

  if (view.minimum > 0) {
    out.push({
      id: 'breakeven',
      level: view.overMinimum < 0 ? 'alert' : 'info',
      icon: '🎯',
      title: view.overMinimum < 0
        ? `Te faltan ${eur(view.missingToMinimum)} para cubrir el mes`
        : `El mes ya se paga solo: ${eur(view.overMinimum)} por encima`,
      body: `Tener el local abierto cuesta ${eur(view.minimum)} este mes (${eur(view.fixed)} de fijos y ${eur(view.variable)} de variables). Llevas ${eur(view.billed)} facturados.`,
      action: view.minimumPerDay > 0
        ? `Son ${eur(view.minimumPerDay)} de facturación por cada día que abres.`
        : null,
    });
  }

  if (view.profitGoal > 0 && view.missingToTarget > 0) {
    out.push({
      id: 'profit-goal',
      level: 'info',
      icon: '📈',
      title: `Para ganar ${eur(view.profitGoal)} te faltan ${eur(view.missingToTarget)}`,
      body: `El objetivo del mes son ${eur(view.target)} de facturación, o ${eur(view.targetPerDay)} por día abierto.`,
      action: view.openLeft > 0
        ? `Quedan ${view.openLeft} días de apertura: ${eur(round2(view.missingToTarget / view.openLeft))} al día.`
        : null,
    });
  }

  // Lo que explica la sensación de facturar mucho y no ver el dinero
  if (view.billed > 0 && view.drawn > 0) {
    out.push({
      id: 'billing-split',
      level: 'info',
      icon: '🔍',
      title: `De ${eur(view.billed)} facturados quedan ${eur(view.left)}`,
      body: `${eur(view.fixed)} en fijos, ${eur(view.variable)} en variables y ${eur(view.drawn)} que se han llevado los socios.`,
      action: 'Las retiradas no son gasto del local, pero salen de la misma caja.',
    });
  }

  // El fijo que más pesa: por ahí empieza cualquier recorte
  if (view.fixedItems.length && view.billed > 0) {
    const top = view.fixedItems[0];
    if (top.monthly / view.billed > 0.25) {
      out.push({
        id: 'heavy-fixed',
        level: 'warn',
        icon: '⚓',
        title: `${top.name} se lleva el ${pct(top.monthly / view.billed)} de lo que facturas`,
        body: `${eur(top.monthly)} al mes de una facturación de ${eur(view.billed)}. Es el gasto fijo más pesado del local.`,
        action: `Necesitas facturar ${eur(round2(top.monthly / (view.openTotal || 1)))} al día sólo para pagarlo.`,
      });
    }
  }

  return out;
}
