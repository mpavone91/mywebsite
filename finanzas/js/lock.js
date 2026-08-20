/**
 * Bloqueo del dispositivo: entrar con PIN o con huella / Face ID.
 *
 * Cómo funciona y por qué así:
 *
 * Un PIN que sólo tape la pantalla no protege nada — cualquiera podría abrir
 * las herramientas del navegador y leer la sesión. Aquí el PIN es de verdad la
 * llave: la sesión de Supabase NO se guarda en claro en ninguna parte. El
 * cliente la mantiene sólo en memoria (ver supabase.js) y aquí se guarda
 * cifrada con AES-GCM. Sin el PIN correcto no hay nada que descifrar.
 *
 * La huella usa WebAuthn con la extensión PRF: el autenticador del dispositivo
 * devuelve un secreto estable de 32 bytes tras verificarte biométricamente, y
 * ese secreto hace de llave igual que el PIN. Nunca sale del dispositivo y no
 * necesita servidor, porque no estamos autenticando contra nadie: sólo
 * derivando una clave. Si el dispositivo no soporta PRF, se queda en PIN.
 *
 * Estructura (cifrado en sobre):
 *
 *   session   → cifrada con una clave maestra aleatoria
 *   pin       → la clave maestra, envuelta con PBKDF2(PIN)
 *   biometric → la clave maestra, envuelta con PBKDF2(secreto PRF)
 *
 * Así, cuando Supabase rota el token de refresco basta con volver a cifrar el
 * bloque `session`: los dos métodos siguen abriendo la misma clave maestra.
 * El PIN se configura siempre primero, para que la huella nunca sea el único
 * camino de vuelta a tus datos.
 */

const STORE_KEY = 'finanzas.lock.v3';
const ITERATIONS = 250_000;

/* ------------------------------------------------------------- utilidades --- */

const b64 = {
  to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  from: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || null;
  } catch {
    return null;
  }
}

function writeStore(value) {
  if (value) localStorage.setItem(STORE_KEY, JSON.stringify(value));
  else localStorage.removeItem(STORE_KEY);
}

async function wrappingKey(secret, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    typeof secret === 'string' ? new TextEncoder().encode(secret) : secret,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64.to(iv), data: b64.to(cipher) };
}

async function unseal(key, record) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.from(record.iv) },
    key,
    b64.from(record.data),
  );
  return new Uint8Array(plain);
}

const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value));
const decodeJson = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

const importMaster = (bytes) =>
  crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Sólo guardamos lo justo para restaurar la sesión. */
const sessionPayload = (session) => ({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});

/* ------------------------------------------------------------------ estado --- */

// Clave maestra recuperada en el desbloqueo. Vive en memoria mientras la app
// está abierta, para re-cifrar la sesión cada vez que el token rota y para
// poder envolverla con un método nuevo (añadir la huella).
let masterKey = null;
let masterBytes = null;
let activeMethod = null;

async function useMaster(bytes, method) {
  masterBytes = bytes;
  masterKey = await importMaster(bytes);
  activeMethod = method;
  return masterKey;
}

export const isConfigured = () => Boolean(readStore()?.pin);
export const hasBiometrics = () => Boolean(readStore()?.biometric);
export const isUnlocked = () => masterKey !== null;
export const lockMethod = () => activeMethod;

export function lockNow() {
  masterKey = null;
  masterBytes = null;
  activeMethod = null;
}

export function disable() {
  writeStore(null);
  lockNow();
}

export const validPin = (pin) => /^\d{4,8}$/.test(pin);

/* ------------------------------------------------------------------- PIN --- */

/** Activa el bloqueo por PIN a partir de la sesión abierta. */
export async function enablePin(pin, session) {
  if (!validPin(pin)) throw new Error('El PIN debe tener entre 4 y 8 dígitos');

  const master = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await wrappingKey(pin, salt);

  await useMaster(master, 'pin');

  writeStore({
    v: 3,
    session: await seal(masterKey, encodeJson(sessionPayload(session))),
    pin: { salt: b64.to(salt), ...(await seal(key, master)) },
    biometric: null,
  });
}

