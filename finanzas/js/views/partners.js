import { el, esc, eur, pct, monthKey, monthLabel, todayISO, dayLabel, toast, haptic } from '../utils.js';
import {
  state, addPartner, updatePartner, deletePartner, addDraw, addContribution,
  deleteContribution, deleteMovement, accountsList,
} from '../store.js';
import { partnerBalances, drawShare } from '../partners.js';
import { openSheet, confirmSheet, emptyState } from '../ui.js';
import { amountKeypad } from '../ui.js';

/**
 * Socios: quién ha sacado dinero del negocio y cuánto debe.
 *
 * Una retirada no es un gasto del local, así que vive aparte del resto de la
 * contabilidad y tiene su propia pantalla. Lo que se ve aquí es el saldo de
 * cada uno, y de dónde sale.
 */

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#14b8a6', '#0ea5e9', '#a855f7'];

/* ================================================================ pantalla === */

export function renderPartners() {
  const month = monthKey();
  const view = partnerBalances(state, month);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Socios</h1>
          <p>Cuenta corriente con el negocio</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  if (!state.partners.length) {
    body.appendChild(el(`
      <div class="card insight is-info">
        <div class="icon">🤝</div>
        <div>
          <h3>Todavía no has dado de alta a nadie</h3>
          <p>Un socio es quien puede sacar dinero del negocio para sus cosas. Cuando lo haga,
             ese dinero sale de la caja pero no cuenta como gasto del local: queda como lo que
             te debe.</p>
        </div>
      </div>
    `));
  } else {
    /* --- saldo conjunto -------------------------------------------------- */
    body.appendChild(el(`
      <div class="card balance-card">
        <div class="balance-label">${view.total >= 0 ? 'Los socios deben al negocio' : 'El negocio debe a los socios'}</div>
        <div class="balance-value num ${view.total < 0 ? 'neg' : ''}">${eur(Math.abs(view.total))}</div>
        <div class="balance-sub">
          ${eur(view.drawn)} sacados · ${eur(view.contributed)} devueltos
          ${view.drawnThisMonth > 0 ? ` · ${eur(view.drawnThisMonth)} este mes` : ''}
        </div>
        ${view.drawn > 0 ? `
          <div class="bar" style="margin-top:12px;display:flex;gap:2px;background:none;border:0;height:10px">
            ${drawShare(view).map((r, i, all) => `
              <i style="flex:${Math.max(r.drawn, 0.01)};background:${esc(r.color)};
                        border-radius:${i === 0 ? '99px 0 0 99px' : i === all.length - 1 ? '0 99px 99px 0' : '0'}"></i>`).join('')}
          </div>
          <div class="row-between tiny muted" style="margin-top:6px;flex-wrap:wrap;gap:4px 10px">
            ${drawShare(view).map((r) => `<span>${esc(r.name)} ${pct(r.share)}</span>`).join('')}
          </div>` : ''}
      </div>
    `));

    /* --- ficha de cada socio --------------------------------------------- */
    for (const partner of view.rows) body.appendChild(partnerCard(partner, month));
  }

  /* --- alta -------------------------------------------------------------- */
  const add = el('<button class="btn btn-block" data-new-partner>+ Añadir socio</button>');
  add.addEventListener('click', () => openPartnerSheet());
  body.appendChild(add);

  /* --- movimientos ------------------------------------------------------- */
  if (state.partners.length) body.appendChild(movementsList());

  return screen;
}

