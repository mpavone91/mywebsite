import {
  el, esc, eur, pct, monthKey, monthLabel, dayLabel, groupBy, sum, round2,
} from '../utils.js';
import { state, categoryById, accountById } from '../store.js';
import { businessExpenses } from '../partners.js';
import { breakEven, billingSplit } from '../breakeven.js';
import { openExpenseSheet } from './add-movement.js';
import { emptyState } from '../ui.js';

/**
 * Gastos del negocio.
 *
 * La pantalla contesta dos preguntas seguidas: en qué se va el dinero, y qué
 * día se va. Por eso el desglose por categoría manda arriba y el detalle va
 * agrupado por día, no como una lista corrida: un local gasta a rachas, y ver
 * el total de cada día es lo que hace saltar el "¿qué pasó el martes?".
 */

export function renderExpenses() {
  const month = monthKey();
  const rows = businessExpenses(state.expenses).filter((e) => e.date.slice(0, 7) === month);
  const total = round2(sum(rows, (e) => e.amount));
  const view = breakEven({ ...state, profitGoal: activeGoal() }, month);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Gastos</h1>
          <p>${monthLabel(month)} · en qué se va el dinero</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);
  const body = screen.querySelector('[data-body]');

  /* --- lo gastado -------------------------------------------------------- */
  // groupBy devuelve un Map
  const days = groupBy(rows, (e) => e.date);
  const perDay = days.size ? round2(total / days.size) : 0;

  body.appendChild(el(`
    <div class="card balance-card">
      <div class="balance-label">Gastado en ${monthLabel(month)}</div>
      <div class="balance-value num ${total > view.billed && view.billed > 0 ? 'neg' : ''}">${eur(total)}</div>
      <div class="balance-sub">
        ${rows.length
    ? `${rows.length} ${rows.length === 1 ? 'gasto' : 'gastos'} en ${days.size} ${days.size === 1 ? 'día' : 'días'} · media de <strong>${eur(perDay)}</strong> por día con gasto`
    : 'Todavía no has apuntado ningún gasto este mes'}
        ${view.billed > 0 ? `<br>Es el <strong>${pct(total / view.billed)}</strong> de lo facturado` : ''}
      </div>
    </div>
  `));

  /* --- adónde va lo que facturas ----------------------------------------- */
  if (view.billed > 0) body.appendChild(splitCard(view));

  /* --- por categoría ----------------------------------------------------- */
  if (rows.length) body.appendChild(byCategory(rows, total));

  /* --- alta -------------------------------------------------------------- */
  const add = el(`
    <button class="quick quick-expense" data-add style="width:100%">
      + Gasto del negocio
      <small>Proveedores, nóminas, suministros…</small>
    </button>
  `);
  add.addEventListener('click', () => openExpenseSheet());
  body.appendChild(add);

  /* --- día a día --------------------------------------------------------- */
  body.appendChild(byDay(days, rows));

  return screen;
}

/** El objetivo de ganancia del espacio activo. */
const activeGoal = () =>
  Number(state.workspaces.find((w) => w.id === state.workspaceId)?.profit_goal || 0);

/* --------------------------------------------------------------- reparto --- */

/**
 * Adónde va cada euro facturado. Es la tarjeta que contesta al "he facturado
 * ocho mil y en la cuenta tengo setecientos".
 */
