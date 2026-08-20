import { el, esc, eur, pct, todayISO, dayLabel, monthLabel, toast, haptic, round2 } from '../utils.js';
import { state, addDebt, updateDebt, deleteDebt, addDebtPayment, deleteDebtPayment, categoriesOf } from '../store.js';
import {
  debtsOverview, debtStatus, simulatePayoff, comparePlans, monthlyCapacity,
  extraOptions, daysUntil, DEBT_KINDS, kindLabel,
} from '../debts.js';
import { openSheet, confirmSheet, emptyState, amountKeypad } from '../ui.js';
import { accountChips, rememberedAccount } from './accounts.js';

/* ================================================================ pantalla === */

export function renderDebts() {
  const view = debtsOverview(state.debts, state.debtPayments);
  const { capacity, months: capMonths } = monthlyCapacity(state.expenses, state.incomes);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Deudas</h1>
          <p>${view.active.length
            ? `${view.active.length} ${view.active.length === 1 ? 'deuda viva' : 'deudas vivas'} · plan de salida`
            : 'Controla tus pagos pendientes'}</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  if (!view.rows.length) {
    body.appendChild(el(`
      <div class="card">
        ${emptyState('Aún no has registrado ninguna deuda.')}
        <p class="small muted center" style="margin:0 0 16px">
          Apunta lo que debes y cada pago que hagas. La app calcula el saldo pendiente,
          cuándo terminarás de pagar y cuánto conviene aportar de más para salir antes.
        </p>
        <button class="btn btn-primary btn-block btn-lg" data-new>+ Añadir mi primera deuda</button>
      </div>
    `));
    body.querySelector('[data-new]').addEventListener('click', () => openDebtSheet({}));
    return screen;
  }

  /* --- resumen ---------------------------------------------------------- */
  body.appendChild(el(`
    <div class="card balance-card">
      <div class="balance-label">Pendiente de pagar</div>
      <div class="balance-value num ${view.balance > 0 ? 'neg' : 'pos'}">${eur(view.balance)}</div>
      <div class="balance-sub">
        de ${eur(view.initial)} · ya has amortizado <strong class="num pos">${eur(view.paid)}</strong>
      </div>
      <div class="bar" style="margin-top:12px">
        <i style="width:${(view.progress * 100).toFixed(1)}%;background:var(--pos)"></i>
      </div>
      <div class="row-between tiny muted" style="margin-top:6px">
        <span>${pct(view.progress)} pagado</span>
        <span>${view.settled.length} ${view.settled.length === 1 ? 'deuda liquidada' : 'deudas liquidadas'}</span>
      </div>
    </div>
  `));

  body.appendChild(el(`
    <div class="split">
      <div class="card stat">
        <div class="k">Cuotas al mes</div>
        <div class="v num">${eur(view.minimums)}</div>
        <div class="tiny muted">mínimos de todas tus deudas</div>
      </div>
      <div class="card stat">
        <div class="k">Intereses al mes</div>
        <div class="v num ${view.monthlyInterest > 0 ? 'neg' : ''}">${eur(view.monthlyInterest)}</div>
        <div class="tiny muted">${view.worstRate > 0 ? `peor TAE: ${String(view.worstRate).replace('.', ',')} %` : 'sin intereses'}</div>
      </div>
    </div>
  `));

  /* --- plan de salida --------------------------------------------------- */
  if (view.active.length) {
    body.appendChild(payoffPlanner(view, capacity, capMonths));
  }

  /* --- listado ---------------------------------------------------------- */
  const list = el('<div><div class="section-title">Tus deudas</div><div class="stack" data-list></div></div>');
  const listBody = list.querySelector('[data-list]');
  for (const debt of view.rows) listBody.appendChild(debtCard(debt));
  body.appendChild(list);

  const addBtn = el('<button class="btn btn-block" data-new>+ Nueva deuda</button>');
  addBtn.addEventListener('click', () => openDebtSheet({}));
  body.appendChild(addBtn);

  return screen;
}

/* ------------------------------------------------------ plan de salida --- */

