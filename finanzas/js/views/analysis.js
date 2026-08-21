import { el, esc, eur, pct, monthKey, monthLabel, daysInMonth, elapsedDays, round2 } from '../utils.js';
import { state, personalData } from '../store.js';
import { analyzeMonth } from '../analysis.js';
import { debtInsights } from '../debts.js';
import { accountInsights } from '../accounts.js';
import { planInsights } from '../plan.js';
import { RULES } from '../config.js';
import { incomeVsExpenseBars, cumulativeSpendLine } from '../charts.js';
import { emptyState } from '../ui.js';

const LEVEL_CLASS = {
  alert: 'is-alert', warn: 'is-warn', good: 'is-good', info: 'is-info',
};

/** Tarjeta de insight. Cada una viene de un cálculo de analysis.js. */
export function insightCard(insight) {
  return el(`
    <div class="card insight ${LEVEL_CLASS[insight.level] || 'is-info'}">
      <div class="icon">${insight.icon}</div>
      <div>
        <h3>${esc(insight.title)}</h3>
        <p>${esc(insight.body)}</p>
        ${insight.action ? `<div class="action">${esc(insight.action)}</div>` : ''}
      </div>
    </div>
  `);
}

/** Pantalla "Análisis": el gestor financiero automático del mes en curso. */
export function renderAnalysis() {
  const month = monthKey();
  const a = analyzeMonth(month, personalData());

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Análisis</h1>
          <p>${monthLabel(month)} · reglas aplicadas sobre tus datos reales</p>
        </div>
      </div>
      <div class="stack" data-insights></div>
      <div data-extra></div>
    </div>
  `);

  // Las tarjetas de deuda se calculan aparte (debts.js) y se mezclan aquí,
  // ordenadas otra vez por gravedad para que lo urgente quede arriba del todo.
  const rank = { alert: 0, warn: 1, good: 2, info: 3 };
  const insights = [
    ...a.insights,
    ...debtInsights(state.debts, state.debtPayments, {
      expenses: state.expenses, incomes: state.incomes, month,
    }),
    ...accountInsights(state, month),
    ...planInsights(state, month),
  ]
    .map((insight, i) => ({ insight, i }))
    .sort((x, y) => (rank[x.insight.level] - rank[y.insight.level]) || (x.i - y.i))
    .map(({ insight }) => insight);

  const list = screen.querySelector('[data-insights]');
  for (const insight of insights) list.appendChild(insightCard(insight));

  if (a.totals.hasData) screen.querySelector('[data-extra]').appendChild(analysisDetail(a));

  return screen;
}

/** Bloques de detalle: 50/30/20, suscripciones y gráficos. */
function analysisDetail(a) {
  const wrap = el('<div></div>');
  const { budget, subscriptions: subs, series, totals, projection: proj } = a;

  /* --- regla 50/30/20 --------------------------------------------------- */
  if (budget.target) {
    const line = (key, label, target) => {
      const value = budget.actual[key];
      const share = budget.share[key];
      const over = value > budget.target[key];
      return `
        <div style="margin-bottom:12px">
          <div class="row-between small">
            <span><strong>${label}</strong> <span class="muted">objetivo ${target}</span></span>
            <span class="num ${over && key !== 'savings' ? 'neg' : ''}">${eur(value)} · ${pct(share)}</span>
          </div>
          <div class="bar" style="margin-top:6px">
            <i style="width:${Math.min(share * 100, 100).toFixed(1)}%;
                      background:${key === 'savings' ? 'var(--pos)' : over ? 'var(--neg)' : 'var(--accent)'}"></i>
          </div>
        </div>`;
    };

    wrap.appendChild(el(`
      <div>
        <div class="section-title">Regla 50/30/20</div>
        <div class="card">
          ${line('needs', 'Necesidades', `${RULES.budget.needs * 100} %`)}
          ${line('wants', 'Deseos', `${RULES.budget.wants * 100} %`)}
          ${line('savings', 'Ahorro', `${RULES.budget.savings * 100} %`)}
          <p class="tiny muted" style="margin:2px 0 0">
            Sobre ${eur(budget.income)} de ingresos. Cada categoría cuenta como necesidad o deseo
            según cómo la tengas marcada en Categorías.
          </p>
        </div>
      </div>
    `));
  }

  /* --- suscripciones ---------------------------------------------------- */
  wrap.appendChild(el(`
    <div>
      <div class="section-title">Gastos recurrentes</div>
      <div class="card card-flush">
        ${subs.items.length ? `
          <div class="day-header">
            <span>${subs.items.length} ${subs.items.length === 1 ? 'suscripción' : 'suscripciones'}</span>
            <span class="num">${eur(subs.monthly)}/mes</span>
          </div>
          <div class="list">
            ${subs.items.map((s) => `
              <div class="list-item">
                <span class="dot" style="background:${esc(s.color)};color:${esc(s.color)}"></span>
                <span class="grow truncate">
                  <span style="font-weight:600">${esc(s.note || s.categoryName)}</span>
                  <span class="tiny muted" style="display:block">${esc(s.categoryName)}</span>
                </span>
                <span style="text-align:right">
                  <span class="num" style="font-weight:650;display:block">${eur(s.amount)}</span>
                  <span class="tiny muted num">${eur(round2(s.amount * 12), true)}/año</span>
                </span>
              </div>`).join('')}
          </div>
          <div class="day-header" style="border-top:1px solid var(--border);border-bottom:0">
            <span>Coste anual</span>
            <span class="num">${eur(subs.yearly, true)}</span>
          </div>` : emptyState('Marca un gasto como “recurrente” al crearlo y aparecerá aquí con su coste anual.')}
      </div>
    </div>
  `));

  /* --- gasto acumulado + proyección ------------------------------------- */
  if (proj && !proj.isClosed && totals.expense > 0) {
    const card = el(`
      <div>
        <div class="section-title">Ritmo de gasto del mes</div>
        <div class="card">
          <div class="chart-wrap"><canvas data-line></canvas></div>
          <div class="metric-row"><span>Gastado a día ${proj.daysElapsed}</span><span class="num">${eur(totals.expense)}</span></div>
          <div class="metric-row"><span>Ritmo diario</span><span class="num">${eur(proj.perDay)}/día</span></div>
          <div class="metric-row"><span>Proyección a día ${proj.daysTotal}</span><span class="num">${eur(proj.projected, true)}</span></div>
          <div class="metric-row">
            <span>Saldo previsto al cierre</span>
            <span class="num ${proj.projectedBalance < 0 ? 'neg' : 'pos'}">${eur(proj.projectedBalance, true)}</span>
          </div>
        </div>
      </div>
    `);
    wrap.appendChild(card);

    queueMicrotask(() => {
      const canvas = card.querySelector('[data-line]');
      if (canvas?.isConnected) cumulativeSpendLine(canvas, cumulativeData(a.month, state.expenses, proj));
    });
  }

  /* --- ingresos vs gastos, 6 meses -------------------------------------- */
  const barsCard = el(`
    <div>
      <div class="section-title">Ingresos vs. gastos (6 meses)</div>
      <div class="card"><div class="chart-wrap tall"><canvas data-bars></canvas></div></div>
    </div>
  `);
  wrap.appendChild(barsCard);
  queueMicrotask(() => {
    const canvas = barsCard.querySelector('[data-bars]');
    if (canvas?.isConnected) incomeVsExpenseBars(canvas, series);
  });

  return wrap;
}

/** Serie de gasto acumulado día a día + la recta de proyección hasta fin de mes. */
export function cumulativeData(month, expenses, proj) {
  const total = daysInMonth(month);
  const elapsed = elapsedDays(month);
  const perDay = new Array(total + 1).fill(0);

  for (const e of expenses) {
    if (e.date.slice(0, 7) !== month) continue;
    perDay[Number(e.date.slice(8, 10))] += e.amount;
  }

  const days = [];
  const spent = [];
  const projected = [];
  let acc = 0;

  for (let d = 1; d <= total; d += 1) {
    days.push(String(d));
    if (d <= elapsed) {
      acc = round2(acc + perDay[d]);
      spent.push(acc);
      // la proyección arranca donde acaba lo real, para que las líneas se unan
      projected.push(d === elapsed ? acc : null);
    } else {
      spent.push(null);
      projected.push(round2(acc + proj.perDay * (d - elapsed)));
    }
  }

  return { days, spent, projected };
}
