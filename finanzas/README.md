# Finanzas Personales

App de control de gastos e ingresos de uso personal, pensada para sustituir el Excel.
Registro rápido desde el móvil, cierre diario y mensual en tiempo real, y un bloque de
análisis automático que explica en qué se va el dinero y qué recortar primero.

- **Frontend**: HTML + JavaScript con módulos ES, sin build step.
- **Datos**: Supabase (Postgres + Auth + RLS).
- **Hosting**: Vercel (estático).
- **Gráficos**: Chart.js.

---

## Puesta en marcha

### 1. Base de datos

El proyecto de Supabase ya está creado y migrado:

| | |
|---|---|
| Proyecto | `finanzas-personales` |
| Ref | `yovsllnpmhwvasabsmoc` |
| URL | `https://yovsllnpmhwvasabsmoc.supabase.co` |
| Región | `eu-west-1` |

Las migraciones están en `supabase/migrations/` y se aplican en orden:

| Archivo | Qué hace |
|---|---|
| `0001_schema.sql` | Tablas `categories`, `incomes`, `expenses` + RLS por `user_id = auth.uid()` |
| `0002_views.sql` | Vistas `movements`, `daily_balance`, `monthly_summary`, `monthly_category_summary` |
| `0003_seed_categories.sql` | Categorías por defecto al crear un usuario (trigger sobre `auth.users`) |
| `0004_harden_functions.sql` | Revoca el `EXECUTE` público de las funciones `SECURITY DEFINER` e indexa las FK |
| `0005_debts.sql` | Deudas y sus pagos + vista `debt_status` con el saldo pendiente |

Para recrear el proyecto desde cero, ejecuta los cinco archivos por orden en el SQL Editor
de Supabase y cambia `SUPABASE_URL` / `SUPABASE_KEY` en `js/config.js`.

### 2. Crear tu usuario

La app usa email + contraseña. La primera vez, pulsa **Crear una** en la pantalla de acceso.
Al darte de alta, el trigger siembra tus 12 categorías iniciales (8 de gasto, 4 de ingreso).

> **Antes de registrarte**, en Supabase → *Authentication* → *Sign In / Providers* → *Email*:
> desactiva **Confirm email**. Es una app de un solo usuario y el SMTP por defecto de Supabase
> tiene límites muy bajos; sin esto te quedarías esperando un correo de confirmación.
> Cuando ya tengas la cuenta creada, conviene desactivar **Allow new users to sign up**
> para que nadie más pueda registrarse.

### 3. Desplegar en Vercel

Es un sitio estático, no hay build:

1. Importa el repo en Vercel.
2. **Root Directory**: `finanzas`
3. **Framework Preset**: *Other* · **Build Command**: vacío · **Output Directory**: vacío

`vercel.json` ya fija las cabeceras de seguridad y el cacheado.

### 4. En local

```bash
cd finanzas
python3 -m http.server 8099
# http://127.0.0.1:8099
```

Hace falta servirlo por HTTP (no `file://`) porque usa módulos ES.

### 5. En el móvil

Abre la URL en el navegador y **añade a la pantalla de inicio**. El manifest declara dos
accesos directos (mantén pulsado el icono): **+ Gasto** y **+ Ingreso**, que abren la app
con el formulario ya desplegado.

---

## Modelo de datos

```
categories    (id, user_id, name, type, color, bucket, is_archived, created_at)
incomes       (id, user_id, amount, category_id, source, date, is_recurring, created_at)
expenses      (id, user_id, amount, category_id, note,   date, is_recurring, created_at)
debts         (id, user_id, name, creditor, kind, initial_amount, annual_rate,
               minimum_payment, due_day, start_date, category_id, note, closed_at)
debt_payments (id, user_id, debt_id, amount, date, expense_id, note, created_at)
```

`type` es `'income' | 'expense'`. `bucket` es `'needs' | 'wants' | 'savings'` y es lo que
alimenta la regla 50/30/20: cada categoría de gasto cuenta como necesidad o deseo según
cómo esté marcada, y se puede cambiar desde la pantalla *Categorías*.