function payoffPlanner(view, capacity, capMonths) {
  let strategy = 'avalanche';
  let extra = capacity;

  const maxExtra = Math.max(round2(capacity * 2), 100);
  const options = extraOptions(view.active, capacity);

  const card = el(`
    <div>
      <div class="section-title">Plan de salida</div>
      <div class="card stack">
        <div class="chips" data-strategy>
          <button type="button" class="chip" data-s="avalanche" aria-pressed="true">🏔️ Avalancha</button>
          <button type="button" class="chip" data-s="snowball" aria-pressed="false">❄️ Bola de nieve</button>
        </div>
        <p class="tiny muted" data-strategy-help style="margin:0"></p>

        <div>
          <div class="row-between small">
            <span>Aportación extra al mes</span>
            <strong class="num" data-extra-label></strong>
          </div>
          <input type="range" data-extra min="0" max="${maxExtra}" step="5" value="${Math.min(extra, maxExtra)}"
                 style="width:100%;margin-top:8px;accent-color:var(--accent)">
          <div class="row-between tiny muted">
            <span>0 €</span>
            <span>${eur(maxExtra, true)}</span>
          </div>
          ${capacity > 0 ? `<p class="tiny muted" style="margin:8px 0 0">
            Te han sobrado ${eur(capacity)} de media al mes (últimos ${capMonths} ${capMonths === 1 ? 'mes' : 'meses'}, con un colchón del 20 % reservado).
          </p>` : `<p class="tiny muted" style="margin:8px 0 0">
            Aún no tienes suficientes meses cerrados para calcular cuánto te sobra. Mueve la barra para simular.
          </p>`}
        </div>

        <div data-result></div>
      </div>
    </div>
  `);

  const result = card.querySelector('[data-result]');
  const slider = card.querySelector('[data-extra]');
  const extraLabel = card.querySelector('[data-extra-label]');
  const help = card.querySelector('[data-strategy-help]');

  function paint() {
    extraLabel.textContent = eur(extra);
    help.textContent = strategy === 'avalanche'
      ? 'Ataca primero la deuda con el interés más alto: es la que menos intereses te hace pagar en total.'
      : 'Ataca primero la deuda más pequeña: liquidas una antes y se hace más llevadero, aunque suele salir algo más caro.';

    const plan = simulatePayoff(view.active, { extra, strategy });
    const plans = comparePlans(view.active, extra);
    const base = plans.baseline;

    result.replaceChildren(el(`
      <div>
        ${plan.stalls ? `
          <div class="insight is-alert" style="padding:12px 0">
            <div class="icon">🚨</div>
            <div>
              <h3>Así no llegas a liquidarlas</h3>
              <p>Con ${eur(plan.monthlyOutlay)} al mes los intereses se comen el pago y el saldo no baja. Sube la aportación extra.</p>
            </div>
          </div>` : `
          <div class="center" style="padding:6px 0 10px">
            <div class="tiny muted">Libre de deudas en</div>
            <div style="font-size:26px;font-weight:700;letter-spacing:-.02em">${monthLabel(plan.payoffMonth)}</div>
            <div class="tiny muted">${plan.months} ${plan.months === 1 ? 'mes' : 'meses'} · ${eur(plan.monthlyOutlay)}/mes</div>
          </div>
          <div class="metric-row"><span>Intereses que pagarías</span><span class="num">${eur(plan.totalInterest)}</span></div>
          ${!base.stalls && extra > 0 ? `
            <div class="metric-row">
              <span>Frente a pagar sólo mínimos</span>
              <span class="num pos">${base.months - plan.months} meses antes</span>
            </div>
            <div class="metric-row">
              <span>Intereses que te ahorras</span>
              <span class="num pos">${eur(round2(base.totalInterest - plan.totalInterest))}</span>
            </div>` : ''}
          ${base.stalls && extra > 0 ? `
            <div class="metric-row"><span>Con sólo los mínimos</span><span class="neg">no saldrías nunca</span></div>` : ''}
        `}

        ${plan.lines.filter((l) => l.payoffLabel).length ? `
          <div class="section-title" style="margin:16px 0 8px">Orden de liquidación</div>
          ${plan.lines
            .filter((l) => l.payoffLabel)
            .sort((a, b) => a.payoffMonth - b.payoffMonth)
            .map((l, i) => `
              <div class="metric-row">
                <span><strong>${i + 1}.</strong> ${esc(l.name)}</span>
                <span class="num muted">${esc(l.payoffLabel)}</span>
              </div>`).join('')}` : ''}
      </div>
    `));
  }

  card.querySelectorAll('[data-s]').forEach((btn) => {
    btn.addEventListener('click', () => {
      strategy = btn.dataset.s;
      card.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === strategy)));
      haptic(8);
      paint();
    });
  });

  slider.addEventListener('input', () => { extra = Number(slider.value); paint(); });

  // Atajos con los escalones calculados sobre lo que le sobra
  if (options.length) {
    const chips = el(`<div class="chips" style="margin-top:10px">
      ${options.map((o) => `<button type="button" class="chip" data-level="${o.extra}">+${eur(o.extra, true)}</button>`).join('')}
    </div>`);
    chips.querySelectorAll('[data-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        extra = Number(btn.dataset.level);
        slider.value = String(Math.min(extra, maxExtra));
        haptic(8);
        paint();
      });
    });
    slider.parentElement.appendChild(chips);
  }

  paint();
  return card;
}

