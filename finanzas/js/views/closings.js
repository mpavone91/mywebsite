import { el, esc, eur, pct, monthKey, monthLabel, todayISO, dayLabel, toast, haptic } from '../utils.js';
import { state, addClosing, updateClosing, deleteClosing, closingForDate } from '../store.js';
import { takings, monthResult, closingTotal, METHODS } from '../closings.js';
import { openSheet, confirmSheet, emptyState } from '../ui.js';

/* ================================================================ pantalla === */

export function renderClosings() {
  const month = monthKey();
  const view = takings(state.closings, month);
  const result = monthResult(state.closings, state.expenses, month);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Cierres</h1>
          <p>${monthLabel(month)} · el parte de cada día</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  /* --- facturación del mes --------------------------------------------- */
  body.appendChild(el(`
    <div class="card balance-card">
      <div class="balance-label">Facturado en ${monthLabel(month)}</div>
      <div class="balance-value num pos">${eur(view.total)}</div>
      <div class="balance-sub">
        ${view.closings
    ? `${view.closings} ${view.closings === 1 ? 'día con parte' : 'días con parte'} · media de <strong>${eur(view.average)}</strong> al día`
    : 'Todavía no has apuntado ningún cierre este mes'}
      </div>
      ${view.total > 0 ? `
        <div class="bar" style="margin-top:12px;display:flex;gap:2px;background:none;border:0;height:10px">
          ${view.byMethod.map((m, i) => `
            <i style="flex:${Math.max(m.value, 0.01)};background:${m.color};
                      border-radius:${i === 0 ? '99px 0 0 99px' : i === 2 ? '0 99px 99px 0' : '0'}"></i>`).join('')}
        </div>
        <div class="row-between tiny muted" style="margin-top:6px">
          ${view.byMethod.map((m) => `<span>${m.icon} ${m.label} ${pct(m.share)}</span>`).join('')}
        </div>` : ''}
    </div>
  `));

  /* --- desglose y resultado -------------------------------------------- */
  if (view.closings) {
    body.appendChild(el(`
      <div class="card">
        ${view.byMethod.map((m) => `
          <div class="metric-row">
            <span>${m.icon} ${m.label}</span>
            <span class="num">${eur(m.value)} <span class="muted tiny">${pct(m.share)}</span></span>
          </div>`).join('')}
        <div class="metric-row"><span>− Gastos del mes</span><span class="num">${eur(result.expense)}</span></div>
        <div class="metric-row" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <strong>= Resultado</strong>
          <strong class="num ${result.result < 0 ? 'neg' : 'pos'}">${eur(result.result)}</strong>
        </div>
        ${view.projected ? `
          <p class="tiny muted" style="margin:12px 0 0">
            Al ritmo de los días con parte, el mes cerraría sobre ${eur(view.projected, true)} de facturación.
          </p>` : ''}
      </div>
    `));
  }

  /* --- aviso de partes que faltan --------------------------------------- */
  if (view.missing >= 3) {
    body.appendChild(el(`
      <div class="card insight is-warn">
        <div class="icon">📭</div>
        <div>
          <h3>Faltan ${view.missing} partes</h3>
          <p>Del día 1 al ${view.daysElapsed} hay ${view.closings} cierres apuntados. Si el local abre a diario, la facturación del mes está incompleta.</p>
        </div>
      </div>
    `));
  }

  /* --- alta ------------------------------------------------------------- */
  const hoy = closingForDate(todayISO());
  const addBtn = el(`
    <button class="quick quick-expense" data-new style="width:100%">
      ${hoy ? 'Editar el cierre de hoy' : '+ Cierre del día'}
      <small>${hoy ? `Ya hay parte: ${eur(closingTotal(hoy))}` : 'Tarjeta, online y efectivo'}</small>
    </button>
  `);
  addBtn.addEventListener('click', () => openClosingSheet({ closing: hoy }));
  body.appendChild(addBtn);

  /* --- listado ---------------------------------------------------------- */
  const list = el(`
    <div>
      <div class="section-title">Partes de ${monthLabel(month)}</div>
      <div class="card card-flush"><div class="list" data-list></div></div>
    </div>
  `);
  const listBody = list.querySelector('[data-list]');

  if (!view.rows.length) {
    listBody.appendChild(el(`<div>${emptyState('Sin cierres este mes.')}</div>`));
  } else {
    for (const closing of view.rows) listBody.appendChild(closingRow(closing));
  }
  body.appendChild(list);

  return screen;
}