RLS activo en las cinco tablas con `user_id = (select auth.uid())`, tanto en `USING` como en
`WITH CHECK`. Las vistas se crearon con `security_invoker = on`, así que respetan el RLS de
las tablas base en lugar de saltárselo.

Las categorías con movimientos no se borran: se archivan (`is_archived`), para no dejar
huérfano el histórico. Las que no se han usado nunca sí se borran.

El saldo pendiente de una deuda **no se guarda**: siempre se deriva de
`initial_amount − suma de pagos`, así que no puede desincronizarse por muchos pagos que
edites o borres. Cada pago crea además el gasto correspondiente (`expense_id`), para que
salga en el cierre del mes; si borras el pago, se borra también ese gasto.

---

## Reglas del bloque "Análisis"

Cada tarjeta sale de un cálculo sobre los datos reales, no de texto genérico. La lógica está
en `js/analysis.js` (funciones puras) y los umbrales en `js/config.js` → `RULES`:

| Regla | Cuándo salta | Umbral |
|---|---|---|
| **Tasa de ahorro** | `(ingresos − gastos) / ingresos` negativa o por debajo del objetivo | alerta < 0 %, aviso < 10 %, felicita ≥ 20 % |
| **Categoría disparada** | Una categoría supera su media de los 3 meses anteriores | +20 % **y** al menos 25 € de diferencia |
| **Gasto hormiga** | Muchos tickets pequeños que en conjunto pesan | < 10 € por ticket, ≥ 8 tickets o ≥ 8 % del gasto del mes |
| **Gastos fijos** | Suma de los gastos marcados como recurrentes | siempre que haya alguno; se muestra el coste **anual** |
| **Proyección de cierre** | Ritmo diario × días del mes | a partir del día 3 |
| **Regla 50/30/20** | Reparto real necesidades / deseos / ahorro vs. objetivo | 50 / 30 / 20 |
| **Qué recortar primero** | Mayor gasto entre las categorías marcadas como "deseo", priorizando las disparadas | muestra el ahorro anual de recortarlo un 30 % |
| **Fondo de emergencia** | Gasto medio de los últimos 3 meses × 3 | y cuántos meses tardarías a tu ritmo de ahorro |
| **Ingreso recurrente pendiente** | Un ingreso recurrente del mes pasado que aún no aparece este mes | compara por fuente |

Las tarjetas se ordenan por gravedad: primero lo que va mal, luego los avisos, luego el resto.

Las comparaciones "vs. mes anterior" del dashboard usan el **mismo día del mes**
(`prevMonthPace`): a día 8 se compara contra los 8 primeros días del mes pasado, no contra el
mes cerrado, que siempre saldría favorable.

---

## Deudas y plan de salida

La pantalla **Deudas** lleva el control de lo que debes y calcula cómo salir antes.
La lógica está en `js/debts.js`, también en funciones puras.

- **Saldo real**: cada pago baja el pendiente y crea el gasto correspondiente, así que
  el cierre del mes y la tasa de ahorro siguen cuadrando.
- **Simulación mes a mes**: se aplican los intereses (TAE ÷ 12), se pagan las cuotas
  mínimas y todo lo que sobra ataca a la deuda objetivo. Las cuotas de las deudas ya
  liquidadas se reinvierten en las que quedan — el efecto "bola de nieve".
- **Dos estrategias**: *avalancha* (primero el interés más alto, menos intereses en total)
  y *bola de nieve* (primero el saldo más pequeño, se liquida una antes). La app compara
  las dos con tus números y dice cuál te conviene y por cuánto.
- **Cuánto aportar de más**: la aportación extra que propone sale de lo que realmente te
  ha sobrado los últimos meses cerrados, menos un colchón del 20 %. El deslizador deja
  simular cualquier importe y muestra cuántos meses te ahorras y cuántos intereses.
- **Casos sin salida**: si la cuota mínima no cubre ni los intereses, el saldo sube en vez
  de bajar. La simulación lo detecta y lo dice en vez de dar una fecha falsa.

Estas tarjetas también aparecen mezcladas en la pantalla de Análisis, ordenadas por gravedad
junto al resto.

---

## Acceso rápido: PIN y huella

Opcional, se activa desde ⚙ → *Acceso rápido*. Está en `js/lock.js`.

