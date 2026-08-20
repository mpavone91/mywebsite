import { el, esc, toast, haptic } from '../utils.js';
import { openSheet, confirmSheet } from '../ui.js';
import * as lock from '../lock.js';

const PIN_LENGTH = 6;

/* ------------------------------------------------------- teclado de PIN --- */

/**
 * Pantalla de introducción de PIN: puntitos + teclado numérico.
 * `onComplete(pin)` se dispara al llegar a PIN_LENGTH dígitos.
 */
function pinPad({ title, hint, onComplete, showBiometrics = false, onBiometrics, footer = '' }) {
  const node = el(`
    <div class="stack" style="gap:18px">
      <div class="center">
        <h2 style="margin:0 0 4px;font-size:20px;letter-spacing:-.02em">${esc(title)}</h2>
        <p class="small muted" data-hint style="margin:0">${esc(hint)}</p>
      </div>

      <div class="pin-dots" data-dots>
        ${Array.from({ length: PIN_LENGTH }, () => '<i></i>').join('')}
      </div>

      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        ${showBiometrics
    ? '<button type="button" data-bio aria-label="Entrar con huella" style="font-size:22px">☝︎</button>'
    : '<span></span>'}
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Borrar">⌫</button>
      </div>

      ${footer}
    </div>
  `);

  let pin = '';
  const dots = node.querySelectorAll('[data-dots] i');
  const hintEl = node.querySelector('[data-hint]');

  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));

  const reset = (message) => {
    pin = '';
    paint();
    if (message) {
      hintEl.textContent = message;
      hintEl.classList.add('neg');
      node.querySelector('[data-dots]').classList.add('shake');
      setTimeout(() => node.querySelector('[data-dots]')?.classList.remove('shake'), 400);
    }
  };

  node.querySelectorAll('[data-k]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const k = btn.dataset.k;
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < PIN_LENGTH) pin += k;
      haptic(8);
      paint();

      if (pin.length === PIN_LENGTH) {
        const value = pin;
        setTimeout(() => onComplete(value, { reset, node }), 120);
      }
    });
  });

  const setHint = (t) => { hintEl.textContent = t; hintEl.classList.remove('neg'); };

  node.querySelector('[data-bio]')?.addEventListener('click', () => {
    // El navegador abre su propio diálogo y puede tardar: que no parezca colgado
    setHint('Esperando tu huella…');
    onBiometrics?.({ reset, setHint });
  });

  return { node, reset, setHint };
}

/* --------------------------------------------------- pantalla de entrada --- */

/**
 * Pantalla de desbloqueo. `onUnlock(session)` recibe los tokens descifrados;
 * `onUsePassword()` cae de vuelta al login normal con email y contraseña.
 */
export function renderLockScreen({ onUnlock, onUsePassword }) {
  const biometrics = lock.hasBiometrics();
  let attempts = 0;

  const wrap = el(`
    <div class="auth-wrap">
      <div class="card auth-card" data-card></div>
    </div>
  `);

  const pad = pinPad({
    title: 'Introduce tu PIN',
    hint: `${PIN_LENGTH} dígitos`,
    showBiometrics: biometrics,
    footer: '<button class="btn btn-ghost btn-block" data-password>Entrar con email y contraseña</button>',
    onBiometrics: async ({ reset }) => {
      try {
        const session = await lock.unlockWithBiometrics();
        haptic(18);
        onUnlock(session);
      } catch (err) {
        reset(err.message || 'No se pudo verificar la huella');
      }
    },
    onComplete: async (pin, { reset }) => {
      try {
        const session = await lock.unlockWithPin(pin);
        haptic(18);
        onUnlock(session);
      } catch {
        attempts += 1;
        reset(attempts >= 3
          ? `PIN incorrecto (${attempts}). ¿Lo has olvidado? Entra con tu contraseña.`
          : 'PIN incorrecto');
      }
    },
  });

  wrap.querySelector('[data-card]').appendChild(pad.node);

  wrap.querySelector('[data-password]').addEventListener('click', async () => {
    const ok = await confirmSheet(
      'Entrar con contraseña',
      'Se borrará el PIN y la huella de este dispositivo. Podrás volver a configurarlos después de entrar.',
      { confirmLabel: 'Continuar', danger: false },
    );
    if (!ok) return;
    lock.disable();
    onUsePassword();
  });

  // Si hay huella, la ofrecemos nada más abrir: es el camino rápido
  if (biometrics) {
    queueMicrotask(() => wrap.querySelector('[data-bio]')?.focus());
  }

  return wrap;
}

/* ------------------------------------------------------------- configurar --- */