function partnerCard(partner, month) {
  const debe = partner.balance > 0;
  const card = el(`
    <div class="card">
      <div class="row-between" style="gap:10px">
        <span class="row" style="gap:10px;min-width:0">
          <span class="dot" style="background:${esc(partner.color)};flex:none"></span>
          <span style="min-width:0">
            <strong class="truncate" style="display:block;font-size:16px">${esc(partner.name)}${partner.is_me ? ' <span class="tiny muted">· tú</span>' : ''}</strong>
            <span class="tiny muted">${partner.movements
    ? `${partner.movements} ${partner.movements === 1 ? 'movimiento' : 'movimientos'}`
    : 'sin movimientos'}</span>
          </span>
        </span>
        <span style="text-align:right">
          <strong class="num ${debe ? '' : 'pos'}" style="font-size:18px;display:block">${eur(Math.abs(partner.balance))}</strong>
          <span class="tiny muted">${debe ? 'debe' : partner.balance < 0 ? 'a favor' : 'al día'}</span>
        </span>
      </div>

      ${partner.movements ? `
        <div class="metric-row" style="margin-top:10px">
          <span class="tiny muted">Ha sacado</span>
          <span class="num tiny">${eur(partner.drawn)}</span>
        </div>
        <div class="metric-row">
          <span class="tiny muted">Ha devuelto</span>
          <span class="num tiny">${eur(partner.contributed)}</span>
        </div>
        ${partner.drawnThisMonth > 0 ? `
          <div class="metric-row">
            <span class="tiny muted">Sacado en ${monthLabel(month, { short: true })}</span>
            <span class="num tiny">${eur(partner.drawnThisMonth)}</span>
          </div>` : ''}` : ''}

      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn grow" data-draw>− Retirada</button>
        <button class="btn grow" data-contribution>+ Aportación</button>
        <button class="btn btn-ghost" data-edit aria-label="Editar" style="min-height:38px;padding:0 12px">✎</button>
      </div>
    </div>
  `);

  card.querySelector('[data-draw]').addEventListener('click', () => openDrawSheet(partner));
  card.querySelector('[data-contribution]').addEventListener('click', () => openContributionSheet(partner));
  card.querySelector('[data-edit]').addEventListener('click', () => openPartnerSheet(partner));
  return card;
}

