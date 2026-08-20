// Configuración de Supabase.
//
// La clave "publishable" está pensada para vivir en el cliente: no da acceso a
// nada por sí sola, todo pasa por las políticas RLS (user_id = auth.uid()).
// Nunca pongas aquí la service_role key.
//
// En local puedes sobreescribirlas antes de cargar la app con:
//   <script>window.__FINANZAS_CONFIG = { url: '...', key: '...' }</script>

const override = typeof window !== 'undefined' ? window.__FINANZAS_CONFIG || {} : {};

export const SUPABASE_URL = override.url || 'https://yovsllnpmhwvasabsmoc.supabase.co';
export const SUPABASE_KEY = override.key || 'sb_publishable_lnrW3CMNsjW1Y5rYsNEfEw_LC2xYJfT';

// Moneda y locale del usuario
export const LOCALE = 'es-ES';
export const CURRENCY = 'EUR';

// Umbrales del motor de análisis (sección 2.5 de la spec).
// Están aquí para que sean visibles y ajustables sin tocar la lógica.
export const RULES = {
  savingsRateTarget: 0.10,     // alerta si la tasa de ahorro baja del 10%
  savingsRateGood: 0.20,       // a partir de aquí, felicitamos
  spikeThreshold: 0.20,        // categoría disparada: +20% vs media 3 meses
  spikeMinAmount: 25,          // ...y al menos 25 € de diferencia, para no avisar por ruido
  antMaxAmount: 10,            // "gasto hormiga": tickets por debajo de 10 €
  antMinCount: 8,              // hacen falta al menos 8 en el mes
  antMinShare: 0.08,           // o que sumen >= 8% del gasto del mes
  emergencyMonths: 3,          // fondo de emergencia recomendado (meses de gasto)
  budget: { needs: 0.50, wants: 0.30, savings: 0.20 }, // regla 50/30/20
};
