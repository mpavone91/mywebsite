import { el, esc, toast } from '../utils.js';
import { signIn, signUp } from '../store.js';

/** Login. Un único usuario, email + contraseña; la sesión se guarda en el navegador. */
export function renderAuth() {
  let mode = 'login';

  const wrap = el(`
    <div class="auth-wrap">
      <div class="card auth-card">
        <h1>Finanzas</h1>
        <p class="muted small" style="margin:0 0 18px">Tu control de gastos, siempre a mano.</p>

        <form class="stack" data-form>
          <label class="field">
            <span>Email</span>
            <input type="email" data-email autocomplete="email" required placeholder="tu@email.com">
          </label>
          <label class="field">
            <span>Contraseña</span>
            <input type="password" data-password autocomplete="current-password" required
                   minlength="6" placeholder="••••••••">
          </label>
          <button class="btn btn-primary btn-block btn-lg" type="submit" data-submit>Entrar</button>
        </form>

        <p class="center small muted" style="margin:16px 0 0">
          <span data-switch-text>¿Aún no tienes cuenta?</span>
          <button class="btn btn-ghost" style="min-height:auto;padding:2px 6px" data-switch>Crear una</button>
        </p>
      </div>
    </div>
  `);

  const form = wrap.querySelector('[data-form]');
  const submit = wrap.querySelector('[data-submit]');
  const switchBtn = wrap.querySelector('[data-switch]');
  const switchText = wrap.querySelector('[data-switch-text]');
  const passwordInput = wrap.querySelector('[data-password]');

  switchBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    submit.textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    switchText.textContent = mode === 'login' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?';
    switchBtn.textContent = mode === 'login' ? 'Crear una' : 'Entrar';
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = wrap.querySelector('[data-email]').value.trim();
    const password = passwordInput.value;

    submit.disabled = true;
    const label = submit.textContent;
    submit.innerHTML = '<span class="spinner"></span>';

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        const hasSession = await signUp(email, password);
        if (!hasSession) {
          toast('Cuenta creada. Confirma el email para entrar.');
        }
      }
      // El cambio de pantalla lo dispara onAuthStateChange en app.js
    } catch (err) {
      toast(translateAuthError(err), 'err');
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  return wrap;
}

function translateAuthError(err) {
  const msg = String(err?.message || '');
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos';
  if (/email not confirmed/i.test(msg)) return 'Tienes que confirmar el email antes de entrar';
  if (/already registered|already exists/i.test(msg)) return 'Ese email ya tiene cuenta: entra con tu contraseña';
  if (/password should be at least/i.test(msg)) return 'La contraseña necesita al menos 6 caracteres';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos, prueba en un minuto';
  return msg || 'No se pudo completar la operación';
}

/** Panel de cuenta: email y cierre de sesión. */
export function accountSheetContent(user, onSignOut) {
  const node = el(`
    <div class="stack">
      <div class="card">
        <div class="tiny muted">Sesión iniciada como</div>
        <div style="font-weight:600">${esc(user?.email || '—')}</div>
      </div>
      <p class="tiny muted" style="margin:0">
        Tus datos viven en tu propio proyecto de Supabase y sólo son accesibles con tu usuario
        (RLS activo en todas las tablas).
      </p>
      <button class="btn btn-danger btn-block" data-signout>Cerrar sesión</button>
    </div>
  `);
  node.querySelector('[data-signout]').addEventListener('click', onSignOut);
  return node;
}
