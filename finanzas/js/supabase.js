import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// supabase-js se carga como script clásico desde /vendor (ver index.html).
// Va vendorizado a propósito: la app no depende de ningún CDN de terceros,
// la versión queda fijada y no hay una petición extra fuera de nuestro dominio.
const { createClient } = window.supabase;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
