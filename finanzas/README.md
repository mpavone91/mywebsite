# Finanzas Personales

App de control de gastos e ingresos, pensada para sustituir el Excel. Cada persona que se
registra tiene sus propios datos, aislados por RLS.
Registro rápido desde el móvil, cierre diario y mensual en tiempo real, y un bloque de
análisis automático que explica en qué se va el dinero y qué recortar primero.
Además de lo personal, cada usuario puede llevar la contabilidad de un negocio en un espacio
aparte, con los cierres diarios del local.

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
| `0006_accounts.sql` | Cuentas (bancos), traspasos, `account_id` en gastos e ingresos + vista `account_balances` |
| `0007_generic_seed.sql` | Categorías sembradas genéricas (sin nombres propios) y limpieza de las ya creadas |
| `0008_fixed_items.sql` | Plan mensual: ingresos y gastos fijos + vista `fixed_items_monthly` |
| `0009_variable_fixed_items.sql` | Apuntes del plan con importe variable (media de lo registrado) |
| `0010_workspaces.sql` | Espacios de trabajo: `workspaces` + `workspace_id` en las ocho tablas |
| `0011_workspace_default.sql` | `default_workspace()` como DEFAULT de `workspace_id` |
| `0012_daily_closings.sql` | Cierres diarios del local, cuentas de cobro y `create_business_workspace()` |

Para recrear el proyecto desde cero, ejecuta los doce archivos por orden en el SQL Editor
de Supabase y cambia `SUPABASE_URL` / `SUPABASE_KEY` en `js/config.js`.

### 2. Crear tu usuario

La app usa email + contraseña. La primera vez, pulsa **Crear una** en la pantalla de acceso.
Al darte de alta, el trigger siembra tus 12 categorías iniciales (8 de gasto, 4 de ingreso).

> **Antes de registrarte**, en Supabase → *Authentication* → *Sign In / Providers* → *Email*:
> desactiva **Confirm email**. El SMTP por defecto de Supabase tiene límites muy bajos; sin
> esto te quedarías esperando un correo de confirmación. Y cuando ya estén dadas de alta las
> personas que van a usarla, desactiva **Allow new users to sign up** para cerrar el registro.

Las categorías por defecto son genéricas a propósito (Nómina, Negocio, Extras, Otros
ingresos): cada persona las renombra a su gusto desde ⚙ → *Categorías*. Lo mismo con las
cuentas sugeridas, que son tipos y no marcas.

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
workspaces    (id, user_id, name, kind, color, is_default, created_at)
categories    (id, user_id, name, type, color, bucket, is_archived, created_at)
incomes       (id, user_id, amount, category_id, source, date, is_recurring, created_at)
expenses      (id, user_id, amount, category_id, note,   date, is_recurring, created_at)
debts         (id, user_id, name, creditor, kind, initial_amount, annual_rate,
               minimum_payment, due_day, start_date, category_id, note, closed_at)
debt_payments (id, user_id, debt_id, amount, date, expense_id, note, created_at)
accounts      (id, user_id, name, kind, color, opening_balance, counts_as_personal,
               is_default, is_archived, note, created_at)
transfers     (id, user_id, from_account_id, to_account_id, amount, date, note, created_at)
fixed_items   (id, user_id, kind, name, amount, frequency, amount_mode, match_text,
               lookback_months, category_id, account_id, day_of_month, is_active,
               note, created_at)
