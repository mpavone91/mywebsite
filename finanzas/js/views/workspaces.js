import { el, esc, toast, haptic } from '../utils.js';
import {
  state, activeWorkspace, setWorkspace, createBusinessWorkspace, renameWorkspace,
} from '../store.js';
import { openSheet } from '../ui.js';

/**
 * Selector de espacio: Personal, Empresa…
 *
 * Cambiar de espacio cambia la contabilidad entera, así que no es un filtro
 * más: se recarga todo y se vuelve a la home. Por eso el selector vive en la
 * cabecera, visible pero fuera del camino.
 */

/** Pastilla con el espacio activo, para la cabecera de las pantallas. */
export function workspacePill({ onSwitch }) {
  const current = activeWorkspace();
  if (!current) return null;

  const business = current.kind === 'business';
  const pill = el(`
    <button class="btn" type="button"
            style="min-height:32px;padding:0 12px;font-size:13px;gap:6px;
                   border-color:${esc(current.color)};color:${esc(current.color)}">
      <span>${business ? '🏪' : '🏠'}</span>
      <span style="font-weight:650">${esc(current.name)}</span>
      <span class="muted" style="font-size:11px">▾</span>
    </button>
  `);

  pill.addEventListener('click', () => openWorkspaceSheet({ onSwitch }));
  return pill;
}

/** Panel para cambiar de espacio, renombrarlo o crear el de empresa. */
export function openWorkspaceSheet({ onSwitch } = {}) {
  return openSheet('Tus espacios', (close) => {
    const current = activeWorkspace();
    const hasBusiness = state.workspaces.some((w) => w.kind === 'business');

    const body = el(`
      <div class="stack">
        <p class="tiny muted" style="margin:0">
          Cada espacio lleva su propia contabilidad: sus categorías, sus cuentas, su plan y su
          análisis. Nada se mezcla entre uno y otro.
        </p>
        <div class="stack" data-list></div>
        ${hasBusiness ? '' : `
          <button class="btn btn-primary btn-block" data-new-business>+ Crear espacio de empresa</button>
          <p class="tiny muted" style="margin:0">
            Viene con sus categorías de negocio y sus cuentas de cobro (TPV, online, caja y reservas),
            listo para apuntar los cierres del día.
          </p>`}
      </div>
    `);

    const list = body.querySelector('[data-list]');
    for (const ws of state.workspaces) {
      const active = ws.id === current?.id;
      const row = el(`
        <div class="card row" style="padding:12px 14px;gap:10px;
                                     border-color:${active ? 'var(--accent)' : 'var(--border)'}">
          <span style="font-size:20px">${ws.kind === 'business' ? '🏪' : '🏠'}</span>
          <button type="button" class="grow" data-switch
                  style="background:none;border:0;text-align:left;padding:0;min-width:0">
            <strong style="font-size:15px;display:block">${esc(ws.name)}</strong>
            <span class="tiny muted">${ws.kind === 'business' ? 'Empresa' : 'Personal'}${active ? ' · activo' : ''}</span>
          </button>
          <button type="button" class="btn btn-ghost" data-rename aria-label="Renombrar"
                  style="min-height:34px;padding:0 10px">✎</button>
          ${active ? '<span style="color:var(--accent);font-weight:700">✓</span>' : ''}
        </div>
      `);

      row.querySelector('[data-switch]').addEventListener('click', () => {
        if (active) { close(true); return; }
        if (setWorkspace(ws.id)) {
          haptic(12);
          close(true);
          onSwitch?.();
        }
      });

      row.querySelector('[data-rename]').addEventListener('click', () => {
        close(true);
        openRenameSheet(ws, onSwitch);
      });

      list.appendChild(row);
    }

    body.querySelector('[data-new-business]')?.addEventListener('click', () => {
      close(true);
      openCreateBusinessSheet(onSwitch);
    });

    return body;
  });
}

function openRenameSheet(ws, onChanged) {
  return openSheet('Renombrar espacio', (close) => {
    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Nombre</span>
          <input type="text" data-name maxlength="40" data-autofocus value="${esc(ws.name)}">
        </label>
        <button class="btn btn-primary btn-block btn-lg" data-save>Guardar</button>
      </div>
    `);

    const btn = body.querySelector('[data-save]');
    btn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Ponle un nombre', 'err'); return; }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await renameWorkspace(ws.id, name);
        close(true);
        toast('Espacio renombrado');
        onChanged?.();
      } catch (err) {
        toast(err.message || 'No se pudo renombrar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    });

    return body;
  });
}

function openCreateBusinessSheet(onCreated) {
  return openSheet('Espacio de empresa', (close) => {
    const body = el(`
      <div class="stack">
        <p class="small muted" style="margin:0">
          Una contabilidad aparte para el negocio: los cierres diarios del local, sus gastos,
          sus cuentas y su resultado del mes. No se mezcla con lo tuyo.
        </p>
        <label class="field">
          <span>Nombre del negocio</span>
          <input type="text" data-name maxlength="40" data-autofocus placeholder="Ej. El local">
        </label>
        <div class="card" style="padding:12px 14px">
          <div class="tiny muted" style="margin-bottom:6px">Se crea con</div>
          <div class="tiny">🏦 Cuentas de cobro: TPV / Tarjeta, Cobros online, Caja y Reservas</div>
          <div class="tiny">🏷️ Categorías: Proveedores, Personal, Alquiler, Suministros, Impuestos, Marketing, Mantenimiento</div>
          <div class="tiny">💶 Facturación y Otros ingresos</div>
        </div>
        <button class="btn btn-primary btn-block btn-lg" data-create>Crear espacio</button>
      </div>
    `);

    const btn = body.querySelector('[data-create]');
    btn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim() || 'Empresa';

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const id = await createBusinessWorkspace(name);
        setWorkspace(id);
        haptic(18);
        close(true);
        toast(`Espacio "${name}" creado`);
        onCreated?.();
      } catch (err) {
        toast(err.message || 'No se pudo crear el espacio', 'err');
        btn.disabled = false;
        btn.textContent = 'Crear espacio';
      }
    });

    return body;
  });
}