Un PIN que sólo tape la pantalla no protegería nada, así que aquí es de verdad la llave:

- La sesión de Supabase **no se guarda en claro** en ninguna parte. Con el bloqueo activo,
  el cliente la mantiene sólo en memoria y en disco queda cifrada con AES-GCM.
- **Cifrado en sobre**: la sesión se cifra con una clave maestra aleatoria; esa clave se
  guarda envuelta con PBKDF2-SHA256 (250 000 iteraciones) del PIN, y también del secreto de
  la huella. Cuando Supabase rota el token de refresco basta con re-cifrar la sesión: los dos
  métodos siguen abriendo la misma clave maestra.
- **Huella / Face ID** con WebAuthn y la extensión PRF: el autenticador del dispositivo
  devuelve un secreto estable de 32 bytes tras verificarte, y ese secreto hace de llave. No
  necesita servidor porque no se está autenticando contra nadie, sólo derivando una clave.
  Si el dispositivo no soporta PRF, se queda en PIN.
- El **PIN se configura siempre primero**, para que la huella nunca sea el único camino de
  vuelta a tus datos, y la pantalla de bloqueo mantiene un *"Entrar con email y contraseña"*
  como salida de emergencia.
- Tras **5 minutos** en segundo plano se vuelve a pedir.

---

## Estructura

```
finanzas/
├── index.html
├── manifest.webmanifest      instalable en el móvil, con atajos + Gasto / + Ingreso
├── vercel.json
├── css/styles.css            sistema de estilos, claro y oscuro
├── js/
│   ├── config.js             credenciales de Supabase + umbrales del análisis
│   ├── supabase.js           cliente
│   ├── store.js              estado, carga y CRUD
│   ├── analysis.js           motor de análisis (funciones puras)
│   ├── debts.js              motor de deudas: amortización y estrategias de salida
│   ├── lock.js               acceso con PIN / huella y cifrado de la sesión
│   ├── charts.js             envoltorio de Chart.js
│   ├── ui.js                 paneles inferiores, confirmaciones, estados de carga
│   ├── app.js                router y navegación
│   └── views/                dashboard · add-movement · debts · analysis · history
│                             categories · auth · lock
├── vendor/                   supabase-js y chart.js con la versión fijada
└── supabase/migrations/
```

## Decisiones de implementación

**JavaScript vanilla en vez de React.** Son seis pantallas y el estado cabe en un objeto; un
framework habría añadido un paso de build sin aportar nada. Sin build step, `git push` es todo
el despliegue.

**CSS propio en vez de Tailwind.** La spec proponía Tailwind, pero sin build step la única
opción era el CDN de Play, que compila las clases en el navegador en cada carga. Para una app
que se abre a diario desde el móvil salía más caro que un archivo de estilos de ~500 líneas
con custom properties, que además da control directo sobre el tema oscuro, las áreas seguras
del notch y los tamaños de pulsación. Si en algún momento se añade un build, el cambio es
mecánico.

**Librerías vendorizadas** (`vendor/`) en vez de CDN: la app no depende de que jsDelivr esté
disponible, las versiones quedan fijadas y no hay peticiones a terceros.

**Los agregados se calculan en el cliente.** La app carga una ventana de 13 meses al arrancar
(unos cientos de filas) y calcula todo en memoria: navegar entre pantallas es instantáneo y
las reglas del análisis viven en un único sitio auditable. El histórico profundo va ampliando
esa ventana hacia atrás bajo demanda. Las vistas SQL quedan disponibles para consultas
puntuales desde el propio Supabase.

**El importe se teclea en céntimos.** El teclado numérico propio interpreta `1·2·5·0` como
12,50 €: no hay que buscar la coma ni abrir el teclado del sistema. Las categorías salen
ordenadas por uso de los últimos 60 días, así que la que se busca suele ser la primera.

## Fuera del MVP

- OCR de tickets y extractos bancarios con categorización automática.
- Conexión directa con bancos (open banking / PSD2).
- Multiusuario. El modelo de datos ya está preparado (`user_id` en todas las tablas + RLS),
  sólo faltaría la parte de compartir.