/** Descifra la sesión con el PIN. Lanza si el PIN es incorrecto. */
export async function unlockWithPin(pin) {
  const store = readStore();
  if (!store?.pin) throw new Error('No hay ningún PIN configurado');

  const key = await wrappingKey(pin, b64.from(store.pin.salt));
  let master;
  try {
    master = await unseal(key, store.pin);
  } catch {
    throw new Error('PIN incorrecto');
  }

  await useMaster(master, 'pin');
  return decodeJson(await unseal(masterKey, store.session));
}

/** Cambia el PIN sin tocar la clave maestra (la huella sigue funcionando). */
export async function changePin(currentPin, nextPin) {
  if (!validPin(nextPin)) throw new Error('El PIN debe tener entre 4 y 8 dígitos');
  const store = readStore();
  if (!store?.pin) throw new Error('No hay ningún PIN configurado');

  const currentKey = await wrappingKey(currentPin, b64.from(store.pin.salt));
  let master;
  try {
    master = await unseal(currentKey, store.pin);
  } catch {
    throw new Error('El PIN actual no es correcto');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await wrappingKey(nextPin, salt);
  writeStore({ ...store, pin: { salt: b64.to(salt), ...(await seal(key, master)) } });
}

/* -------------------------------------------------------------- biometría --- */

export async function biometricsSupported() {
  if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Registra la huella envolviendo la MISMA clave maestra que el PIN.
 * Requiere estar desbloqueado (el PIN ya puesto en esta sesión).
 */
export async function enableBiometrics({ userId, userName }) {
  const store = readStore();
  if (!store?.pin) throw new Error('Configura antes un PIN de respaldo');
  if (!masterBytes) throw new Error('Desbloquea con tu PIN antes de añadir la huella');

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Finanzas', id: location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: { prf: {} },
    },
  });

  if (!credential) throw new Error('No se pudo registrar la huella');
  if (credential.getClientExtensionResults()?.prf?.enabled === false) {
    throw new Error('Este dispositivo no puede derivar una clave de la huella. Sigue usando el PIN.');
  }

  const credentialId = b64.to(credential.rawId);
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  // El secreto PRF sólo se obtiene en una verificación, así que pedimos una
  // inmediatamente después de registrar.
  const secret = await evaluatePrf(credentialId, prfSalt);
  if (!secret) throw new Error('Este dispositivo no devolvió una clave para la huella. Sigue usando el PIN.');

  // Envolvemos la MISMA clave maestra con la clave derivada de la huella
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await wrappingKey(secret, salt);

  writeStore({
    ...store,
    biometric: {
      salt: b64.to(salt),
      credentialId,
      prfSalt: b64.to(prfSalt),
      ...(await seal(key, masterBytes)),
    },
  });
}

/** Descifra la sesión tras verificar la huella / Face ID. */
export async function unlockWithBiometrics() {
  const store = readStore();
  if (!store?.biometric) throw new Error('No hay huella configurada');

  const secret = await evaluatePrf(store.biometric.credentialId, b64.from(store.biometric.prfSalt));
  if (!secret) throw new Error('No se pudo leer la huella');

  const key = await wrappingKey(secret, b64.from(store.biometric.salt));
  let master;
  try {
    master = await unseal(key, store.biometric);
  } catch {
    throw new Error('La huella no abre esta sesión. Entra con el PIN.');
  }

  await useMaster(master, 'biometric');
  return decodeJson(await unseal(masterKey, store.session));
}

export function removeBiometrics() {
  const store = readStore();
  if (store) writeStore({ ...store, biometric: null });
}

async function evaluatePrf(credentialId, prfSalt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: b64.from(credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });

  const first = assertion?.getClientExtensionResults()?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/* -------------------------------------------------- re-cifrado en caliente --- */

/**
 * Vuelve a guardar la sesión cifrada. Hay que llamarlo cada vez que Supabase
 * rota el token de refresco: si guardásemos siempre el primero, al cabo de unos
 * días quedaría caducado y el desbloqueo dejaría de servir.
 */
export async function persistSession(session) {
  const store = readStore();
  if (!store?.pin || !masterKey || !session) return;
  writeStore({ ...store, session: await seal(masterKey, encodeJson(sessionPayload(session))) });
}
