import { el, esc, eur, todayISO, dayLabel, toast, haptic } from '../utils.js';
import {
  state, addAccount, updateAccount, deleteAccount, addTransfer, deleteTransfer,
  accountsList, accountById,
} from '../store.js';
import { accountsOverview, ACCOUNT_KINDS, kindMeta, SUGGESTED } from '../accounts.js';
import { openSheet, confirmSheet, emptyState } from '../ui.js';
import { amountKeypad } from '../ui.js';

const LAST_ACCOUNT = 'finanzas.lastAccount';

/* ------------------------------------------------- selector reutilizable --- */

/** Recuerda la última cuenta usada para cada tipo de movimiento. */
export function rememberedAccount(kind) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_ACCOUNT) || '{}')[kind];
    return accountsList().some((a) => a.id === saved) ? saved : null;
  } catch {
    return null;
  }
}

export function rememberAccount(kind, id) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_ACCOUNT) || '{}');
    localStorage.setItem(LAST_ACCOUNT, JSON.stringify({ ...all, [kind]: id }));
  } catch { /* almacenamiento lleno o bloqueado: no es crítico */ }
}

/**
 * Chips para elegir cuenta. Devuelve null si el usuario no tiene ninguna
 * creada, para que los formularios no muestren un bloque vacío.
 */
export function accountChips(selectedId = null, { onChange } = {}) {
  const accounts = accountsList();
  if (!accounts.length) return null;

  let selected = accounts.some((a) => a.id === selectedId) ? selectedId : null;

  const node = el(`<div class="chips">${accounts.map((a) => `
    <button type="button" class="chip" data-id="${a.id}" style="color:${esc(a.color)}"
            aria-pressed="${a.id === selected}">
      <span>${kindMeta(a.kind).icon}</span>
      <span style="color:var(--text)">${esc(a.name)}</span>
    </button>`).join('')}</div>`);

  const paint = () => node.querySelectorAll('.chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.id === selected));
  });

  node.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      selected = chip.dataset.id === selected ? null : chip.dataset.id;
      paint();
      haptic(8);
      onChange?.(selected);
    });
  });

  return { node, get value() { return selected; } };
}

/* ================================================================ pantalla === */

export function renderAccounts() {
  const view = accountsOverview(state);

  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Cuentas</h1>
          <p>Dónde está tu dinero</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  if (!view.rows.length) {
    body.appendChild(emptyAccounts());
    return screen;
  }

  /* --- resumen ---------------------------------------------------------- */
  body.appendChild(el(`
    <div class="card balance-card">
      <div class="balance-label">Disponible</div>
      <div class="balance-value num ${view.available < 0 ? 'neg' : ''}">${eur(view.available)}</div>
      <div class="balance-sub">
        ${view.savings > 0 ? `+ ${eur(view.savings)} en ahorro · total ${eur(view.net)}` : 'sin contar el dinero del negocio'}
      </div>
    </div>
  `));

  /* --- pendiente con el negocio ----------------------------------------- */
  for (const account of view.business) {
    if (!account.float) continue;
    const card = el(`
      <div class="card insight ${account.float.pending > 0 ? 'is-warn' : 'is-good'}">
        <div class="icon">🏪</div>
        <div>
          <h3>${account.float.pending > 0
    ? `Debes ${eur(account.float.pending)} a ${esc(account.name)}`
    : `Al día con ${esc(account.name)}`}</h3>
          <p>
            Llevas ${eur(account.monthSpend)} gastados este mes desde ${esc(account.name)}.
            En total ${eur(account.float.spent)} y has devuelto ${eur(account.float.repaid)}.
          </p>
          ${account.float.pending > 0 ? `
            <div class="action">
              <button class="btn btn-primary" data-settle="${account.id}">Devolver ${eur(account.float.pending)}</button>
            </div>` : ''}
        </div>
      </div>
    `);
    card.querySelector('[data-settle]')?.addEventListener('click', () => {
      openTransferSheet({ toAccountId: account.id, amount: account.float.pending });
    });
    body.appendChild(card);
  }

  /* --- listado ---------------------------------------------------------- */
  const list = el('<div><div class="section-title">Tus cuentas</div><div class="stack" data-list></div></div>');
  const listBody = list.querySelector('[data-list]');
  for (const account of view.rows) listBody.appendChild(accountCard(account));
  body.appendChild(list);

  /* --- acciones --------------------------------------------------------- */
  const actions = el(`
    <div class="split">
      <button class="btn" data-transfer>↔ Traspaso</button>
      <button class="btn" data-new>+ Cuenta</button>
    </div>
  `);
  actions.querySelector('[data-transfer]').addEventListener('click', () => openTransferSheet({}));
  actions.querySelector('[data-new]').addEventListener('click', () => openAccountSheet({}));
  body.appendChild(actions);

  /* --- traspasos recientes ---------------------------------------------- */
  if (state.transfers.length) {
    body.appendChild(transferList());
  }

  return screen;
}

