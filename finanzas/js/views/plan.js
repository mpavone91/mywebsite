import { el, esc, eur, pct, monthKey, monthLabel, todayISO, toast, haptic, round2 } from '../utils.js';
import {
  state, addFixedItem, updateFixedItem, deleteFixedItem,
  addExpense, addIncome, categoriesOf,
} from '../store.js';
import {
  planOverview, suggestFixedIncome, FREQUENCIES, frequencyMeta,
  monthlyAmount, declaredMonthly, averageFor,
} from '../plan.js';
import { openSheet, confirmSheet, emptyState } from '../ui.js';
import { accountChips, rememberedAccount } from './accounts.js';
import { openExpenseSheet, openIncomeSheet } from './add-movement.js';

/* ================================================================ pantalla === */

export function renderPlan() {
  const month = monthKey();
  const plan = planOverview(state, month);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Plan</h1>
          <p>Lo que entra y sale cada mes, pase lo que pase</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  if (!plan.hasPlan) {
    body.appendChild(emptyPlan());
    return screen;
  }

  body.appendChild(marginCard(plan));
  body.appendChild(breakdownCard(plan));
  if (plan.pending.length) body.appendChild(pendingCard(plan));
  body.appendChild(itemsSection('income', 'Ingresos fijos', plan.fixedIncomes));
  body.appendChild(itemsSection('expense', 'Gastos fijos', plan.fixedExpenses));

  return screen;
}

/* ------------------------------------------------------------- vacío ------ */

function emptyPlan() {
  const card = el(`
    <div class="card">
      ${emptyState('Todavía no has definido tu plan mensual.')}
      <p class="small muted center" style="margin:0 0 16px">
        Apunta lo que cobras y lo que pagas todos los meses — nómina, alquiler, cuotas,
        suscripciones — y la app te dirá cuánto te queda libre para gastar, o cuánto te
        falta por ingresar. No sustituye a tus movimientos del día a día: los complementa.
      </p>
      <div class="split">
        <button class="btn btn-primary" data-income>+ Ingreso fijo</button>
        <button class="btn" data-expense>+ Gasto fijo</button>
      </div>
    </div>
  `);
  card.querySelector('[data-income]').addEventListener('click', () => openFixedSheet({ kind: 'income' }));
  card.querySelector('[data-expense]').addEventListener('click', () => openFixedSheet({ kind: 'expense' }));
  return card;
}

/* ----------------------------------------------------------- el titular --- */

function marginCard(plan) {
  const negative = plan.margin < 0;

  return el(`
    <div class="card balance-card">
      <div class="balance-label">${negative ? 'Te faltan cada mes' : 'Te queda libre cada mes'}</div>
      <div class="balance-value num ${negative ? 'neg' : 'pos'}">
        ${eur(negative ? plan.shortfall : plan.margin)}
      </div>
      <div class="balance-sub">
        ${negative
    ? `Tendrías que ingresar <strong>${eur(plan.shortfall)}</strong> más al mes, o recortar esa cantidad de tus fijos, sólo para quedarte a cero.`
    : `Son <strong>${eur(plan.dailyAllowance)}</strong> al día para el resto de gastos`}
      </div>
      ${plan.income > 0 ? `
        <div class="bar" style="margin-top:12px;display:flex;gap:2px;background:none;border:0;height:10px">
          <i style="flex:${Math.max(plan.expense, 0.01)};background:var(--neg);border-radius:99px 0 0 99px"></i>
          <i style="flex:${Math.max(plan.quotas, 0.01)};background:var(--warn)"></i>
          <i style="flex:${Math.max(plan.margin, 0.01)};background:var(--pos);border-radius:0 99px 99px 0"></i>
        </div>
        <div class="row-between tiny muted" style="margin-top:6px">
          <span>🔴 fijos ${pct(plan.expenseShare)}</span>
          <span>🟡 deuda ${pct(plan.quotaShare)}</span>
          <span>🟢 libre ${pct(plan.marginShare)}</span>
        </div>` : ''}
    </div>
  `);
}

/* --------------------------------------------------------- el desglose --- */