/** Retiradas y aportaciones recientes, mezcladas y en orden. */
function movementsList() {
  const rows = [
    ...state.expenses.filter((e) => e.partner_id).map((e) => ({ ...e, kind: 'draw' })),
    ...state.incomes.filter((i) => i.partner_id).map((i) => ({ ...i, kind: 'contribution' })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 25);

  const block = el(`
    <div>
      <div class="section-title">Movimientos con socios</div>
      <div class="card card-flush"><div class="list" data-list></div></div>
    </div>
  `);
  const list = block.querySelector('[data-list]');

  if (!rows.length) {
    list.appendChild(el(`<div>${emptyState('Todavía no hay retiradas ni aportaciones.')}</div>`));
    return block;
  }

  for (const row of rows) {
    const partner = state.partners.find((p) => p.id === row.partner_id);
    const draw = row.kind === 'draw';
    const item = el(`
      <button class="list-item" type="button">
        <span class="dot" style="background:${esc(partner?.color || '#94a3b8')}"></span>
        <span class="grow" style="min-width:0">
          <span class="truncate" style="display:block;font-weight:600">
            ${esc(partner?.name || 'Socio')} · ${draw ? 'retirada' : 'aportación'}
          </span>
          <span class="tiny muted truncate" style="display:block">
            ${esc(dayLabel(row.date))}${row.note || row.source ? ` · ${esc(row.note || row.source)}` : ''}
          </span>
        </span>
        <span class="num ${draw ? '' : 'pos'}" style="font-weight:650">${draw ? '−' : '+'}${eur(row.amount)}</span>
      </button>
    `);
    item.addEventListener('click', () => openMovementSheet(row, partner));
    list.appendChild(item);
  }

  return block;
}

/* ------------------------------------------------------------- alta socio --- */

export function openPartnerSheet(partner = null) {
  const editing = Boolean(partner);
  const yaHayYo = state.partners.some((p) => p.is_me && p.id !== partner?.id);

  return openSheet(editing ? 'Editar socio' : 'Nuevo socio', (close) => {
    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Nombre</span>
          <input type="text" data-name maxlength="60" data-autofocus
                 placeholder="Ej. Massimo Personal" value="${esc(partner?.name || '')}">
        </label>

        <div class="field">
          <span>Color</span>
          <div class="row" style="gap:8px;flex-wrap:wrap" data-colors></div>
        </div>

        ${yaHayYo ? '' : `
          <label class="row" style="gap:10px;align-items:flex-start">
            <input type="checkbox" data-me ${partner?.is_me ? 'checked' : ''} style="margin-top:3px">
            <span>
              <strong style="display:block">Este socio soy yo</strong>
              <span class="tiny muted">Lo que saques aparecerá en tu espacio personal como lo que le
              debes al negocio, y al aportar podrás apuntarlo de una vez como gasto tuyo.</span>
            </span>
          </label>`}

        <button class="btn btn-primary btn-block btn-lg" data-save>${editing ? 'Guardar' : 'Añadir socio'}</button>
        ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar socio</button>' : ''}
      </div>
    `);

    let color = partner?.color || COLORS[state.partners.length % COLORS.length];
    const colors = body.querySelector('[data-colors]');
    const paintColors = () => {
      colors.replaceChildren(...COLORS.map((c) => {
        const dot = el(`
          <button type="button" aria-label="${c}"
                  style="width:34px;height:34px;border-radius:50%;background:${c};flex:none;
                         border:3px solid ${c === color ? 'var(--text)' : 'transparent'}"></button>
        `);
        dot.addEventListener('click', () => { color = c; paintColors(); });
        return dot;
      }));
    };
    paintColors();

    const btn = body.querySelector('[data-save]');
    btn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Ponle un nombre al socio', 'err'); return; }

      const payload = { name, color, is_me: Boolean(body.querySelector('[data-me]')?.checked) };
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        if (editing) await updatePartner(partner.id, payload);
        else await addPartner(payload);
        haptic(14);
        close(true);
        toast(editing ? 'Socio actualizado' : `${name} añadido`);
      } catch (err) {
        const msg = /duplicate key|partners_ws_name/.test(err.message || '')
          ? 'Ya hay un socio con ese nombre'
          : (err.message || 'No se pudo guardar');
        toast(msg, 'err');
        btn.disabled = false;
        btn.textContent = editing ? 'Guardar' : 'Añadir socio';
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmSheet('Eliminar socio', `Se quitará a ${partner.name} del negocio.`);
      if (!ok) return;
      try {
        await deletePartner(partner.id);
        close(true);
        toast('Socio eliminado');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}

/* -------------------------------------------------------------- retirada --- */

export function openDrawSheet(partner) {
  return openSheet(`Retirada · ${partner.name}`, (close) => {
    const cuentas = accountsList();
    const body = el(`
      <div class="stack">
        <p class="tiny muted" style="margin:0">
          Dinero del negocio que ${partner.is_me ? 'te llevas' : `se lleva ${esc(partner.name)}`} para gastos
          propios. Sale de la caja, pero no cuenta como gasto del local: se suma a lo que
          ${partner.is_me ? 'le debes' : 'te debe'}.
        </p>
        <div data-keypad></div>
        <label class="field">
          <span>De qué cuenta sale</span>
          <select data-account>
            ${cuentas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${todayISO()}">
        </label>
        <label class="field">
          <span>Concepto (opcional)</span>
          <input type="text" data-note maxlength="120" placeholder="Ej. compra del súper">
        </label>
        <button class="btn btn-primary btn-block btn-lg" data-save>Guardar retirada</button>
      </div>
    `);

    const keypad = amountKeypad();
    body.querySelector('[data-keypad]').appendChild(keypad.node);

    const btn = body.querySelector('[data-save]');
    btn.addEventListener('click', async () => {
      const amount = keypad.value;
      if (!(amount > 0)) { toast('El importe tiene que ser mayor que 0', 'err'); return; }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await addDraw({
          partner_id: partner.id,
          amount,
          account_id: body.querySelector('[data-account]').value || null,
          date: body.querySelector('[data-date]').value,
          note: body.querySelector('[data-note]').value,
        });
        haptic(18);
        close(true);
        toast(`Retirada de ${eur(amount)} apuntada`);
      } catch (err) {
        toast(err.message || 'No se pudo guardar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar retirada';
      }
    });

    return body;
  });
}

/* ------------------------------------------------------------ aportación --- */

export function openContributionSheet(partner) {
  return openSheet(`Aportación · ${partner.name}`, (close) => {
    const cuentas = accountsList();
    // El espejo personal sólo tiene sentido para uno mismo, y sólo si hay
    // espacio personal donde apuntarlo.
    const personalWs = state.workspaces.find((w) => w.kind === 'personal');
    const puedeEspejar = partner.is_me && Boolean(personalWs);

    const body = el(`
      <div class="stack">
        <p class="tiny muted" style="margin:0">
          Dinero que ${partner.is_me ? 'devuelves' : `devuelve ${esc(partner.name)}`} al negocio. Entra en la
          cuenta que elijas —no es facturación— y baja lo que ${partner.is_me ? 'debes' : 'debe'}.
        </p>
        <div data-keypad></div>
        <label class="field">
          <span>En qué cuenta entra</span>
          <select data-account>
            ${cuentas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${todayISO()}">
        </label>
        <label class="field">
          <span>Concepto (opcional)</span>
          <input type="text" data-note maxlength="120" placeholder="Ej. devolución de agosto">
        </label>

        ${puedeEspejar ? `
          <label class="row" style="gap:10px;align-items:flex-start">
            <input type="checkbox" data-mirror checked style="margin-top:3px">
            <span>
              <strong style="display:block">Apuntarlo también como gasto mío</strong>
              <span class="tiny muted">Ese dinero sale de tu bolsillo, así que se registra como gasto
              en tu espacio ${esc(personalWs.name)}.</span>
            </span>
          </label>
          <div data-personal class="stack" style="gap:10px"></div>` : ''}

        <button class="btn btn-primary btn-block btn-lg" data-save>Guardar aportación</button>
      </div>
    `);

    const keypad = amountKeypad();
    body.querySelector('[data-keypad]').appendChild(keypad.node);

    const btn = body.querySelector('[data-save]');
    btn.addEventListener('click', async () => {
      const amount = keypad.value;
      if (!(amount > 0)) { toast('El importe tiene que ser mayor que 0', 'err'); return; }

      const mirror = body.querySelector('[data-mirror]')?.checked;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await addContribution({
          partner_id: partner.id,
          amount,
          account_id: body.querySelector('[data-account]').value || null,
          date: body.querySelector('[data-date]').value,
          note: body.querySelector('[data-note]').value,
          personal: mirror ? { workspace_id: personalWs.id } : null,
        });
        haptic(18);
        close(true);
        toast(`Aportación de ${eur(amount)} apuntada`);
      } catch (err) {
        // Puede haberse guardado la aportación y fallado sólo el espejo
        toast(err.message || 'No se pudo guardar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar aportación';
      }
    });

    return body;
  });
}

/* ------------------------------------------------------- ver un movimiento --- */

function openMovementSheet(row, partner) {
  const draw = row.kind === 'draw';

  return openSheet(`${draw ? 'Retirada' : 'Aportación'} · ${partner?.name || 'Socio'}`, (close) => {
    const cuenta = state.accounts.find((a) => a.id === row.account_id);
    const body = el(`
      <div class="stack">
        <div class="card" style="padding:14px 16px">
          <div class="row-between"><span class="muted">Importe</span>
            <strong class="num" style="font-size:20px">${draw ? '−' : '+'}${eur(row.amount)}</strong></div>
          <div class="metric-row"><span class="tiny muted">Fecha</span>
            <span class="tiny">${esc(dayLabel(row.date))}</span></div>
          <div class="metric-row"><span class="tiny muted">Cuenta</span>
            <span class="tiny">${esc(cuenta?.name || 'sin asignar')}</span></div>
          ${row.note || row.source ? `
            <div class="metric-row"><span class="tiny muted">Concepto</span>
              <span class="tiny">${esc(row.note || row.source)}</span></div>` : ''}
        </div>
        <p class="tiny muted" style="margin:0">
          ${draw
    ? 'Salió de la caja del negocio y se sumó a lo que este socio debe.'
    : 'Entró en el negocio y bajó lo que este socio debe.'}
        </p>
        <button class="btn btn-danger btn-block" data-delete>Eliminar</button>
      </div>
    `);

    body.querySelector('[data-delete]').addEventListener('click', async () => {
      const ok = await confirmSheet(
        'Eliminar movimiento',
        draw
          ? `Se borrará la retirada de ${eur(row.amount)} y el saldo de ${partner?.name || 'el socio'} bajará.`
          : `Se borrará la aportación de ${eur(row.amount)}${row.partner_income_id ? '' : ' y el gasto personal que generó'}, y el saldo volverá a subir.`,
      );
      if (!ok) return;
      try {
        if (draw) await deleteMovement('expense', row.id);
        else await deleteContribution(row.id);
        close(true);
        toast('Movimiento eliminado');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}