daily_closings(id, user_id, workspace_id, date, card, online, cash, total, note, created_at)
```

Las ocho tablas de movimiento llevan además `workspace_id`, y `accounts` un `role`
(`card | online | cash`) para las cuentas de cobro del local. `incomes` lleva `closing_id`.

`expenses` e `incomes` llevan además un `account_id` opcional. Nulo significa "sin asignar"
y cuenta como personal, así que todo lo registrado antes de que existieran las cuentas sigue
siendo válido.

`type` es `'income' | 'expense'`. `bucket` es `'needs' | 'wants' | 'savings'` y es lo que
alimenta la regla 50/30/20: cada categoría de gasto cuenta como necesidad o deseo según
cómo esté marcada, y se puede cambiar desde la pantalla *Categorías*.

RLS activo en las ocho tablas con `user_id = (select auth.uid())`, tanto en `USING` como en
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

## Cuentas y bancos

Cada gasto e ingreso puede decir de qué cuenta sale o a cuál entra. La lógica está en
`js/accounts.js`. Tres reglas la sostienen:

**Un traspaso no es ni gasto ni ingreso.** Mover dinero de la cuenta de la nómina a otra
cambia dónde está,
no cuánto tienes. Por eso los traspasos viven en su propia tabla y no entran en ningún total
del mes: si contaran, salir de la nómina y apartar para ahorro parecería un gasto enorme.

**Una cuenta puede no ser tuya.** Marcándola como *negocio* (`counts_as_personal = false`)
queda fuera de tus totales personales. Es el caso del TPV o la cuenta del negocio: lo que pagas con el dinero del
local no sale de tu bolsillo, así que no ensucia tu tasa de ahorro ni tu gasto del mes.

**Lo que gastas del negocio queda como pendiente.** El pendiente se calcula solo:

```
pendiente = gastos pagados desde la cuenta de negocio
          − traspasos que le has hecho desde tus cuentas personales