function breakdownCard(plan) {
  const wrap = el(`
    <div class="card">
      <div class="metric-row">
        <span>Ingresos fijos</span>
        <span class="num pos">${eur(plan.income)}</span>
      </div>
      <div class="metric-row">
        <span>− Gastos fijos</span>
        <span class="num">${eur(plan.expense)}</span>
      </div>
      <div class="metric-row">
        <span>− Cuotas de deuda
          <span class="tiny muted" style="display:block">${plan.activeDebts
    ? `${plan.activeDebts} ${plan.activeDebts === 1 ? 'deuda viva' : 'deudas vivas'} · ${eur(plan.totalDebt)} pendientes`
    : 'sin deudas registradas'}</span>
        </span>
        <span class="num">${eur(plan.quotas)}</span>
      </div>
      <div class="metric-row" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
        <strong>= Margen del mes</strong>
        <strong class="num ${plan.margin < 0 ? 'neg' : 'pos'}">${eur(plan.margin)}</strong>
      </div>

      ${plan.margin > 0 ? `
        <div style="margin-top:14px">
          <div class="row-between small">
            <span>Gastado de ese margen en ${monthLabel(plan.month, { short: true })}</span>
            <span class="num ${plan.left < 0 ? 'neg' : ''}">${eur(plan.variableSpent)}</span>
          </div>
          <div class="bar" style="margin-top:6px">
            <i style="width:${Math.min((plan.variableSpent / plan.margin) * 100, 100).toFixed(1)}%;
                      background:${plan.left < 0 ? 'var(--neg)' : 'var(--accent)'}"></i>
          </div>
          <div class="row-between tiny muted" style="margin-top:6px">
            <span>${plan.left < 0
    ? `Te has pasado ${eur(-plan.left)}`
    : `Quedan ${eur(plan.left)}`}</span>
            <span>${plan.leftPerDay !== null && plan.left > 0
    ? `${eur(plan.leftPerDay)}/día · ${plan.daysLeft} días`
    : ''}</span>
          </div>
        </div>` : ''}

      <p class="tiny muted" style="margin:14px 0 0">
        Las cuotas de deuda salen de la pantalla Deudas, no las apuntes también como gasto fijo
        o se restarían dos veces. El gasto variable es lo de tu bolsillo que no es un fijo.
      </p>
    </div>
  `);

  return wrap;
}

/* ------------------------------------------------- fijos aún sin registrar --- */

function pendingCard(plan) {
  const card = el(`
    <div class="card insight is-info">
      <div class="icon">📋</div>
      <div style="min-width:0">
        <h3>Pendientes de registrar este mes</h3>
        <p>Ya están en el plan, pero todavía no hay movimiento en ${monthLabel(plan.month)}.</p>
        <div class="stack" data-list style="margin-top:10px;gap:8px"></div>
      </div>
    </div>
  `);

  const list = card.querySelector('[data-list]');
  for (const item of plan.pending) {
    const row = el(`
      <div class="row-between" style="gap:10px">
        <span class="grow truncate small">
          ${item.kind === 'income' ? '↑' : '↓'} ${esc(item.name)}
          <span class="muted">${eur(item.monthly)}</span>
        </span>
        <button class="btn" data-register style="min-height:34px;padding:0 12px;font-size:13px">${item.amount_mode === 'average' ? 'Apuntar' : 'Registrar'}</button>
      </div>
    `);
    const btn = row.querySelector('[data-register]');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await registerFixed(item);
        haptic(18);
        if (item.amount_mode !== 'average') toast(`${item.name} registrado`);
      } catch (err) {
        toast(err.message || 'No se pudo registrar', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = item.amount_mode === 'average' ? 'Apuntar' : 'Registrar';
      }
    });
    list.appendChild(row);
  }

  return card;
}

/**
 * Crea el movimiento real a partir del apunte del plan.
 *
 * Si el importe es variable no se puede inventar: se abre el formulario con
 * todo relleno menos la cantidad, que tiene que salir de la factura real.
 */
async function registerFixed(item) {
  const common = {
    category_id: item.category_id,
    account_id: item.account_id || rememberedAccount(item.kind),
    date: dateForItem(item),
    is_recurring: true,
  };
  const label = item.match_text?.trim() || item.name;

  if (item.amount_mode === 'average') {
    const prefill = item.kind === 'income'
      ? { ...common, source: label }
      : { ...common, note: label };
    return item.kind === 'income'
      ? openIncomeSheet({ prefill })
      : openExpenseSheet({ prefill });
  }

  const payload = { ...common, amount: monthlyAmount(item, item.estimate) };
  if (item.kind === 'income') {
    // La fuente lleva la palabra clave: es lo que los vuelve a emparejar
    return addIncome({ ...payload, source: label });
  }
  return addExpense({ ...payload, note: label });
}

/** El día del mes configurado, sin pasarse del mes ni del día de hoy. */
function dateForItem(item) {
  const today = todayISO();
  if (!item.day_of_month) return today;

  const [y, m] = monthKey().split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const day = Math.min(item.day_of_month, last);
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso > today ? today : iso;
}

/* --------------------------------------------------------------- listas --- */

