import { el, esc, eur, todayISO, toast, haptic } from '../utils.js';
import { openSheet, confirmSheet } from '../ui.js';
import {
  addExpense, addIncome, updateMovement, deleteMovement,
  frequentExpenseCategories, categoriesOf, state,
} from '../store.js';

/**
 * Alta de movimientos.
 *
 * El flujo de "añadir gasto" es el que más se usa, así que va en un panel
 * inferior con teclado numérico propio: los importes se teclean en céntimos
 * (1·2·5·0 -> 12,50 €), no hace falta buscar la coma ni abrir el teclado del
 * sistema, y las categorías salen ordenadas por uso reciente.
 */

/* ---------------------------------------------------------------- teclado --- */

function amountKeypad(initialCents = 0) {
  const node = el(`
    <div>
      <div class="amount-display">
        <div class="val num" data-val>0,00 €</div>
        <div class="hint" data-hint>Teclea el importe</div>
      </div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="00">00</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Borrar">⌫</button>
      </div>
    </div>
  `);

  let cents = initialCents;
  const listeners = [];
  const valEl = node.querySelector('[data-val]');

  function paint() {
    valEl.textContent = eur(cents / 100);
    valEl.classList.toggle('muted', cents === 0);
    listeners.forEach((fn) => fn(cents / 100));
  }

  node.querySelectorAll('[data-k]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k === 'del') cents = Math.floor(cents / 10);
      else if (cents < 1e9) cents = cents * (k === '00' ? 100 : 10) + Number(k);
      haptic(8);
      paint();
    });
  });

  // También se puede teclear con un teclado físico, salvo cuando el foco está
  // en un campo de texto (nota, fuente…): allí los dígitos son del campo.
  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key >= '0' && e.key <= '9') { cents = cents * 10 + Number(e.key); paint(); }
    else if (e.key === 'Backspace') { cents = Math.floor(cents / 10); paint(); }
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  paint();

  return {
    node,
    get value() { return cents / 100; },
    onChange(fn) { listeners.push(fn); fn(cents / 100); },
    setHint(text) { node.querySelector('[data-hint]').textContent = text; },
    dispose() { document.removeEventListener('keydown', onKey); },
  };
}

/* ------------------------------------------------------------- categorías --- */

function categoryChips(categories, selectedId = null) {
  const node = el(`<div class="chips">${categories.map((c) => `
    <button type="button" class="chip" data-id="${c.id}" style="color:${esc(c.color)}"
            aria-pressed="${c.id === selectedId}">
      <span class="dot" style="background:${esc(c.color)}"></span>
      <span style="color:var(--text)">${esc(c.name)}</span>
    </button>`).join('')}</div>`);

  let selected = selectedId;
  const listeners = [];

  node.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      selected = chip.dataset.id === selected ? null : chip.dataset.id;
      node.querySelectorAll('.chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(c.dataset.id === selected));
      });
      haptic(8);
      listeners.forEach((fn) => fn(selected));
    });
  });

  return {
    node,
    get value() { return selected; },
    onChange(fn) { listeners.push(fn); },
  };
}

/* ------------------------------------------------------------ alta gasto --- */

