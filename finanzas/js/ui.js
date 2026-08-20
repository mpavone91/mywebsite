import { el, esc, eur, haptic } from './utils.js';

/* ------------------------------------------------------------- bottom sheet --- */

let openSheets = 0;

/**
 * Abre un panel inferior. `render(close)` devuelve el nodo del contenido.
 * Devuelve una promesa que resuelve con el valor pasado a close().
 */
export function openSheet(title, render, { onClose } = {}) {
  return new Promise((resolve) => {
    const backdrop = el('<div class="sheet-backdrop"></div>');
    const sheet = el(`
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <h2>${esc(title)}</h2>
          <button class="btn btn-ghost" data-close aria-label="Cerrar">Cancelar</button>
        </div>
        <div data-body></div>
      </div>
    `);

    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      sheet.remove();
      openSheets -= 1;
      if (openSheets === 0) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      onClose?.(value);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };

    sheet.querySelector('[data-close]').addEventListener('click', () => close(undefined));
    backdrop.addEventListener('click', () => close(undefined));
    document.addEventListener('keydown', onKey);

    sheet.querySelector('[data-body]').appendChild(render(close));

    document.body.append(backdrop, sheet);
    openSheets += 1;
    document.body.style.overflow = 'hidden';

    // Foco al primer control interactivo, sin abrir el teclado del móvil
    const focusable = sheet.querySelector('[data-autofocus]');
    focusable?.focus();
  });
}

/** Confirmación simple. Resuelve a true/false. */
export function confirmSheet(title, message, { confirmLabel = 'Eliminar', danger = true } = {}) {
  return openSheet(title, (close) => {
    const node = el(`
      <div class="stack">
        <p class="muted" style="margin:0 0 4px">${esc(message)}</p>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block btn-lg" data-ok>${esc(confirmLabel)}</button>
      </div>
    `);
    node.querySelector('[data-ok]').addEventListener('click', () => close(true));
    return node;
  }).then((v) => v === true);
}

/* ------------------------------------------------------------------ estados --- */

export function skeletonScreen() {
  return el(`
    <div class="screen">
      <div class="stack">
        <div class="skeleton" style="height:118px"></div>
        <div class="split">
          <div class="skeleton" style="height:74px"></div>
          <div class="skeleton" style="height:74px"></div>
        </div>
        <div class="skeleton" style="height:210px"></div>
      </div>
    </div>
  `);
}

export function emptyState(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

/* ---------------------------------------------------------------- teclado --- */

export function amountKeypad(initialCents = 0) {
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