function splitCard(view) {
  const parts = billingSplit(view);

  return el(`
    <div class="card">
      <div class="section-title" style="margin:0 0 10px">De lo facturado, adónde va</div>
      <div class="metric-row">
        <span>Facturado</span>
        <span class="num pos">${eur(view.billed)}</span>
      </div>
      ${parts.filter((p) => p.key !== 'left').map((p) => `
        <div class="metric-row">
          <span>− ${p.label}</span>
          <span class="num">${eur(p.value)} <span class="muted tiny">${pct(p.share)}</span></span>
        </div>`).join('')}
      <div class="metric-row" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
        <strong>${view.left >= 0 ? '= Queda en el negocio' : '= Falta por cubrir'}</strong>
        <strong class="num ${view.left < 0 ? 'neg' : 'pos'}">${eur(Math.abs(view.left))}</strong>
      </div>
      <div class="bar" style="margin-top:12px;display:flex;gap:2px;background:none;border:0;height:10px">
        ${parts.map((p, i) => `
          <i style="flex:${Math.max(p.value, 0.01)};background:${p.color};
                    border-radius:${i === 0 ? '99px 0 0 99px' : i === parts.length - 1 ? '0 99px 99px 0' : '0'}"></i>`).join('')}
      </div>
      ${view.fixedPending > 0 ? `
        <p class="tiny muted" style="margin:10px 0 0">
          Los gastos fijos incluyen ${eur(view.fixedPending)} que este mes todavía no has pagado:
          esto es lo que va a costar el mes, no sólo lo que llevas gastado.
        </p>` : ''}
      ${view.drawn > 0 ? `
        <p class="tiny muted" style="margin:10px 0 0">
          Las retiradas de socios no son gasto del local, pero salen de la misma caja: por eso
          la facturación y lo que hay en el banco no cuadran.
        </p>` : ''}
    </div>
  `);
}

/* ------------------------------------------------------------ categorías --- */

function byCategory(rows, total) {
  const groups = [...groupBy(rows, (e) => e.category_id || 'none')]
    .map(([id, items]) => {
      const cat = id === 'none' ? null : categoryById(id);
      return {
        id,
        name: cat?.name || 'Sin categoría',
        color: cat?.color || '#94a3b8',
        value: round2(sum(items, (e) => e.amount)),
        count: items.length,
      };
    })
    .sort((a, b) => b.value - a.value);

  const block = el(`
    <div>
      <div class="section-title">En qué se gasta más</div>
      <div class="card" data-rows></div>
    </div>
  `);
  const box = block.querySelector('[data-rows]');

  for (const g of groups) {
    box.appendChild(el(`
      <div style="margin-bottom:12px">
        <div class="row-between" style="gap:10px">
          <span class="row" style="gap:8px;min-width:0">
            <span class="dot" style="background:${esc(g.color)};flex:none"></span>
            <span class="truncate">${esc(g.name)}</span>
            <span class="tiny muted" style="flex:none">${g.count}</span>
          </span>
          <span class="num" style="font-weight:650">${eur(g.value)}
            <span class="muted tiny">${pct(g.value / total)}</span></span>
        </div>
        <div class="bar" style="margin-top:6px;height:6px">
          <i style="width:${((g.value / total) * 100).toFixed(1)}%;background:${esc(g.color)}"></i>
        </div>
      </div>
    `));
  }

  return block;
}

/* ------------------------------------------------------------------ días --- */

function byDay(days, rows) {
  const block = el(`
    <div>
      <div class="section-title">Día a día</div>
      <div class="stack" data-days style="gap:10px"></div>
    </div>
  `);
  const box = block.querySelector('[data-days]');

  if (!rows.length) {
    box.appendChild(el(`<div class="card">${emptyState('Sin gastos este mes.')}</div>`));
    return block;
  }

  const fechas = [...days.keys()].sort().reverse();
  const peor = fechas.reduce((a, d) => {
    const v = round2(sum(days.get(d), (e) => e.amount));
    return !a || v > a.value ? { date: d, value: v } : a;
  }, null);

  for (const fecha of fechas) {
    const items = [...days.get(fecha)].sort((a, b) => b.amount - a.amount);
    const dayTotal = round2(sum(items, (e) => e.amount));
    const esElPeor = fechas.length > 2 && fecha === peor.date;

    const card = el(`
      <div class="card card-flush">
        <div class="row-between" style="padding:12px 16px;border-bottom:1px solid var(--border)">
          <span style="font-weight:650">${esc(dayLabel(fecha))}${esElPeor ? ' <span class="tiny muted">· el día más caro</span>' : ''}</span>
          <span class="num" style="font-weight:700">${eur(dayTotal)}</span>
        </div>
        <div class="list" data-list></div>
      </div>
    `);
    const list = card.querySelector('[data-list]');

    for (const item of items) {
      const cat = item.category_id ? categoryById(item.category_id) : null;
      const cuenta = item.account_id ? accountById(item.account_id) : null;
      const row = el(`
        <button class="list-item" type="button">
          <span class="dot" style="background:${esc(cat?.color || '#94a3b8')}"></span>
          <span class="grow" style="min-width:0">
            <span class="truncate" style="display:block;font-weight:600">${esc(item.note || cat?.name || 'Gasto')}</span>
            <span class="tiny muted truncate" style="display:block">
              ${esc(cat?.name || 'Sin categoría')}${cuenta ? ` · ${esc(cuenta.name)}` : ''}${item.is_recurring ? ' · fijo' : ''}
            </span>
          </span>
          <span class="num" style="font-weight:650">${eur(item.amount)}</span>
        </button>
      `);
      row.addEventListener('click', () => openExpenseSheet({ movement: item }));
      list.appendChild(row);
    }

    box.appendChild(card);
  }

  return block;
}