/* ------------------------------------------------------------- tarjetas --- */

function debtCard(debt) {
  const days = daysUntil(debt.nextDueDate);
  const dueText = debt.settled ? null
    : days === null ? null
      : days < 0 ? `Venció hace ${Math.abs(days)} días`
        : days === 0 ? 'Vence hoy'
          : days === 1 ? 'Vence mañana'
            : `Vence en ${days} días`;

  const card = el(`
    <button class="card stack" type="button" style="text-align:left;width:100%;gap:8px;${debt.settled ? 'opacity:.62' : ''}">
      <div class="row-between">
        <span class="grow" style="min-width:0">
          <span class="truncate" style="display:block;font-weight:650;font-size:16px">
            ${debt.settled ? '✅ ' : ''}${esc(debt.name)}
          </span>
          <span class="tiny muted">${esc(kindLabel(debt.kind))}${debt.creditor ? ` · ${esc(debt.creditor)}` : ''}</span>
        </span>
        <span style="text-align:right">
          <span class="num" style="font-weight:700;display:block">${eur(debt.balance)}</span>
          <span class="tiny muted">de ${eur(debt.initial_amount, true)}</span>
        </span>
      </div>
      <div class="bar">
        <i style="width:${(debt.progress * 100).toFixed(1)}%;background:${debt.settled ? 'var(--pos)' : 'var(--accent)'}"></i>
      </div>
      <div class="row-between tiny muted">
        <span>${pct(debt.progress)} pagado${debt.paymentCount ? ` · ${debt.paymentCount} ${debt.paymentCount === 1 ? 'pago' : 'pagos'}` : ''}</span>
        <span class="${days !== null && days <= 3 && !debt.settled ? 'neg' : ''}">
          ${debt.settled ? 'Liquidada' : dueText || (debt.minimum_payment > 0 ? `${eur(debt.minimum_payment)}/mes` : 'Sin cuota fija')}
        </span>
      </div>
      ${!debt.settled && Number(debt.annual_rate) > 0 ? `
        <div class="tiny ${debt.coversInterest ? 'muted' : 'neg'}">
          TAE ${String(debt.annual_rate).replace('.', ',')} % · ${eur(debt.monthlyInterest)} de intereses al mes${debt.coversInterest ? '' : ' — la cuota no los cubre'}
        </div>` : ''}
    </button>
  `);

  card.addEventListener('click', () => openDebtDetail(debt.id));
  return card;
}

/* ---------------------------------------------------------- detalle ------- */

