import {
  el, esc, eur, eurSigned, pct, monthKey, monthLabel, shiftMonth, groupBy, sum, round2, dayLabel, toast,
} from '../utils.js';
import { state, personalData, ensureMonth, categoryById } from '../store.js';
import { analyzeMonth } from '../analysis.js';
import { insightCard } from './analysis.js';
import { emptyState } from '../ui.js';
import { openExpenseSheet, openIncomeSheet } from './add-movement.js';

// El mes elegido sobrevive a los re-render que dispara el store (al cargar
// meses antiguos, al editar un movimiento...), para no saltar al mes por defecto.
let selectedMonth = null;

/** Histórico: mismo desglose que el dashboard, para cualquier mes pasado. */
export function renderHistory(initialMonth = selectedMonth || shiftMonth(monthKey(), -1)) {
  let month = initialMonth;
  selectedMonth = month;

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Histórico</h1>
          <p>Cierre mes a mes</p>
        </div>
      </div>

      <div class="card row-between" style="padding:8px 10px">
        <button class="btn btn-ghost" data-prev aria-label="Mes anterior">‹</button>
        <strong data-label style="font-size:16px"></strong>
        <button class="btn btn-ghost" data-next aria-label="Mes siguiente">›</button>
      </div>

      <div data-body style="margin-top:12px"></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');
  const labelEl = screen.querySelector('[data-label]');
  const nextBtn = screen.querySelector('[data-next]');

  async function show() {
    selectedMonth = month;
    labelEl.textContent = monthLabel(month);
    nextBtn.disabled = month >= monthKey();
    body.innerHTML = '<div class="skeleton" style="height:200px"></div>';

    try {
      await ensureMonth(month);
    } catch (err) {
      toast(err.message || 'No se pudo cargar el mes', 'err');
    }
    body.replaceChildren(monthReport(month, { onChange: show }));
  }

  screen.querySelector('[data-prev]').addEventListener('click', () => {
    month = shiftMonth(month, -1);
    show();
  });
  nextBtn.addEventListener('click', () => {
    if (month >= monthKey()) return;
    month = shiftMonth(month, 1);
    show();
  });

  show();
  return screen;
}

/** Desglose completo de un mes: totales, categorías, insights y movimientos. */
export function monthReport(month, { onChange } = {}) {
  const a = analyzeMonth(month, personalData());
  const { totals: t, previous: prev, byCategory } = a;

  if (!t.hasData) {
    return el(`<div class="card">${emptyState(`No hay movimientos registrados en ${monthLabel(month)}.`)}</div>`);
  }

  const deltaExpense = prev.hasData ? round2(t.expense - prev.expense) : null;
  const deltaText = deltaExpense === null
    ? 'Sin datos del mes anterior'
    : `${eurSigned(deltaExpense)} vs ${monthLabel(prev.month, { short: true })}`;

  const wrap = el(`
    <div class="stack">
      <div class="card balance-card">
        <div class="balance-label">Saldo de ${monthLabel(month)}</div>
        <div class="balance-value num ${t.balance < 0 ? 'neg' : 'pos'}">${eurSigned(t.balance)}</div>
        <div class="balance-sub">
          ${eur(t.income)} ingresados · ${eur(t.expense)} gastados
        </div>
        <div class="row-between tiny muted" style="margin-top:8px">
          <span>Tasa de ahorro ${t.savingsRate === null ? '—' : pct(t.savingsRate, 1)}</span>
          <span>${deltaText}</span>
        </div>
      </div>

      <div class="split-3">
        <div class="card stat">
          <div class="k">Ingresos</div>
          <div class="v num pos">${eur(t.income, true)}</div>
        </div>
        <div class="card stat">
          <div class="k">Gastos</div>
          <div class="v num">${eur(t.expense, true)}</div>
        </div>
        <div class="card stat">
          <div class="k">Recurrentes</div>
          <div class="v num">${eur(t.recurringExpense, true)}</div>
        </div>
      </div>

      <div>
        <div class="section-title">Por categoría</div>
        <div class="card">
          ${byCategory.length ? byCategory.map((r) => `
            <div style="margin-bottom:12px">
              <div class="row-between small">
                <span class="truncate"><strong>${esc(r.name)}</strong>
                  <span class="muted tiny">· ${r.count} ${r.count === 1 ? 'mov.' : 'movs.'}</span></span>
                <span class="num">${eur(r.total)} <span class="muted tiny">${pct(r.share)}</span></span>
              </div>
              <div class="bar" style="margin-top:5px">
                <i style="width:${(r.share * 100).toFixed(1)}%;background:${esc(r.color)}"></i>
              </div>
            </div>`).join('') : emptyState('Sin gastos este mes.')}
        </div>
      </div>

      <div>
        <div class="section-title">Análisis del mes</div>
        <div class="stack" data-insights></div>
      </div>

      <div>
        <div class="section-title">Movimientos</div>
        <div class="card card-flush" data-movements></div>
      </div>
    </div>
  `);

  const insights = wrap.querySelector('[data-insights]');
  for (const insight of a.insights) insights.appendChild(insightCard(insight));

  wrap.querySelector('[data-movements]').appendChild(monthMovementList(month, onChange));

  return wrap;
}

/** Todos los movimientos de un mes, agrupados por día con su cierre diario. */
function monthMovementList(month, onChange) {
  const items = [
    ...state.expenses.filter((e) => e.date.slice(0, 7) === month).map((e) => ({ ...e, kind: 'expense', label: e.note })),
    ...state.incomes.filter((i) => i.date.slice(0, 7) === month).map((i) => ({ ...i, kind: 'income', label: i.source })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1)));

  if (!items.length) return el(`<div>${emptyState('Sin movimientos.')}</div>`);

  const list = el('<div class="list"></div>');

  for (const [date, dayItems] of groupBy(items, (m) => m.date)) {
    const balance = round2(sum(dayItems, (m) => (m.kind === 'income' ? m.amount : -m.amount)));
    list.appendChild(el(`
      <div class="day-header">
        <span>${esc(dayLabel(date))}</span>
        <span class="num ${balance < 0 ? 'neg' : 'pos'}">${eurSigned(balance)}</span>
      </div>
    `));

    for (const m of dayItems) {
      const cat = categoryById(m.category_id);
      const color = cat?.color || (m.kind === 'income' ? 'var(--pos)' : '#94a3b8');
      const title = m.label || cat?.name || (m.kind === 'income' ? 'Ingreso' : 'Gasto');

      const row = el(`
        <button class="list-item" type="button">
          <span class="dot" style="background:${esc(color)};color:${esc(color)}"></span>
          <span class="grow" style="min-width:0">
            <span class="truncate" style="display:block;font-weight:600">${esc(title)}</span>
            ${cat ? `<span class="tiny muted truncate" style="display:block">${esc(cat.name)}${m.is_recurring ? ' · 🔁' : ''}</span>` : ''}
          </span>
          <span class="num" style="font-weight:650;color:${m.kind === 'income' ? 'var(--pos)' : 'inherit'}">
            ${m.kind === 'income' ? '+' : '−'}${eur(m.amount)}
          </span>
        </button>
      `);
      row.addEventListener('click', async () => {
        const opts = { movement: m, onSaved: onChange };
        if (m.kind === 'income') await openIncomeSheet(opts);
        else await openExpenseSheet(opts);
      });
      list.appendChild(row);
    }
  }

  return list;
}