function itemsSection(kind, title, items) {
  const total = round2(items.reduce((a, i) => a + i.monthly, 0));

  const section = el(`
    <div>
      <div class="section-title">${title}</div>
      <div class="card card-flush">
        ${items.length ? `<div class="day-header">
          <span>${items.length} ${items.length === 1 ? 'apunte' : 'apuntes'}</span>
          <span class="num">${eur(total)}/mes</span>
        </div>` : ''}
        <div class="list" data-list>
          ${items.length ? '' : emptyState(kind === 'income' ? 'Sin ingresos fijos.' : 'Sin gastos fijos.')}
        </div>
      </div>
      <button class="btn btn-block" data-new style="margin-top:10px">
        + ${kind === 'income' ? 'Ingreso fijo' : 'Gasto fijo'}
      </button>
    </div>
  `);

  const list = section.querySelector('[data-list]');
  for (const item of items) {
    const freq = frequencyMeta(item.frequency);
    const { source, stats } = item.estimate;

    const detail = source === 'average'
      ? `media de ${stats.count} ${stats.count === 1 ? 'registro' : 'registros'} · entre ${eur(stats.min)} y ${eur(stats.max)}`
      : source === 'estimate'
        ? 'estimado · aún sin registros'
        : `${item.frequency === 'monthly' ? '' : `${eur(item.amount)} ${freq.short} · `}${item.day_of_month ? `día ${item.day_of_month}` : 'sin día fijo'}`;

    const row = el(`
      <button class="list-item" type="button">
        <span class="dot" style="background:${item.registered ? 'var(--pos)' : 'var(--text-3)'};
                                 color:${item.registered ? 'var(--pos)' : 'var(--text-3)'}"></span>
        <span class="grow" style="min-width:0">
          <span class="truncate" style="display:block;font-weight:600">
            ${esc(item.name)}
            ${source === 'fixed' ? '' : '<span class="tiny" style="color:var(--accent);font-weight:600"> ~</span>'}
          </span>
          <span class="tiny muted">${detail}${item.registered ? ' · ✓ registrado' : ''}</span>
        </span>
        <span class="num" style="font-weight:650">${eur(item.monthly)}</span>
      </button>
    `);
    row.addEventListener('click', () => openFixedSheet({ kind, item }));
    list.appendChild(row);
  }

  section.querySelector('[data-new]').addEventListener('click', () => openFixedSheet({ kind }));
  return section;
}

/* ------------------------------------------------------ alta / edición --- */