export function openDebtDetail(debtId) {
  const row = state.debts.find((d) => d.id === debtId);
  if (!row) return null;
  const debt = debtStatus(row, state.debtPayments);

  return openSheet(debt.name, (close) => {
    const body = el(`
      <div class="stack">
        <div class="card">
          <div class="row-between">
            <span class="tiny muted">Pendiente</span>
            <span class="tiny muted">${esc(kindLabel(debt.kind))}</span>
          </div>
          <div class="balance-value num ${debt.balance > 0 ? 'neg' : 'pos'}" style="font-size:32px">${eur(debt.balance)}</div>
          <div class="bar" style="margin:10px 0 6px">
            <i style="width:${(debt.progress * 100).toFixed(1)}%;background:var(--pos)"></i>
          </div>
          <div class="row-between tiny muted">
            <span>${eur(debt.paid)} pagados de ${eur(debt.initial_amount)}</span>
            <span>${pct(debt.progress)}</span>
          </div>
        </div>

        <div class="card">
          <div class="metric-row"><span>Cuota mínima</span><span class="num">${debt.minimum_payment > 0 ? eur(debt.minimum_payment) : '—'}</span></div>
          <div class="metric-row"><span>Interés (TAE)</span><span class="num">${Number(debt.annual_rate) > 0 ? `${String(debt.annual_rate).replace('.', ',')} %` : 'Sin intereses'}</span></div>
          ${Number(debt.annual_rate) > 0 ? `<div class="metric-row"><span>Intereses este mes</span><span class="num neg">${eur(debt.monthlyInterest)}</span></div>` : ''}
          <div class="metric-row"><span>Próximo vencimiento</span><span class="num">${debt.nextDueDate ? dayLabel(debt.nextDueDate) : '—'}</span></div>
          ${debt.creditor ? `<div class="metric-row"><span>Acreedor</span><span>${esc(debt.creditor)}</span></div>` : ''}
          ${debt.note ? `<div class="metric-row"><span>Nota</span><span>${esc(debt.note)}</span></div>` : ''}
        </div>

        ${debt.settled ? '' : '<button class="btn btn-primary btn-block btn-lg" data-pay>Registrar pago</button>'}

        <div>
          <div class="section-title">Pagos (${debt.paymentCount})</div>
          <div class="card card-flush" data-payments></div>
        </div>

        <div class="split">
          <button class="btn" data-edit>Editar</button>
          <button class="btn btn-danger" data-delete>Eliminar</button>
        </div>
      </div>
    `);

    const payments = body.querySelector('[data-payments]');
    if (!debt.payments.length) {
      payments.appendChild(el(`<div>${emptyState('Todavía no hay pagos registrados.')}</div>`));
    } else {
      const list = el('<div class="list"></div>');
      for (const p of debt.payments) {
        const row = el(`
          <div class="list-item">
            <span class="dot" style="background:var(--pos);color:var(--pos)"></span>
            <span class="grow" style="min-width:0">
              <span style="display:block;font-weight:600">${eur(p.amount)}</span>
              <span class="tiny muted">${esc(dayLabel(p.date))}${p.note ? ` · ${esc(p.note)}` : ''}${p.expense_id ? ' · gasto vinculado' : ''}</span>
            </span>
            <button class="btn btn-ghost" data-del="${p.id}" aria-label="Eliminar pago" style="min-height:34px;padding:0 10px">✕</button>
          </div>
        `);
        row.querySelector('[data-del]').addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await confirmSheet(
            'Eliminar pago',
            `Se borrará el pago de ${eur(p.amount)}${p.expense_id ? ' y el gasto que generó' : ''}. El saldo pendiente volverá a subir.`,
          );
          if (!ok) return;
          try {
            await deleteDebtPayment(p.id);
            close(true);
            toast('Pago eliminado');
          } catch (err) {
            toast(err.message || 'No se pudo eliminar el pago', 'err');
          }
        });
        list.appendChild(row);
      }
      payments.appendChild(list);
    }

    body.querySelector('[data-pay]')?.addEventListener('click', async () => {
      close(true);
      await openPaymentSheet(debt.id);
    });

    body.querySelector('[data-edit]').addEventListener('click', async () => {
      close(true);
      await openDebtSheet({ debt });
    });

    body.querySelector('[data-delete]').addEventListener('click', async () => {
      const ok = await confirmSheet(
        'Eliminar deuda',
        `Se borrarán "${debt.name}" y sus ${debt.paymentCount} pagos. Los gastos ya registrados en tu histórico se mantienen.`,
      );
      if (!ok) return;
      try {
        await deleteDebt(debt.id);
        close(true);
        toast('Deuda eliminada');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}

/* ------------------------------------------------------- registrar pago --- */

export function openPaymentSheet(debtId) {
  const row = state.debts.find((d) => d.id === debtId);
  if (!row) return null;
  const debt = debtStatus(row, state.debtPayments);
  let keypad;

  return openSheet(`Pago · ${debt.name}`, (close) => {
    keypad = amountKeypad(debt.minimum_payment > 0 ? Math.round(debt.minimum_payment * 100) : 0);

    const accounts = accountChips(rememberedAccount('expense'));

    const body = el(`
      <div class="stack">
        <div data-keypad></div>
        <p class="tiny muted center" style="margin:-4px 0 0">
          Pendiente ahora: <strong class="num">${eur(debt.balance)}</strong>
          ${debt.minimum_payment > 0 ? ` · cuota mínima ${eur(debt.minimum_payment)}` : ''}
        </p>
        <div data-accounts-block hidden>
          <div class="section-title">Pagado desde</div>
          <div data-accounts></div>
        </div>
        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${todayISO()}">
        </label>
        <label class="field">
          <span>Nota (opcional)</span>
          <input type="text" data-note maxlength="120" placeholder="Ej. cuota de agosto, pago extra…">
        </label>
        <label class="switch card" style="padding:12px 14px">
          <span>
            <strong style="font-size:15px">Registrar también como gasto</strong>
            <span class="tiny muted" style="display:block">Para que el pago cuente en el saldo del mes</span>
          </span>
          <input type="checkbox" data-expense checked>
        </label>
        <button class="btn btn-primary btn-block btn-lg" data-save disabled>Guardar pago</button>
      </div>
    `);

    body.querySelector('[data-keypad]').appendChild(keypad.node);
    if (accounts) {
      body.querySelector('[data-accounts]').appendChild(accounts.node);
      body.querySelector('[data-accounts-block]').hidden = false;
    }

    const saveBtn = body.querySelector('[data-save]');
    keypad.onChange((amount) => {
      saveBtn.disabled = !(amount > 0);
      saveBtn.textContent = amount > 0 ? `Pagar ${eur(amount)}` : 'Guardar pago';
    });

    saveBtn.addEventListener('click', async () => {
      const amount = keypad.value;
      if (!(amount > 0)) return;

      if (amount > debt.balance + 0.005) {
        const ok = await confirmSheet(
          'El pago supera lo pendiente',
          `Debes ${eur(debt.balance)} y vas a registrar ${eur(amount)}. ¿Lo guardo igualmente?`,
          { confirmLabel: 'Guardar igualmente', danger: false },
        );
        if (!ok) return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        await addDebtPayment({
          debt_id: debt.id,
          amount,
          date: body.querySelector('[data-date]').value || todayISO(),
          note: body.querySelector('[data-note]').value,
          account_id: accounts?.value ?? null,
          createExpense: body.querySelector('[data-expense]').checked,
        });
        haptic(18);
        keypad.dispose();
        close(true);

        const left = round2(debt.balance - amount);
        toast(left <= 0 ? `¡Deuda liquidada! 🎉` : `Pago guardado · quedan ${eur(left)}`);
      } catch (err) {
        toast(err.message || 'No se pudo guardar el pago', 'err');
        saveBtn.disabled = false;
        saveBtn.textContent = `Pagar ${eur(amount)}`;
      }
    });

    return body;
  }, { onClose: () => keypad?.dispose() });
}

/* ------------------------------------------------------ alta / edición --- */

export function openDebtSheet({ debt = null } = {}) {
  const editing = Boolean(debt);
  const cats = categoriesOf('expense');

  return openSheet(editing ? 'Editar deuda' : 'Nueva deuda', (close) => {
    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Nombre</span>
          <input type="text" data-name maxlength="60" data-autofocus
                 placeholder="Ej. Tarjeta Santander" value="${esc(debt?.name || '')}">
        </label>

        <label class="field">
          <span>Tipo</span>
          <select data-kind>
            ${DEBT_KINDS.map((k) => `<option value="${k.value}" ${debt?.kind === k.value ? 'selected' : ''}>${k.label}</option>`).join('')}
          </select>
        </label>

        <label class="field">
          <span>Acreedor (opcional)</span>
          <input type="text" data-creditor maxlength="60" placeholder="Ej. BBVA, mi hermano…"
                 value="${esc(debt?.creditor || '')}">
        </label>

        <label class="field">
          <span>${editing ? 'Importe original' : 'Cuánto debes ahora'}</span>
          <input type="number" data-amount inputmode="decimal" min="0.01" step="0.01"
                 placeholder="0,00" value="${debt?.initial_amount ?? ''}">
          ${editing ? '<span class="tiny muted">El pendiente se recalcula restando los pagos registrados.</span>'
        : '<span class="tiny muted">Los pagos que registres a partir de ahora irán bajando este importe.</span>'}
        </label>

        <div class="split">
          <label class="field">
            <span>Cuota mensual</span>
            <input type="number" data-minimum inputmode="decimal" min="0" step="0.01"
                   placeholder="0,00" value="${debt?.minimum_payment || ''}">
          </label>
          <label class="field">
            <span>Interés TAE %</span>
            <input type="number" data-rate inputmode="decimal" min="0" max="999" step="0.01"
                   placeholder="0" value="${debt?.annual_rate || ''}">
          </label>
        </div>

        <label class="field">
          <span>Día de pago del mes (opcional)</span>
          <input type="number" data-due min="1" max="31" step="1" inputmode="numeric"
                 placeholder="Ej. 5" value="${debt?.due_day || ''}">
        </label>

        <label class="field">
          <span>Categoría con la que registrar los pagos</span>
          <select data-category>
            <option value="">Deudas/Multas (por defecto)</option>
            ${cats.map((c) => `<option value="${c.id}" ${debt?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>

        <label class="field">
          <span>Nota (opcional)</span>
          <input type="text" data-note maxlength="160" value="${esc(debt?.note || '')}">
        </label>

        <button class="btn btn-primary btn-block btn-lg" data-save>${editing ? 'Guardar cambios' : 'Crear deuda'}</button>
      </div>
    `);

    const saveBtn = body.querySelector('[data-save]');
    saveBtn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim();
      const amount = Number(body.querySelector('[data-amount]').value);
      const due = Number(body.querySelector('[data-due]').value);

      if (!name) { toast('Ponle un nombre a la deuda', 'err'); return; }
      if (!(amount > 0)) { toast('El importe tiene que ser mayor que 0', 'err'); return; }
      if (body.querySelector('[data-due]').value && (due < 1 || due > 31)) {
        toast('El día de pago tiene que estar entre 1 y 31', 'err'); return;
      }

      const payload = {
        name,
        kind: body.querySelector('[data-kind]').value,
        creditor: body.querySelector('[data-creditor]').value,
        initial_amount: amount,
        minimum_payment: Number(body.querySelector('[data-minimum]').value) || 0,
        annual_rate: Number(body.querySelector('[data-rate]').value) || 0,
        due_day: due || null,
        category_id: body.querySelector('[data-category]').value || null,
        note: body.querySelector('[data-note]').value,
      };

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        if (editing) await updateDebt(debt.id, payload);
        else await addDebt(payload);
        close(true);
        toast(editing ? 'Deuda actualizada' : 'Deuda creada');
      } catch (err) {
        toast(err.message || 'No se pudo guardar la deuda', 'err');
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'Guardar cambios' : 'Crear deuda';
      }
    });

    return body;
  });
}