function emptyAccounts() {
  const card = el(`
    <div class="card">
      ${emptyState('Todavía no has creado ninguna cuenta.')}
      <p class="small muted center" style="margin:0 0 16px">
        Al asignar cada gasto e ingreso a un banco sabrás de dónde sale cada euro.
        Los traspasos entre tus cuentas no cuentan como gasto, y el dinero de una cuenta
        de negocio se lleva aparte para que no se mezcle con lo tuyo.
      </p>
      <div class="section-title">Crear rápido</div>
      <div class="chips" data-suggested>
        ${SUGGESTED.map((s, i) => `
          <button type="button" class="chip" data-i="${i}" style="color:${s.color}">
            <span>${kindMeta(s.kind).icon}</span>
            <span style="color:var(--text)">${esc(s.name)}</span>
          </button>`).join('')}
      </div>
      <button class="btn btn-primary btn-block btn-lg" data-new style="margin-top:16px">+ Crear cuenta</button>
    </div>
  `);

  card.querySelectorAll('[data-i]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const preset = SUGGESTED[Number(btn.dataset.i)];
      btn.disabled = true;
      try {
        await addAccount({
          name: preset.name,
          kind: preset.kind,
          color: preset.color,
          counts_as_personal: preset.counts_as_personal !== false,
          opening_balance: 0,
        });
        toast(`${preset.name} creada`);
      } catch (err) {
        toast(err.code === '23505' ? 'Ya tienes una cuenta con ese nombre' : (err.message || 'No se pudo crear'), 'err');
        btn.disabled = false;
      }
    });
  });

  card.querySelector('[data-new]').addEventListener('click', () => openAccountSheet({}));
  return card;
}

function accountCard(account) {
  const card = el(`
    <button class="card" type="button" style="text-align:left;width:100%">
      <div class="row-between">
        <span class="grow" style="min-width:0">
          <span class="truncate" style="display:block;font-weight:650;font-size:16px">
            ${account.icon} ${esc(account.name)}
          </span>
          <span class="tiny muted">
            ${esc(account.kindLabel)}${account.counts_as_personal ? '' : ' · fuera de tus totales'}
          </span>
        </span>
        <span style="text-align:right">
          <span class="num" style="font-weight:700;display:block;color:${account.balance < 0 ? 'var(--neg)' : 'inherit'}">
            ${eur(account.balance)}
          </span>
          ${account.monthSpend > 0 ? `<span class="tiny muted">${eur(account.monthSpend)} este mes</span>` : ''}
        </span>
      </div>
    </button>
  `);
  card.addEventListener('click', () => openAccountSheet({ account }));
  return card;
}