/** Alta del PIN (con confirmación) y, si el dispositivo puede, de la huella. */
export function openLockSetupSheet({ session, user, onDone }) {
  return openSheet('Acceso rápido', (close) => {
    const host = el('<div></div>');
    let first = null;

    const askFirst = () => {
      const pad = pinPad({
        title: 'Elige un PIN',
        hint: `${PIN_LENGTH} dígitos para entrar sin escribir la contraseña`,
        onComplete: (pin, { reset }) => {
          first = pin;
          reset();
          askConfirm();
        },
      });
      host.replaceChildren(pad.node);
    };

    const askConfirm = () => {
      const pad = pinPad({
        title: 'Repite el PIN',
        hint: 'Para asegurarnos de que no hay erratas',
        onComplete: async (pin, { reset }) => {
          if (pin !== first) {
            first = null;
            reset();
            askFirst();
            toast('Los PIN no coincidían, empieza de nuevo', 'err');
            return;
          }
          try {
            await lock.enablePin(pin, session);
            await offerBiometrics();
          } catch (err) {
            toast(err.message || 'No se pudo guardar el PIN', 'err');
            reset('Inténtalo otra vez');
          }
        },
      });
      host.replaceChildren(pad.node);
    };

    const offerBiometrics = async () => {
      const supported = await lock.biometricsSupported();
      if (!supported) {
        close(true);
        toast('PIN activado');
        onDone?.();
        return;
      }

      const view = el(`
        <div class="stack center">
          <div style="font-size:44px">☝︎</div>
          <h2 style="margin:0;font-size:20px">PIN activado</h2>
          <p class="small muted" style="margin:0">
            ¿Quieres entrar también con tu huella o Face ID? El PIN seguirá funcionando como respaldo.
          </p>
          <button class="btn btn-primary btn-block btn-lg" data-bio>Activar huella</button>
          <button class="btn btn-ghost btn-block" data-skip>Ahora no</button>
        </div>
      `);

      view.querySelector('[data-bio]').addEventListener('click', async () => {
        const btn = view.querySelector('[data-bio]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const mode = await enableBiometricsWithConsent(user);
          close(true);
          toast(mode ? 'Huella activada' : 'PIN activado');
          onDone?.();
        } catch (err) {
          toast(err.message || 'No se pudo activar la huella', 'err');
          btn.disabled = false;
          btn.textContent = 'Activar huella';
        }
      });

      view.querySelector('[data-skip]').addEventListener('click', () => {
        close(true);
        toast('PIN activado');
        onDone?.();
      });

      host.replaceChildren(view);
    };

    askFirst();
    return host;
  });
}

/* ------------------------------------------------------- alta de la huella --- */

/**
 * Activa la huella pidiendo permiso explícito si el dispositivo no soporta PRF.
 *
 * Sin PRF la huella deja de ser la llave y pasa a ser una simple comprobación:
 * la clave que abre la sesión queda guardada en el dispositivo sin cifrar. Es
 * una rebaja real de seguridad, así que se pregunta antes de dejarla puesta.
 *
 * Registramos la credencial permitiendo ya el modo simple para no crear dos
 * claves de acceso distintas; si el usuario dice que no, se deshace al momento.
 *
 * Devuelve 'prf', 'gate' o null si se canceló.
 */
async function enableBiometricsWithConsent(user) {
  const mode = await lock.enableBiometrics({
    userId: user.id,
    userName: user.email,
    allowFallback: true,
  });

  if (mode !== 'gate') return mode;

  const ok = await confirmSheet(
    'Tu móvil no puede usar la huella como llave',
    'Puedo activarla igualmente, pero entonces sólo sirve de comprobación: la sesión quedará guardada en este móvil sin cifrar, así que quien lo tenga desbloqueado podría leerla. El PIN seguirá funcionando como siempre.',
    { confirmLabel: 'Activarla igualmente', danger: false },
  );

  if (!ok) {
    lock.removeBiometrics();
    return null;
  }
  return 'gate';
}

/* -------------------------------------------------- ajustes desde la cuenta --- */

/** Bloque de gestión del bloqueo, para el panel de cuenta. */
export function lockSettings({ session, user, onChanged }) {
  const configured = lock.isConfigured();
  const withBio = lock.hasBiometrics();

  const node = el(`
    <div class="card stack" style="padding:12px 14px">
      <div class="row-between">
        <span>
          <strong style="font-size:15px">Acceso rápido</strong>
          <span class="tiny muted" style="display:block" data-state></span>
        </span>
      </div>
      <div class="stack" data-actions></div>
    </div>
  `);

  const stateEl = node.querySelector('[data-state]');
  const actions = node.querySelector('[data-actions]');

  stateEl.textContent = !configured
    ? 'Desactivado: entras con email y contraseña'
    : !withBio ? 'PIN activado'
      : lock.biometricMode() === 'gate'
        ? 'PIN y huella · la huella sólo comprueba, la sesión no va cifrada'
        : 'PIN y huella activados';

  if (!configured) {
    const btn = el('<button class="btn btn-block" data-setup>Activar PIN o huella</button>');
    btn.addEventListener('click', () => {
      openLockSetupSheet({ session, user, onDone: onChanged });
    });
    actions.appendChild(btn);
  } else {
    if (!withBio) {
      const btn = el('<button class="btn btn-block" data-addbio>Añadir huella / Face ID</button>');
      btn.addEventListener('click', async () => {
        if (!lock.isUnlocked()) {
          toast('Cierra la app y vuelve a entrar con tu PIN para añadir la huella', 'err');
          return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const mode = await enableBiometricsWithConsent(user);
          if (mode) toast('Huella activada');
          onChanged?.();
        } catch (err) {
          toast(err.message || 'No se pudo activar la huella', 'err');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Añadir huella / Face ID';
        }
      });
      actions.appendChild(btn);
    } else {
      const btn = el('<button class="btn btn-block" data-rmbio>Quitar huella</button>');
      btn.addEventListener('click', () => {
        lock.removeBiometrics();
        toast('Huella eliminada');
        onChanged?.();
      });
      actions.appendChild(btn);
    }

    const off = el('<button class="btn btn-danger btn-block" data-off>Desactivar acceso rápido</button>');
    off.addEventListener('click', async () => {
      const ok = await confirmSheet(
        'Desactivar acceso rápido',
        'Volverás a entrar con email y contraseña, y la sesión se guardará sin cifrar en este dispositivo.',
        { confirmLabel: 'Desactivar' },
      );
      if (!ok) return;
      lock.disable();
      toast('Acceso rápido desactivado');
      onChanged?.();
    });
    actions.appendChild(off);
  }

  return node;
}