function closingRow(closing) {
  const parts = METHODS
    .filter((m) => Number(closing[m.key]) > 0)
    .map((m) => `${m.icon} ${eur(closing[m.key])}`)
    .join(' · ');

  const row = el(`
    <button class="list-item" type="button">
      <span class="dot" style="background:var(--pos);color:var(--pos)"></span>
      <span class="grow" style="min-width:0">
        <span class="truncate" style="display:block;font-weight:600">${esc(dayLabel(closing.date))}</span>
        <span class="tiny muted truncate" style="display:block">${parts}${closing.note ? ` · ${esc(closing.note)}` : ''}</span>
      </span>
      <span class="num" style="font-weight:650">${eur(closingTotal(closing))}</span>
    </button>
  `);
  row.addEventListener('click', () => openClosingSheet({ closing }));
  return row;
}

/* ------------------------------------------------------- alta / edición --- */

export function openClosingSheet({ closing = null, date = null } = {}) {
  const editing = Boolean(closing);

  return openSheet(editing ? `Cierre · ${dayLabel(closing.date)}` : 'Cierre del día', (close) => {
    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${esc(closing?.date || date || todayISO())}" ${editing ? 'disabled' : ''}>
          ${editing ? '<span class="tiny muted">La fecha no se cambia: hay un parte por día. Si te equivocaste, borra este y crea otro.</span>' : ''}
        </label>

        ${METHODS.map((m) => `
          <label class="field">
            <span>${m.icon} ${m.label}</span>
            <input type="number" data-m="${m.key}" inputmode="decimal" min="0" step="0.01"
                   placeholder="0,00" value="${closing?.[m.key] > 0 ? closing[m.key] : ''}">
          </label>`).join('')}

        <div class="card" data-total style="padding:12px 14px"></div>

        <label class="field">
          <span>Nota (opcional)</span>
          <input type="text" data-note maxlength="160" placeholder="Ej. fiesta, festivo, media jornada…"
                 value="${esc(closing?.note || '')}">
        </label>

        <button class="btn btn-primary btn-block btn-lg" data-save>
          ${editing ? 'Guardar cambios' : 'Guardar cierre'}
        </button>
        ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar cierre</button>' : ''}
      </div>
    `);

    const totalBox = body.querySelector('[data-total]');
    const inputs = METHODS.map((m) => ({ ...m, node: body.querySelector(`[data-m="${m.key}"]`) }));

    const readTotal = () => inputs.reduce((a, i) => a + (Number(i.node.value) || 0), 0);

    function paintTotal() {
      const total = readTotal();
      totalBox.replaceChildren(el(`
        <div class="row-between">
          <span class="muted">Total del día</span>
          <strong class="num" style="font-size:20px">${eur(total)}</strong>
        </div>
      `));
    }

    inputs.forEach((i) => i.node.addEventListener('input', paintTotal));
    paintTotal();

    const saveBtn = body.querySelector('[data-save]');
    saveBtn.addEventListener('click', async () => {
      const payload = {
        date: body.querySelector('[data-date]').value || todayISO(),
        note: body.querySelector('[data-note]').value,
      };
      for (const i of inputs) payload[i.key] = Number(i.node.value) || 0;

      if (readTotal() <= 0) { toast('El cierre tiene que llevar algún importe', 'err'); return; }

      if (!editing && closingForDate(payload.date)) {
        toast('Ya hay un parte para ese día. Ábrelo desde la lista para editarlo.', 'err');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        if (editing) await updateClosing(closing.id, payload);
        else await addClosing(payload);
        haptic(18);
        close(true);
        toast(editing ? 'Cierre actualizado' : `Cierre de ${eur(readTotal())} guardado`);
      } catch (err) {
        const msg = err.code === '23505'
          ? 'Ya hay un parte para ese día'
          : (err.message || 'No se pudo guardar el cierre');
        toast(msg, 'err');
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'Guardar cambios' : 'Guardar cierre';
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmSheet(
        'Eliminar cierre',
        `Se borrará el parte de ${dayLabel(closing.date)} (${eur(closingTotal(closing))}) y los ingresos que generó.`,
      );
      if (!ok) return;
      try {
        await deleteClosing(closing.id);
        close(true);
        toast('Cierre eliminado');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}