```

Cuando le devuelves el dinero al negocio, lo registras como un traspaso desde tu cuenta y el
pendiente baja. No cuenta como gasto del mes porque ese gasto ya se registró aparte cuando lo
hiciste; lo que baja es el saldo de la cuenta desde la que pagas.

El saldo de cada cuenta es `saldo inicial + ingresos − gastos + traspasos recibidos −
traspasos enviados`. Las cuentas de tipo *ahorro* se muestran aparte del disponible, para que
el dinero apartado no se confunda con el que puedes gastar.

Las cuentas con movimientos no se borran: se archivan, igual que las categorías.

---

## Cuando el servidor rechaza la sesión

Los servicios de Supabase que emiten el token y los que lo validan no comparten reloj. Si el
validador va unos segundos por detrás, un token recién emitido le parece del futuro y responde
`401 JWT issued at future`. Se corrige solo, pero dejaba la app en blanco.

`loadAll()` detecta esos rechazos por tiempo, pide un token nuevo y reintenta hasta dos veces
con una espera creciente. Si aun así no cede, se pinta una pantalla de error con el motivo en
castellano y un botón de reintentar, en vez de un esqueleto que no llega nunca.

Dos detalles que hacían falta para que eso no se volviera contra sí mismo:

- `hydrate()` tiene un cerrojo: dos eventos de sesión solapados no lanzan dos cargas.
- Una rotación de token (`TOKEN_REFRESHED`) ya no dispara una recarga de datos. Como el
  reintento renueva el token, y renovar emite ese evento, se realimentaba en un bucle de
  repintados.

---

## Plan mensual

La pantalla **Plan** responde una pregunta que los movimientos por sí solos no contestan:
*cuánto me queda libre cada mes*. La lógica está en `js/plan.js`.

Los movimientos cuentan lo que ha pasado; el plan declara con qué se cuenta cada mes.
De la resta sale el margen:

```
ingresos fijos − gastos fijos − cuotas de deuda = margen del mes
```

- **Las cuotas no se apuntan a mano.** Salen de la pantalla Deudas. Si se apuntaran también
  como gasto fijo se restarían dos veces, así que la app las trae sola y lo avisa en pantalla.
- **La periodicidad se guarda tal cual.** Un seguro de 480 € al año se apunta como anual y se
  muestra como 40 €/mes. Guardar ya la división obligaría a recordar el importe real cada vez
  que hubiera que revisarlo.
- **Importe fijo o variable.** Un alquiler es siempre el mismo; la luz, una nómina con
  comisiones o lo que reparte un negocio, no. Con `amount_mode = 'average'` el importe deja
  de escribirse y sale de la media de lo que se haya registrado de verdad.
- **Fijos pendientes.** El plan reconoce cuáles ya tienen movimiento este mes y cuáles no, y
  los que faltan se registran de un toque con su importe ya puesto. El emparejamiento va por
  nombre, y como respaldo por categoría + recurrente + importe parecido (±5 %), para
  reconocer también lo que se apuntó a mano.
- **Plan contra realidad.** El margen se compara con el gasto variable del mes — lo de tu
  bolsillo que no es un fijo ya contado — y de ahí sale cuánto queda y cuánto por día.

Si los fijos superan a los ingresos, la pantalla deja de hablar de margen y dice directamente
cuánto habría que ingresar de más al mes para quedarse a cero.

### Cómo se calcula una media

El apunte guarda una **palabra clave** (por defecto su nombre) que se busca en la nota de
cada gasto o en la fuente de cada ingreso. A propósito no vale sólo la categoría: "Luz" y
"Alquiler" suelen compartirla, y mezclarlos daría una media sin sentido.

Con los movimientos encontrados en la ventana elegida (3, 6 o 12 meses):

```
media mensual = total registrado ÷ meses que abarca de verdad
```

"Meses que abarca de verdad" va desde el primer movimiento encontrado, no desde el principio
de la ventana. Así una factura que llega cada dos meses da su equivalente mensual correcto, y
quien lleva sólo dos meses registrando no ve su media dividida entre seis. La ventana termina
en el mes anterior: el mes en curso está a medias y arrastraría la media hacia abajo.

Mientras no haya ningún movimiento que encaje, el plan usa el importe declarado como
estimación y lo dice en la lista. El formulario enseña en vivo cuántos movimientos reconoce y
qué media sale, para poder ajustar la palabra clave antes de guardar.

Un apunte variable pendiente no se registra de un toque — su importe sale de la factura real —:
abre el formulario con la categoría, la cuenta y la nota puestas, y sólo hay que teclear la
cifra.

---

## Espacios: personal y empresa

Un **espacio** es una contabilidad entera y cerrada: sus categorías, sus cuentas, sus
movimientos, sus deudas, su plan y su análisis. Al registrarte se crea el espacio *Personal*;
desde la pastilla de la cabecera puedes crear el de **Empresa** y cambiar de uno a otro.

Nada se mezcla entre espacios: todas las tablas llevan `workspace_id` y todas las consultas
lo filtran. Cambiar de espacio no es un filtro más, así que recarga los datos y vuelve a la
home en lugar de repintar la pantalla en la que estabas.

`workspace_id` tiene como DEFAULT la función `default_workspace()`, que devuelve el espacio
por defecto del usuario. Así, un cliente que no envíe la columna sigue escribiendo en su
espacio personal en lugar de fallar.

Crear el espacio de empresa es una sola llamada a `create_business_workspace(nombre)`: crea
el espacio, sus diez categorías de negocio y sus tres cuentas de cobro en la misma
transacción, para que no pueda quedar a medias.

### Cierres diarios

La pantalla **Cierres** sustituye a *Plan* en la barra cuando estás en un espacio de empresa.
Un cierre es el parte del día: **tarjeta, online y efectivo**. El total es una columna
`GENERATED STORED`, y hay un único parte por día y espacio (índice único; si repites fecha,
la app te manda a editarlo en vez de duplicarlo).

Guardar un parte crea además **un ingreso por cada forma de cobro con importe**, cada uno en
su cuenta (`accounts.role` = `card | online | cash`) y en la categoría *Facturación*. Son
ingresos normales, así que el análisis, el histórico y el cierre del mes los ven sin saber
nada de cierres; y como son los mismos euros contados una sola vez, no hay doble conteo.

- Al **editar** un parte los ingresos se rehacen enteros en vez de parchearse: son tres como
  mucho, y así no hay que razonar sobre qué método pasó de tener importe a no tenerlo.
- Al **borrarlo** se van con él (`incomes.closing_id` con `ON DELETE CASCADE`).
- Si fallara la creación de los ingresos, el cierre se deshace: sin ellos, mentiría.

La home del espacio de empresa cambia en consecuencia: **Resultado del mes** (facturación −
gastos, con su margen) en vez de *Gastado este mes*, *Facturado hoy* y la facturación
prevista a fin de mes al ritmo de los días con parte.

La media es **por día con parte**, no por día natural: un local que cierra los lunes no debe
salir penalizado. Por eso mismo, cuando faltan tres o más partes del mes, la pantalla lo
avisa en vez de dar por buena una facturación incompleta.

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
│   ├── closings.js           motor de cierres: facturación, media y resultado del mes
│   ├── lock.js               acceso con PIN / huella y cifrado de la sesión
│   ├── charts.js             envoltorio de Chart.js
│   ├── ui.js                 paneles inferiores, confirmaciones, estados de carga
│   ├── app.js                router y navegación
│   └── views/                dashboard · add-movement · debts · analysis · history
│                             categories · accounts · plan · closings · workspaces
│                             auth · lock
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