export function openFixedSheet({ kind = 'expense', item = null } = {}) {
  const editing = Boolean(item);
  const type = item?.kind || kind;
  const cats = categoriesOf(type);
  const isIncome = type === 'income';

  return openSheet(
    editing ? 'Editar apunte fijo' : (isIncome ? 'Nuevo ingreso fijo' : 'Nuevo gasto fijo'),
    (close) => {
      let frequency = item?.frequency || 'monthly';
      let mode = item?.amount_mode || 'fixed';
      let lookback = Number(item?.lookback_months) || 6;

      const body = el(`
        <div class="stack">
          <label class="field">
            <span>Nombre</span>
            <input type="text" data-name maxlength="60" data-autofocus
                   placeholder="${isIncome ? 'Ej. Nómina' : 'Ej. Alquiler'}"
                   value="${esc(item?.name || '')}">
          </label>

          <div>
            <div class="section-title" style="margin-top:6px">El importe</div>
            <div class="chips" data-modes>
              <button type="button" class="chip" data-m="fixed" aria-pressed="${mode === 'fixed'}">
                Siempre el mismo
              </button>
              <button type="button" class="chip" data-m="average" aria-pressed="${mode === 'average'}">
                Varía cada mes
              </button>
            </div>
            <p class="tiny muted" data-mode-hint style="margin:8px 0 0"></p>
          </div>

          <label class="field">
            <span data-amount-label>Importe</span>
            <input type="number" data-amount inputmode="decimal" min="0.01" step="0.01"
                   placeholder="0,00" value="${item?.amount ?? ''}">
          </label>

          ${isIncome ? '<div data-suggest></div>' : ''}

          <div data-variable hidden>
            <label class="field">
              <span>Palabra con la que lo reconozco</span>
              <input type="text" data-match maxlength="60"
                     placeholder="${isIncome ? 'Ej. Nómina' : 'Ej. Luz'}"
                     value="${esc(item?.match_text || '')}">
              <span class="tiny muted">
                Se busca en la ${isIncome ? 'fuente' : 'nota'} de cada movimiento. Si lo dejas vacío
                se usa el nombre del apunte.
              </span>
            </label>

            <div class="section-title">Media de los últimos</div>
            <div class="chips" data-lookbacks>
              ${[3, 6, 12].map((n) => `
                <button type="button" class="chip" data-l="${n}"
                        aria-pressed="${n === lookback}">${n} meses</button>`).join('')}
            </div>

            <div class="card" data-preview style="padding:12px 14px;margin-top:12px"></div>
          </div>

          <div data-frequency>
            <div class="section-title" style="margin-top:6px">Cada cuánto</div>
            <div class="chips" data-freqs>
              ${FREQUENCIES.map((f) => `
                <button type="button" class="chip" data-f="${f.value}"
                        aria-pressed="${f.value === frequency}">${f.label}</button>`).join('')}
            </div>
            <p class="tiny muted" data-freq-hint style="margin:8px 0 0"></p>
          </div>

          <label class="field">
            <span>Categoría</span>
            <select data-category>
              <option value="">Sin categoría</option>
              ${cats.map((c) => `<option value="${c.id}" ${item?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>

          <div data-accounts-block hidden>
            <div class="section-title">${isIncome ? 'Entra en' : 'Se paga desde'}</div>
            <div data-accounts></div>
          </div>

          <label class="field">
            <span>Día del mes (opcional)</span>
            <input type="number" data-day min="1" max="31" step="1" inputmode="numeric"
                   placeholder="Ej. 1" value="${item?.day_of_month || ''}">
          </label>

          ${editing ? `
            <label class="switch card" style="padding:12px 14px">
              <span>
                <strong style="font-size:15px">Activo</strong>
                <span class="tiny muted" style="display:block">Desactívalo si dejas de tenerlo, sin borrar el histórico</span>
              </span>
              <input type="checkbox" data-active ${item.is_active ? 'checked' : ''}>
            </label>` : ''}

          <button class="btn btn-primary btn-block btn-lg" data-save>
            ${editing ? 'Guardar cambios' : 'Añadir al plan'}
          </button>
          ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar del plan</button>' : ''}
        </div>
      `);

      const accounts = accountChips(item?.account_id ?? null);
      if (accounts) {
        body.querySelector('[data-accounts]').appendChild(accounts.node);
        body.querySelector('[data-accounts-block]').hidden = false;
      }

      /* --- periodicidad --------------------------------------------------- */
      const amountInput = body.querySelector('[data-amount]');
      const hint = body.querySelector('[data-freq-hint]');

      const paintFreq = () => {
        body.querySelectorAll('[data-f]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.f === frequency));
        });
        const value = Number(amountInput.value) || 0;
        const monthly = round2(value * frequencyMeta(frequency).factor);
        hint.textContent = frequency === 'monthly' || !value
          ? 'El plan trabaja con el equivalente mensual de cada apunte.'
          : `Equivale a ${eur(monthly)} al mes.`;
        if (mode === 'average') paintPreview();
      };

      body.querySelectorAll('[data-f]').forEach((btn) => {
        btn.addEventListener('click', () => {
          frequency = btn.dataset.f;
          haptic(8);
          paintFreq();
        });
      });
      amountInput.addEventListener('input', paintFreq);

      /* --- importe variable: vista previa de lo que reconoce --------------- */
      const variableBlock = body.querySelector('[data-variable]');
      const frequencyBlock = body.querySelector('[data-frequency]');
      const modeHint = body.querySelector('[data-mode-hint]');
      const amountLabel = body.querySelector('[data-amount-label]');
      const preview = body.querySelector('[data-preview]');
      const matchInput = body.querySelector('[data-match]');

      function paintPreview() {
        const probe = {
          kind: type,
          name: body.querySelector('[data-name]').value.trim() || 'x',
          match_text: matchInput.value.trim(),
          lookback_months: lookback,
        };
        const stats = averageFor(probe, { expenses: state.expenses, incomes: state.incomes });

        preview.replaceChildren(el(stats ? `
          <div>
            <div class="tiny muted">Media calculada</div>
            <div class="row-between" style="margin-top:2px">
              <strong class="num" style="font-size:18px">${eur(stats.monthly)}/mes</strong>
              <span class="tiny muted">${stats.count} ${stats.count === 1 ? 'movimiento' : 'movimientos'}</span>
            </div>
            <div class="tiny muted" style="margin-top:4px">
              Repartido entre ${stats.span} ${stats.span === 1 ? 'mes' : 'meses'}
              · entre ${eur(stats.min)} y ${eur(stats.max)} al mes
            </div>
          </div>` : `
          <div class="tiny muted">
            Todavía no encuentro movimientos con esa palabra. Hasta que los haya, el plan
            usará el importe de arriba como estimación.
          </div>`));
      }

      function paintMode() {
        body.querySelectorAll('[data-m]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.m === mode));
        });
        const average = mode === 'average';
        variableBlock.hidden = !average;
        frequencyBlock.hidden = average;
        amountLabel.textContent = average ? 'Estimación mientras no haya datos' : 'Importe';
        modeHint.textContent = average
          ? 'La luz, una nómina con comisiones, lo que reparte un negocio: el plan usará la media de lo que vayas registrando.'
          : 'El alquiler, una cuota, una suscripción: siempre el mismo importe.';
        if (average) {
          frequency = 'monthly';
          paintPreview();
        }
        paintFreq();
      }

      body.querySelectorAll('[data-m]').forEach((btn) => {
        btn.addEventListener('click', () => { mode = btn.dataset.m; haptic(8); paintMode(); });
      });
      body.querySelectorAll('[data-l]').forEach((btn) => {
        btn.addEventListener('click', () => {
          lookback = Number(btn.dataset.l);
          body.querySelectorAll('[data-l]').forEach((b) => {
            b.setAttribute('aria-pressed', String(Number(b.dataset.l) === lookback));
          });
          haptic(8);
          paintPreview();
        });
      });
      matchInput.addEventListener('input', paintPreview);
      body.querySelector('[data-name]').addEventListener('input', () => {
        if (mode === 'average' && !matchInput.value.trim()) paintPreview();
      });

      paintMode();

      /* --- sugerencia de ingreso a partir del histórico -------------------- */
      if (isIncome) {
        const suggestion = suggestFixedIncome(state.incomes, state.accounts);
        if (suggestion) {
          const box = el(`
            <div class="card" style="padding:12px 14px">
              <div class="tiny muted">Media de tus ingresos registrados</div>
              <div class="row-between" style="margin-top:2px">
                <strong class="num" style="font-size:18px">${eur(suggestion.average)}/mes</strong>
                <button class="btn" data-use style="min-height:34px;padding:0 12px;font-size:13px">Usar</button>
              </div>
              <div class="tiny muted" style="margin-top:4px">
                Sobre ${suggestion.months} ${suggestion.months === 1 ? 'mes' : 'meses'} con datos
                · entre ${eur(suggestion.min)} y ${eur(suggestion.max)}
              </div>
            </div>
          `);
          box.querySelector('[data-use]').addEventListener('click', () => {
            amountInput.value = String(suggestion.average);
            frequency = 'monthly';
            paintFreq();
            haptic(8);
          });
          body.querySelector('[data-suggest]').appendChild(box);
        }
      }

      /* --- guardar --------------------------------------------------------- */
      const saveBtn = body.querySelector('[data-save]');
      saveBtn.addEventListener('click', async () => {
        const name = body.querySelector('[data-name]').value.trim();
        const amount = Number(amountInput.value);
        const day = Number(body.querySelector('[data-day]').value);

        if (!name) { toast('Ponle un nombre al apunte', 'err'); return; }
        if (!(amount > 0)) { toast('El importe tiene que ser mayor que 0', 'err'); return; }
        if (body.querySelector('[data-day]').value && (day < 1 || day > 31)) {
          toast('El día tiene que estar entre 1 y 31', 'err'); return;
        }

        const payload = {
          kind: type,
          name,
          amount,
          frequency: mode === 'average' ? 'monthly' : frequency,
          amount_mode: mode,
          match_text: body.querySelector('[data-match]').value.trim() || null,
          lookback_months: lookback,
          category_id: body.querySelector('[data-category]').value || null,
          account_id: accounts?.value ?? null,
          day_of_month: day || null,
        };
        if (editing) payload.is_active = body.querySelector('[data-active]').checked;

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span>';
        try {
          if (editing) await updateFixedItem(item.id, payload);
          else await addFixedItem(payload);
          close(true);
          toast(editing ? 'Apunte actualizado' : 'Añadido al plan');
        } catch (err) {
          toast(err.message || 'No se pudo guardar', 'err');
          saveBtn.disabled = false;
          saveBtn.textContent = editing ? 'Guardar cambios' : 'Añadir al plan';
        }
      });

      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmSheet(
          'Eliminar del plan',
          `Se quitará "${item.name}" del plan. Los movimientos que ya registraste se mantienen.`,
        );
        if (!ok) return;
        try {
          await deleteFixedItem(item.id);
          close(true);
          toast('Eliminado del plan');
        } catch (err) {
          toast(err.message || 'No se pudo eliminar', 'err');
        }
      });

      return body;
    },
  );
}