export function openExpenseSheet({ movement = null, onSaved } = {}) {
  const editing = Boolean(movement);
  const cats = frequentExpenseCategories();
  let keypad;

  return openSheet(editing ? 'Editar gasto' : 'Nuevo gasto', (close) => {
    keypad = amountKeypad(editing ? Math.round(movement.amount * 100) : 0);
    const chips = categoryChips(cats, movement?.category_id ?? null);

    const body = el(`
      <div class="stack">
        <div data-keypad></div>
        <div>
          <div class="section-title" style="margin-top:14px">Categoría</div>
          <div data-chips></div>
        </div>
        <details data-more ${editing ? 'open' : ''}>
          <summary class="muted small" style="cursor:pointer;padding:8px 0">Fecha, nota y recurrencia</summary>
          <div class="stack" style="padding-top:8px">
            <label class="field">
              <span>Fecha</span>
              <input type="date" data-date value="${esc(movement?.date || todayISO())}">
            </label>
            <label class="field">
              <span>Nota (opcional)</span>
              <input type="text" data-note maxlength="120" placeholder="Ej. Netflix, cena con Ana…"
                     value="${esc(movement?.note || '')}">
            </label>
            <label class="switch card" style="padding:12px 14px">
              <span>
                <strong style="font-size:15px">Gasto recurrente</strong>
                <span class="tiny muted" style="display:block">Suscripciones, alquiler, cuotas…</span>
              </span>
              <input type="checkbox" data-recurring ${movement?.is_recurring ? 'checked' : ''}>
            </label>
          </div>
        </details>
        <button class="btn btn-primary btn-block btn-lg" data-save disabled>Guardar gasto</button>
        ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar gasto</button>' : ''}
      </div>
    `);

    body.querySelector('[data-keypad]').appendChild(keypad.node);
    body.querySelector('[data-chips]').appendChild(chips.node);

    const saveBtn = body.querySelector('[data-save]');
    const refresh = () => {
      const amount = keypad.value;
      saveBtn.disabled = !(amount > 0);
      saveBtn.textContent = amount > 0 ? `Guardar ${eur(amount)}` : 'Guardar gasto';
    };
    keypad.onChange(refresh);
    chips.onChange(refresh);

    saveBtn.addEventListener('click', async () => {
      const amount = keypad.value;
      if (!(amount > 0)) return;

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      const payload = {
        amount,
        category_id: chips.value,
        note: body.querySelector('[data-note]').value,
        date: body.querySelector('[data-date]').value || todayISO(),
        is_recurring: body.querySelector('[data-recurring]').checked,
      };

      try {
        if (editing) await updateMovement('expense', movement.id, payload);
        else await addExpense(payload);
        haptic(18);
        keypad.dispose();
        close(true);
        toast(editing ? 'Gasto actualizado' : `Gasto de ${eur(amount)} guardado`);
        onSaved?.();
      } catch (err) {
        toast(err.message || 'No se pudo guardar el gasto', 'err');
        saveBtn.disabled = false;
        refresh();
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmSheet('Eliminar gasto', `Se borrará el gasto de ${eur(movement.amount)}. No se puede deshacer.`);
      if (!ok) return;
      try {
        await deleteMovement('expense', movement.id);
        keypad.dispose();
        close(true);
        toast('Gasto eliminado');
        onSaved?.();
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  }, { onClose: () => keypad?.dispose() });
}

/* ---------------------------------------------------------- alta ingreso --- */

export function openIncomeSheet({ movement = null, prefill = null, onSaved } = {}) {
  const editing = Boolean(movement);
  const cats = categoriesOf('income');

  // Fuentes ya usadas, para autocompletar
  const sources = [...new Set(state.incomes.map((i) => i.source).filter(Boolean))].slice(0, 12);
  let keypad;

  return openSheet(editing ? 'Editar ingreso' : 'Nuevo ingreso', (close) => {
    const initial = movement || prefill;
    keypad = amountKeypad(initial?.amount ? Math.round(initial.amount * 100) : 0);
    const chips = categoryChips(cats, initial?.category_id ?? null);

    const body = el(`
      <div class="stack">
        <div data-keypad></div>
        <label class="field">
          <span>Fuente</span>
          <input type="text" data-source list="income-sources" maxlength="80"
                 placeholder="Ej. Nómina ePackPro" value="${esc(initial?.source || '')}">
          <datalist id="income-sources">
            ${sources.map((s) => `<option value="${esc(s)}"></option>`).join('')}
          </datalist>
        </label>
        <div>
          <div class="section-title" style="margin-top:6px">Categoría</div>
          <div data-chips></div>
        </div>
        <label class="field">
          <span>Fecha</span>
          <input type="date" data-date value="${esc(movement?.date || todayISO())}">
        </label>
        <label class="switch card" style="padding:12px 14px">
          <span>
            <strong style="font-size:15px">Ingreso recurrente</strong>
            <span class="tiny muted" style="display:block">La app te recordará apuntarlo cada mes</span>
          </span>
          <input type="checkbox" data-recurring ${(initial?.is_recurring ?? true) ? 'checked' : ''}>
        </label>
        <button class="btn btn-primary btn-block btn-lg" data-save disabled>Guardar ingreso</button>
        ${editing ? '<button class="btn btn-danger btn-block" data-delete>Eliminar ingreso</button>' : ''}
      </div>
    `);

    body.querySelector('[data-keypad]').appendChild(keypad.node);
    body.querySelector('[data-chips]').appendChild(chips.node);

    const saveBtn = body.querySelector('[data-save]');
    const refresh = () => {
      const amount = keypad.value;
      saveBtn.disabled = !(amount > 0);
      saveBtn.textContent = amount > 0 ? `Guardar ${eur(amount)}` : 'Guardar ingreso';
    };
    keypad.onChange(refresh);

    saveBtn.addEventListener('click', async () => {
      const amount = keypad.value;
      if (!(amount > 0)) return;

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      const payload = {
        amount,
        category_id: chips.value,
        source: body.querySelector('[data-source]').value,
        date: body.querySelector('[data-date]').value || todayISO(),
        is_recurring: body.querySelector('[data-recurring]').checked,
      };

      try {
        if (editing) await updateMovement('income', movement.id, payload);
        else await addIncome(payload);
        haptic(18);
        keypad.dispose();
        close(true);
        toast(editing ? 'Ingreso actualizado' : `Ingreso de ${eur(amount)} guardado`);
        onSaved?.();
      } catch (err) {
        toast(err.message || 'No se pudo guardar el ingreso', 'err');
        saveBtn.disabled = false;
        refresh();
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmSheet('Eliminar ingreso', `Se borrará el ingreso de ${eur(movement.amount)}. No se puede deshacer.`);
      if (!ok) return;
      try {
        await deleteMovement('income', movement.id);
        keypad.dispose();
        close(true);
        toast('Ingreso eliminado');
        onSaved?.();
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  }, { onClose: () => keypad?.dispose() });
}