function transferList() {
  const wrap = el(`
    <div>
      <div class="section-title">Traspasos recientes</div>
      <div class="card card-flush"><div class="list" data-list></div></div>
    </div>
  `);
  const list = wrap.querySelector('[data-list]');

  for (const t of state.transfers.slice(0, 8)) {
    const from = accountById(t.from_account_id);
    const to = accountById(t.to_account_id);
    const row = el(`
      <div class="list-item">
        <span class="dot" style="background:var(--accent);color:var(--accent)"></span>
        <span class="grow" style="min-width:0">
          <span class="truncate" style="display:block;font-weight:600">
            ${esc(from?.name || 'Cuenta borrada')} → ${esc(to?.name || 'Cuenta borrada')}
          </span>
          <span class="tiny muted">${esc(dayLabel(t.date))}${t.note ? ` · ${esc(t.note)}` : ''}</span>
        </span>
        <span class="num" style="font-weight:650">${eur(t.amount)}</span>
        <button class="btn btn-ghost" data-del aria-label="Eliminar traspaso" style="min-height:34px;padding:0 8px">✕</button>
      </div>
    `);
    row.querySelector('[data-del]').addEventListener('click', async () => {
      const ok = await confirmSheet('Eliminar traspaso', `Se borrará el traspaso de ${eur(t.amount)}.`);
      if (!ok) return;
      try {
        await deleteTransfer(t.id);
        toast('Traspaso eliminado');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });
    list.appendChild(row);
  }

  return wrap;
}

/* ------------------------------------------------------ alta / edición --- */

export function openAccountSheet({ account = null } = {}) {
  const editing = Boolean(account);

  return openSheet(editing ? 'Editar cuenta' : 'Nueva cuenta', (close) => {
    let kind = account?.kind || 'checking';
    let personal = account ? account.counts_as_personal : true;

    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Nombre</span>
          <input type="text" data-name maxlength="40" data-autofocus
                 placeholder="Ej. el nombre de tu banco" value="${esc(account?.name || '')}">
        </label>

        <div>
          <div class="section-title" style="margin-top:6px">Tipo</div>
          <div class="stack" data-kinds>
            ${ACCOUNT_KINDS.map((k) => `
              <button type="button" class="card row" data-kind="${k.value}"
                      style="padding:12px 14px;text-align:left;border-color:${k.value === kind ? 'var(--accent)' : 'var(--border)'}">
                <span style="font-size:20px;margin-right:4px">${k.icon}</span>
                <span class="grow">
                  <strong style="font-size:15px">${k.label}</strong>
                  <span class="tiny muted" style="display:block">${k.hint}</span>
                </span>
                <span data-check style="color:var(--accent);font-weight:700">${k.value === kind ? '✓' : ''}</span>
              </button>`).join('')}
          </div>
        </div>

        <label class="switch card" style="padding:12px 14px">
          <span>
            <strong style="font-size:15px">Es mi dinero</strong>
            <span class="tiny muted" style="display:block" data-personal-hint></span>
          </span>
          <input type="checkbox" data-personal ${personal ? 'checked' : ''}>
        </label>

        <label class="field">
          <span>Saldo actual</span>
          <input type="number" data-opening inputmode="decimal" step="0.01"
                 placeholder="0,00" value="${account?.opening_balance ?? ''}">
          <span class="tiny muted">
            Lo que hay en la cuenta ahora mismo. A partir de aquí sube con los ingresos
            y baja con los gastos que le asignes.
          </span>
        </label>

        <label class="field">
          <span>Color</span>
          <input type="color" data-color value="${esc(account?.color || '#4f46e5')}" style="height:46px;padding:4px">
        </label>

        <button class="btn btn-primary btn-block btn-lg" data-save>${editing ? 'Guardar cambios' : 'Crear cuenta'}</button>
        ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar cuenta</button>' : ''}
      </div>
    `);

    const personalInput = body.querySelector('[data-personal]');
    const hint = body.querySelector('[data-personal-hint]');

    const paintPersonal = () => {
      hint.textContent = personalInput.checked
        ? 'Cuenta en tus ingresos, gastos y tasa de ahorro'
        : 'Queda fuera de tus totales; lo que gastes desde aquí se apunta como pendiente de devolver';
    };
    personalInput.addEventListener('change', paintPersonal);
    paintPersonal();

    body.querySelectorAll('[data-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        kind = btn.dataset.kind;
        body.querySelectorAll('[data-kind]').forEach((b) => {
          const on = b.dataset.kind === kind;
          b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
          b.querySelector('[data-check]').textContent = on ? '✓' : '';
        });
        // El negocio, por defecto, no es dinero propio
        if (!account) {
          personalInput.checked = kind !== 'business';
          paintPersonal();
        }
      });
    });

    const saveBtn = body.querySelector('[data-save]');
    saveBtn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Ponle un nombre a la cuenta', 'err'); return; }

      const payload = {
        name,
        kind,
        color: body.querySelector('[data-color]').value,
        counts_as_personal: personalInput.checked,
        opening_balance: Number(body.querySelector('[data-opening]').value) || 0,
      };

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        if (editing) await updateAccount(account.id, payload);
        else await addAccount(payload);
        close(true);
        toast(editing ? 'Cuenta actualizada' : 'Cuenta creada');
      } catch (err) {
        toast(err.code === '23505' ? 'Ya tienes una cuenta con ese nombre' : (err.message || 'No se pudo guardar'), 'err');
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'Guardar cambios' : 'Crear cuenta';
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmSheet(
        'Eliminar cuenta',
        `Si "${account.name}" tiene movimientos se archivará en vez de borrarse, para no perder de dónde salió cada euro.`,
      );
      if (!ok) return;
      try {
        await deleteAccount(account.id);
        close(true);
        toast('Cuenta eliminada');
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}

/* --------------------------------------------------------------- traspaso --- */

export function openTransferSheet({ fromAccountId = null, toAccountId = null, amount = 0 } = {}) {
  const accounts = accountsList();
  let keypad;

  if (accounts.length < 2) {
    toast('Necesitas al menos dos cuentas para hacer un traspaso', 'err');
    return Promise.resolve(false);
  }

  return openSheet('Traspaso entre cuentas', (close) => {
    keypad = amountKeypad(amount ? Math.round(amount * 100) : 0);

    let from = fromAccountId;
    let to = toAccountId;

    const body = el(`
      <div class="stack">
        <div data-keypad></div>
        <p class="tiny muted center" style="margin:-4px 0 0">
          Mover dinero entre tus cuentas no cuenta como gasto ni como ingreso.
        </p>

        <div>
          <div class="section-title" style="margin-top:6px">Desde</div>
          <div data-from></div>
        </div>
        <div>
          <div class="section-title">Hasta</div>
          <div data-to></div>
        </div>

        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${todayISO()}">
        </label>
        <label class="field">
          <span>Nota (opcional)</span>
          <input type="text" data-note maxlength="120" placeholder="Ej. separar para gastos, devolver al negocio…">
        </label>

        <button class="btn btn-primary btn-block btn-lg" data-save disabled>Guardar traspaso</button>
      </div>
    `);

    body.querySelector('[data-keypad]').appendChild(keypad.node);

    const saveBtn = body.querySelector('[data-save]');
    const refresh = () => {
      const value = keypad.value;
      const ready = value > 0 && from && to && from !== to;
      saveBtn.disabled = !ready;
      saveBtn.textContent = !from || !to ? 'Elige las dos cuentas'
        : from === to ? 'Tienen que ser cuentas distintas'
          : value > 0 ? `Traspasar ${eur(value)}` : 'Guardar traspaso';
    };

    const fromChips = accountChips(from, { onChange: (id) => { from = id; refresh(); } });
    const toChips = accountChips(to, { onChange: (id) => { to = id; refresh(); } });
    body.querySelector('[data-from]').appendChild(fromChips.node);
    body.querySelector('[data-to]').appendChild(toChips.node);

    keypad.onChange(refresh);
    refresh();

    saveBtn.addEventListener('click', async () => {
      const value = keypad.value;
      if (!(value > 0) || !from || !to || from === to) return;

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        await addTransfer({
          from_account_id: from,
          to_account_id: to,
          amount: value,
          date: body.querySelector('[data-date]').value || todayISO(),
          note: body.querySelector('[data-note]').value,
        });
        haptic(18);
        keypad.dispose();
        close(true);
        toast(`Traspaso de ${eur(value)} guardado`);
      } catch (err) {
        toast(err.message || 'No se pudo guardar el traspaso', 'err');
        saveBtn.disabled = false;
        refresh();
      }
    });

    return body;
  }, { onClose: () => keypad?.dispose() });
}
