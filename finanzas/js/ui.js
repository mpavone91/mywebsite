import { el, esc } from './utils.js';

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
