import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { isConfigured } from './lock.js';

// supabase-js se carga como script clásico desde /vendor (ver index.html).
// Va vendorizado a propósito: la app no depende de ningún CDN de terceros,
// la versión queda fijada y no hay una petición extra fuera de nuestro dominio.
const { createClient } = window.supabase;

/**
 * Almacenamiento de la sesión.
 *
 * Sin bloqueo configurado se comporta como siempre (localStorage), para que no
 * haya que volver a escribir la contraseña en cada recarga.
 *
 * Con PIN o huella activados, los tokens viven SÓLO en memoria: quien los
 * persiste es lock.js, y cifrados. Así el PIN no es un adorno — sin él no hay
 * nada legible en el dispositivo.
 */
const memory = new Map();

const storage = {
  getItem: (key) => (isConfigured() ? memory.get(key) ?? null : localStorage.getItem(key)),
  setItem: (key, value) => {
    memory.set(key, value);
    if (!isConfigured()) localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
    localStorage.removeItem(key);
  },
};

/** Borra del disco cualquier sesión en claro. Se llama al activar el bloqueo. */
export function purgePlainSession() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('sb-') && key.includes('auth-token')) localStorage.removeItem(key);
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
