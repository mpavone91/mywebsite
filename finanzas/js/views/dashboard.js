import {
  el, esc, eur, eurSigned, pct, monthKey, monthLabel, todayISO, dayLabel, groupBy, sum, round2,
} from '../utils.js';
import {
  state, personalData, categoryById, accountById, isBusiness, closingForDate, myBusinessDebt,
} from '../store.js';
import {
  monthTotals, categoryBreakdown, prevMonthPace, projection, missingRecurringIncomes,
} from '../analysis.js';
import { categoryDonut } from '../charts.js';
import { openExpenseSheet, openIncomeSheet } from './add-movement.js';
import { openTransferSheet } from './accounts.js';
import { accountsOverview } from '../accounts.js';
import { planOverview } from '../plan.js';
import { takings, monthResult, closingTotal } from '../closings.js';
import { partnerBalances } from '../partners.js';
import { breakEven } from '../breakeven.js';
import { workspacePill } from './workspaces.js';
import { openClosingSheet } from './closings.js';
import { openPaymentSheet } from './debts.js';
import { debtsOverview, daysUntil, simulatePayoff } from '../debts.js';
import { emptyState } from '../ui.js';

/** Home: saldo de hoy, saldo del mes y los dos botones de alta rápida. */
export function renderDashboard() {
  const month = monthKey();
  const today = todayISO();
  // Sólo lo que sale de tu bolsillo: el dinero del negocio va aparte
  const { expenses, incomes, categories } = personalData();
  const accounts = accountsOverview(state, month);

  const business = isBusiness();
  const sales = takings(state.closings, month);
  const result = monthResult(state.closings, state.expenses, month);
  const hoyCierre = closingForDate(today);
  const todayTakings = hoyCierre ? closingTotal(hoyCierre) : 0;

  const t = monthTotals(month, expenses, incomes);
  const rows = categoryBreakdown(month, expenses, categories);
  const pace = prevMonthPace(month, expenses);
  const proj = projection(month, expenses, incomes);

  const todayExpense = round2(sum(expenses.filter((e) => e.date === today), (e) => e.amount));
  const todayIncome = round2(sum(incomes.filter((i) => i.date === today), (i) => i.amount));
  const todayBalance = round2(todayIncome - todayExpense);

  // % del ingreso ya consumido — la barra de "cuánto llevo gastado"
  const burn = t.income > 0 ? Math.min(t.expense / t.income, 1) : (t.expense > 0 ? 1 : 0);
  const overspending = t.income > 0 && t.expense > t.income;

  const paceDelta = pace.expense > 0 ? t.expense / pace.expense - 1 : null;
  const paceText = paceDelta === null
    ? 'Sin datos del mes pasado'
    : `${paceDelta >= 0 ? '+' : '−'}${pct(Math.abs(paceDelta))} vs ${monthLabel(pace.month, { short: true })}`;

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>${monthLabel(month)}</h1>
          <p>${dayLabel(today)} · ${t.expenseCount} ${t.expenseCount === 1 ? 'gasto' : 'gastos'} este mes</p>
        </div>
        <span class="row" style="gap:8px">
          <span data-workspace></span>
          <button class="btn btn-ghost" data-account aria-label="Tu cuenta"
                  style="min-height:38px;padding:0 10px;font-size:20px">⚙︎</button>
        </span>
      </div>

      <div class="stack">
        ${business ? `
        <div class="card balance-card">
          <div class="balance-label">Resultado de ${monthLabel(month)}</div>
          <div class="balance-value num ${result.result < 0 ? 'neg' : 'pos'}">${eur(result.result)}</div>
          <div class="balance-sub">
            ${eur(result.income)} facturados · ${eur(result.expense)} de gastos
          </div>
          <div class="bar" style="margin-top:12px">
            <i style="width:${result.income > 0 ? Math.min((result.expense / result.income) * 100, 100).toFixed(1) : 0}%;
                      background:${result.result < 0 ? 'var(--neg)' : 'var(--accent)'}"></i>
          </div>
          <div class="row-between tiny muted" style="margin-top:6px">
            <span>${sales.closings} ${sales.closings === 1 ? 'día con parte' : 'días con parte'}</span>
            <span>${result.margin !== null ? `margen ${pct(result.margin)}` : 'sin facturación'}</span>
          </div>
        </div>` : `
        <div class="card balance-card">
          <div class="balance-label">Gastado este mes</div>
          <div class="balance-value num ${overspending ? 'neg' : ''}">${eur(t.expense)}</div>
          <div class="balance-sub">
            de ${eur(t.income)} ingresados ·
            saldo <strong class="num ${t.balance < 0 ? 'neg' : 'pos'}">${eurSigned(t.balance)}</strong>
          </div>
          <div class="bar" style="margin-top:12px">
            <i style="width:${(burn * 100).toFixed(1)}%;background:${overspending ? 'var(--neg)' : 'var(--accent)'}"></i>
          </div>
          <div class="row-between tiny muted" style="margin-top:6px">
            <span>${t.income > 0 ? `${pct(t.expense / t.income)} de tus ingresos` : 'Sin ingresos registrados'}</span>
            <span>${paceText}</span>
          </div>
        </div>`}

        <div class="split">
          ${business ? `
          <div class="card stat">
            <div class="k">Facturado hoy</div>
            <div class="v num pos">${eur(todayTakings)}</div>
            <div class="tiny muted">${hoyCierre ? 'parte apuntado' : 'sin parte todavía'}</div>
          </div>` : `
          <div class="card stat">
            <div class="k">Saldo de hoy</div>
            <div class="v num ${todayBalance < 0 ? 'neg' : todayBalance > 0 ? 'pos' : ''}">${eurSigned(todayBalance)}</div>
            <div class="tiny muted">${eur(todayExpense)} gastado${todayIncome > 0 ? ` · ${eur(todayIncome)} ingresado` : ''}</div>
          </div>`}
          ${business ? `
          <div class="card stat">
            <div class="k">${sales.projected ? 'Facturación prevista' : 'Media por día'}</div>
            <div class="v num">${sales.closings ? eur(sales.projected || sales.average, true) : '—'}</div>
            <div class="tiny muted">${sales.closings
    ? (sales.projected
      ? `a ${eur(sales.average)} por día con parte`
      : 'media de los días con parte')
    : 'sin partes este mes'}</div>
          </div>` : `
          <div class="card stat">
            <div class="k">${proj && !proj.isClosed ? 'Cierre previsto' : 'Media diaria'}</div>
            <div class="v num">${proj ? eur(proj.isClosed ? proj.perDay : proj.projected, true) : '—'}</div>
            <div class="tiny muted">${proj && !proj.isClosed
    ? `a ${eur(proj.perDay)}/día · quedan ${proj.daysLeft} días`
    : 'gasto medio por día'}</div>
          </div>`}
        </div>

        <div class="quick-actions">
          ${business ? `
          <button class="quick quick-expense" data-add-closing>
            ${hoyCierre ? 'Cierre de hoy' : '+ Cierre'}
            <small>${hoyCierre ? `Apuntado: ${eur(todayTakings)}` : 'El parte del día'}</small>
          </button>
          <button class="quick quick-income" data-add-expense>
            + Gasto
            <small>Del negocio</small>
          </button>` : `
          <button class="quick quick-expense" data-add-expense>
            + Gasto
            <small>Importe, categoría, listo</small>
          </button>
          <button class="quick quick-income" data-add-income>
            + Ingreso
            <small>Nómina y otros</small>
          </button>`}
        </div>

        <div data-plan-strip></div>
        <div data-accounts-strip></div>

        <div data-partner-strip></div>
        <div data-debt-strip></div>
        <div data-reminders class="stack"></div>

        <div>
          <div class="section-title">Gasto por categoría</div>
          <div class="card" data-donut-card>
            ${rows.length ? `
              <div class="chart-wrap"><canvas data-donut></canvas></div>
              <div class="legend">
                ${rows.slice(0, 5).map((r) => `
                  <div class="legend-item">
                    <span class="dot" style="background:${esc(r.color)};color:${esc(r.color)}"></span>
                    <span class="grow truncate">${esc(r.name)}</span>
                    <span class="num">${eur(r.total)}</span>
                    <span class="tiny muted num" style="width:44px;text-align:right">${pct(r.share)}</span>
                  </div>`).join('')}
                ${rows.length > 5 ? `<div class="legend-item tiny muted">+ ${rows.length - 5} categorías más</div>` : ''}
              </div>` : emptyState('Aún no hay gastos este mes.')}
          </div>
        </div>

        <div>
          <div class="section-title">Últimos movimientos</div>
          <div class="card card-flush" data-recent></div>
        </div>
      </div>
    </div>
  `);

  /* --- socios ------------------------------------------------------------ */
  const partnerStrip = screen.querySelector('[data-partner-strip]');

  // Cuánto hay que facturar para cubrir el mes: es la cifra que se busca de un
  // vistazo, antes que cualquier otra.
  if (business) {
    const meta = breakEven(
      { ...state, profitGoal: Number(state.workspaces.find((w) => w.id === state.workspaceId)?.profit_goal || 0) },
      month,
    );
    if (meta.minimum > 0) {
      const cubierto = meta.overMinimum >= 0;
      partnerStrip.appendChild(el(`
        <a href="#/plan" class="card" style="text-decoration:none;color:inherit;padding:14px 16px;display:block">
          <div class="row-between">
            <span class="tiny muted">Para cubrir ${monthLabel(month, { short: true })} hay que facturar</span>
            <span class="muted">›</span>
          </div>
          <div class="row-between" style="margin-top:4px">
            <span class="num" style="font-weight:700;font-size:18px">${eur(meta.minimum)}</span>
            <span class="small ${cubierto ? 'pos' : ''}" style="font-weight:600">
              ${cubierto ? `+${eur(meta.overMinimum)}` : `faltan ${eur(meta.missingToMinimum)}`}
            </span>
          </div>
          <div class="bar" style="margin-top:8px">
            <i style="width:${Math.min((meta.coverage || 0) * 100, 100).toFixed(1)}%;
                      background:${cubierto ? 'var(--pos)' : 'var(--accent)'}"></i>
          </div>
          <div class="tiny muted" style="margin-top:6px">
            ${eur(meta.minimumPerDay)} por día abierto${meta.profitGoal > 0
    ? ` · ${eur(meta.targetPerDay)} para ganar ${eur(meta.profitGoal)}`
    : ''}
          </div>
        </a>
      `));
    }
  }

  if (business) {
    // En el negocio: cuánto ha sacado cada socio, que es la pregunta que se hace
    const socios = partnerBalances(state, month);
    if (socios.active) {
      const strip = el(`
        <a href="#/socios" class="card" style="text-decoration:none;color:inherit;padding:14px 16px;display:block">
          <div class="row-between">
            <span class="tiny muted">Han sacado los socios</span>
            <span class="tiny muted">${socios.drawnThisMonth > 0 ? `${eur(socios.drawnThisMonth)} este mes` : ''} ›</span>
          </div>
          <div class="stack" style="gap:8px;margin-top:10px" data-rows></div>
        </a>
      `);
      const rows = strip.querySelector('[data-rows]');
      for (const socio of socios.rows.filter((r) => r.movements)) {
        rows.appendChild(el(`
          <div class="row-between" style="gap:10px">
            <span class="row" style="gap:8px;min-width:0">
              <span class="dot" style="background:${esc(socio.color)};flex:none"></span>
              <span class="truncate">${esc(socio.name)}</span>
            </span>
            <span class="num" style="font-weight:650">${eur(socio.balance)}</span>
          </div>
        `));
      }
      partnerStrip.appendChild(strip);
    }
  } else {
    // En lo personal: lo que le debes tú al negocio, que vive en el otro espacio
    const mio = myBusinessDebt();
    if (mio && Math.abs(mio.balance) >= 0.01) {
      partnerStrip.appendChild(el(`
        <div class="card row-between" style="padding:14px 16px">
          <span class="grow" style="min-width:0">
            <span class="tiny muted" style="display:block">
              ${mio.balance > 0 ? 'Le debes al negocio' : 'El negocio te debe'}
            </span>
            <span class="num" style="font-weight:700;font-size:18px">${eur(Math.abs(mio.balance))}</span>
          </span>
          <span class="tiny muted" style="text-align:right;max-width:45%">
            De lo que has pagado con dinero del local
          </span>
        </div>
      `));
    }
  }

  /* --- recordatorios ---------------------------------------------------- */
  const reminders = screen.querySelector('[data-reminders]');

  const debts = debtsOverview(state.debts, state.debtPayments);

  // Resumen de deuda siempre a la vista, con la fecha de salida al ritmo actual
  if (debts.active.length) {
    const plan = simulatePayoff(debts.active, { extra: 0 });
    const strip = el(`
      <a href="#/deudas" class="card row-between" style="text-decoration:none;color:inherit;padding:14px 16px">
        <span class="grow" style="min-width:0">
          <span class="tiny muted" style="display:block">Deuda pendiente</span>
          <span class="num" style="font-weight:700;font-size:18px">${eur(debts.balance)}</span>
        </span>
        <span style="text-align:right">
          <span class="tiny muted" style="display:block">${plan.stalls ? 'Con los mínimos' : 'Libre en'}</span>
          <span class="small" style="font-weight:600">${plan.stalls ? 'no baja' : monthLabel(plan.payoffMonth)}</span>
        </span>
        <span class="muted" style="margin-left:8px">›</span>
      </a>
    `);
    screen.querySelector('[data-debt-strip]').appendChild(strip);
  }

  // Deudas que vencen en los próximos días (o que ya se han pasado)
  for (const debt of debts.active) {
    const days = daysUntil(debt.nextDueDate);
    if (days === null || days > 5) continue;

    const late = days < 0;
    const when = late ? `venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`
      : days === 0 ? 'vence hoy'
        : days === 1 ? 'vence mañana'
          : `vence en ${days} días`;

    const card = el(`
      <div class="card insight ${late ? 'is-alert' : 'is-warn'}">
        <div class="icon">${late ? '⚠️' : '📌'}</div>
        <div>
          <h3>${esc(debt.name)}: la cuota ${when}</h3>
          <p>${debt.minimum_payment > 0 ? `${eur(debt.minimum_payment)} de cuota. ` : ''}Te quedan ${eur(debt.balance)} por pagar.</p>
          <div class="action"><button class="btn btn-primary" data-pay>Registrar pago</button></div>
        </div>
      </div>
    `);
    card.querySelector('[data-pay]').addEventListener('click', () => openPaymentSheet(debt.id));
    reminders.appendChild(card);
  }
  for (const pending of missingRecurringIncomes(month, incomes)) {
    const card = el(`
      <div class="card insight is-info">
        <div class="icon">📅</div>
        <div>
          <h3>Falta apuntar "${esc(pending.source)}"</h3>
          <p>El mes pasado fueron ${eur(pending.amount)}. Si ya te ha entrado, regístralo.</p>
          <div class="action"><button class="btn btn-primary" data-add>Añadir ${eur(pending.amount)}</button></div>
        </div>
      </div>
    `);
    card.querySelector('[data-add]').addEventListener('click', () => {
      openIncomeSheet({ prefill: { ...pending, is_recurring: true } });
    });
    reminders.appendChild(card);
  }

  /* --- movimientos recientes ------------------------------------------- */
  screen.querySelector('[data-recent]').appendChild(recentMovements());

  /* --- acciones --------------------------------------------------------- */
  /* --- tira del plan ---------------------------------------------------- */
  const planView = planOverview(state, month);
  if (planView.hasPlan) {
    const negative = planView.margin < 0;
    const strip = el(`
      <a href="#/plan" class="card row-between" style="text-decoration:none;color:inherit;padding:14px 16px">
        <span class="grow" style="min-width:0">
          <span class="tiny muted" style="display:block">
            ${negative ? 'Te faltan al mes' : planView.margin > 0 && planView.variableSpent > 0 ? 'Te queda del margen' : 'Libre tras los fijos'}
          </span>
          <span class="num ${negative || planView.left < 0 ? 'neg' : 'pos'}" style="font-weight:700;font-size:18px">
            ${eur(negative ? planView.shortfall : (planView.variableSpent > 0 ? planView.left : planView.margin))}
          </span>
        </span>
        <span style="text-align:right">
          <span class="tiny muted" style="display:block">${negative ? 'Ingresos fijos' : 'Al día'}</span>
          <span class="small" style="font-weight:600">
            ${negative ? eur(planView.income, true) : planView.leftPerDay !== null && planView.left > 0
    ? `${eur(planView.leftPerDay)}/día` : eur(planView.dailyAllowance) + '/día'}
          </span>
        </span>
        <span class="muted" style="margin-left:8px">›</span>
      </a>
    `);
    screen.querySelector('[data-plan-strip]').appendChild(strip);
  }

  /* --- tira de cuentas -------------------------------------------------- */
  if (accounts.rows.length) {
    const strip = el(`
      <div class="card row-between" style="padding:12px 14px;gap:12px">
        <span style="min-width:0">
          <span class="tiny muted" style="display:block">Disponible</span>
          <strong class="num" style="font-size:17px">${eur(accounts.available)}</strong>
          ${accounts.businessMonthSpend > 0
    ? `<span class="tiny muted" style="display:block">${eur(accounts.businessMonthSpend)} gastados del negocio este mes</span>`
    : ''}
        </span>
        <button class="btn" data-transfer style="min-height:38px;padding:0 12px">↔ Traspaso</button>
      </div>
    `);
    strip.querySelector('[data-transfer]').addEventListener('click', () => openTransferSheet({}));
    screen.querySelector('[data-accounts-strip]').appendChild(strip);
  }

  screen.querySelector('[data-add-expense]').addEventListener('click', () => openExpenseSheet());
  screen.querySelector('[data-add-income]')?.addEventListener('click', () => openIncomeSheet());
  screen.querySelector('[data-add-closing]')?.addEventListener('click', () => {
    openClosingSheet({ closing: hoyCierre });
  });

  const pill = workspacePill({ onSwitch: () => document.dispatchEvent(new CustomEvent('switch-workspace')) });
  if (pill) screen.querySelector('[data-workspace]').appendChild(pill);
  screen.querySelector('[data-account]').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-account'));
  });

  // El donut necesita estar en el DOM para medir el canvas
  if (rows.length) {
    queueMicrotask(() => {
      const canvas = screen.querySelector('[data-donut]');
      if (canvas?.isConnected) categoryDonut(canvas, rows);
    });
  }

  return screen;
}

/** Lista de los últimos movimientos, agrupados por día con su cierre diario. */
export function recentMovements(limit = 12) {
  const all = [
    ...state.expenses.map((e) => ({ ...e, kind: 'expense', label: e.note })),
    ...state.incomes.map((i) => ({ ...i, kind: 'income', label: i.source })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1)))
    .slice(0, limit);

  if (!all.length) {
    return el(`<div>${emptyState('Todavía no hay movimientos. Empieza con “+ Gasto”.')}</div>`);
  }

  const wrap = el('<div class="list"></div>');

  for (const [date, items] of groupBy(all, (m) => m.date)) {
    const balance = round2(sum(items, (m) => (m.kind === 'income' ? m.amount : -m.amount)));
    wrap.appendChild(el(`
      <div class="day-header">
        <span>${esc(dayLabel(date))}</span>
        <span class="num ${balance < 0 ? 'neg' : 'pos'}">${eurSigned(balance)}</span>
      </div>
    `));

    for (const m of items) {
      const cat = categoryById(m.category_id);
      const color = cat?.color || (m.kind === 'income' ? 'var(--pos)' : '#94a3b8');
      const title = m.label || cat?.name || (m.kind === 'income' ? 'Ingreso' : 'Gasto');
      const account = accountById(m.account_id);
      const parts = [cat && m.label ? cat.name : null, account?.name].filter(Boolean);
      const subtitle = parts.length ? parts.join(' · ') : (m.is_recurring ? 'Recurrente' : '');

      const row = el(`
        <button class="list-item" type="button">
          <span class="dot" style="background:${esc(color)};color:${esc(color)}"></span>
          <span class="grow" style="min-width:0">
            <span class="truncate" style="display:block;font-weight:600">${esc(title)}</span>
            ${subtitle ? `<span class="tiny muted truncate" style="display:block">${esc(subtitle)}${m.is_recurring && subtitle !== 'Recurrente' ? ' · 🔁' : ''}</span>` : ''}
          </span>
          <span class="num" style="font-weight:650;color:${m.kind === 'income' ? 'var(--pos)' : 'inherit'}">
            ${m.kind === 'income' ? '+' : '−'}${eur(m.amount)}
          </span>
        </button>
      `);
      row.addEventListener('click', () => {
        if (m.kind === 'income') openIncomeSheet({ movement: m });
        else openExpenseSheet({ movement: m });
      });
      wrap.appendChild(row);
    }
  }

  return wrap;
}
