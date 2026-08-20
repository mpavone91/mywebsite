import { sum, round2, monthKey, eur } from './utils.js';

/**
 * Cuentas y traspasos.
 *
 * La regla que lo ordena todo: un traspaso entre cuentas propias mueve dinero
 * de sitio, no lo crea ni lo destruye. Nunca es ingreso ni gasto.
 *
 * Y una cuenta puede estar fuera de lo personal (el dinero del negocio). Lo
 * que se gasta desde ahí no sale del bolsillo, así que no cuenta en el cierre
 * del mes: queda como pendiente de devolver al negocio, y se salda con un
 * traspaso desde una cuenta propia.
 */

export const ACCOUNT_KINDS = [
  { value: 'checking', label: 'Cuenta corriente', icon: '🏦', hint: 'Donde recibes la nómina y pagas el día a día' },
  { value: 'savings', label: 'Ahorro / inversión', icon: '🌱', hint: 'Lo que apartas. Traspasar aquí no es un gasto' },
  { value: 'business', label: 'Negocio', icon: '🏪', hint: 'Dinero que no es tuyo: no cuenta en tus totales personales' },
  { value: 'card', label: 'Tarjeta', icon: '💳', hint: 'Tarjeta de crédito o monedero' },
  { value: 'cash', label: 'Efectivo', icon: '💵', hint: 'Dinero en mano' },
];

export const kindMeta = (kind) => ACCOUNT_KINDS.find((k) => k.value === kind) || ACCOUNT_KINDS[0];

/**
 * Cuentas sugeridas al empezar, para no partir de una pantalla vacía.
 * A propósito son tipos y no marcas: cada uno le pone luego el nombre de su
 * banco desde la pantalla de edición.
 */
export const SUGGESTED = [
  { name: 'Cuenta principal', kind: 'checking', color: '#4f46e5' },
  { name: 'Segunda cuenta', kind: 'checking', color: '#0ea5e9' },
  { name: 'Ahorro', kind: 'savings', color: '#22c55e' },
  { name: 'Tarjeta', kind: 'card', color: '#a855f7' },
  { name: 'Efectivo', kind: 'cash', color: '#78716c' },
  { name: 'Negocio', kind: 'business', color: '#f59e0b', counts_as_personal: false },
];

/* ----------------------------------------------------------- pertenencia --- */

/**
 * ¿El dinero de esta cuenta es personal?
 * Sin cuenta asignada se considera personal: así todo lo registrado antes de
 * que existieran las cuentas sigue contando igual que siempre.
 */
export function isPersonal(accountId, accounts) {
  if (!accountId) return true;
  const account = accounts.find((a) => a.id === accountId);
  return account ? account.counts_as_personal : true;
}

/** Separa los movimientos entre los que son de tu bolsillo y los que no. */
export function splitPersonal(rows, accounts) {
  const personal = [];
  const external = [];
  for (const row of rows) (isPersonal(row.account_id, accounts) ? personal : external).push(row);
  return { personal, external };
}

/* -------------------------------------------------------------- balances --- */

/** Saldo actual de una cuenta, con el desglose de cómo se ha llegado a él. */
export function accountBalance(account, { expenses, incomes, transfers }) {
  const income = round2(sum(incomes.filter((i) => i.account_id === account.id), (i) => i.amount));
  const expense = round2(sum(expenses.filter((e) => e.account_id === account.id), (e) => e.amount));
  const inbound = round2(sum(transfers.filter((t) => t.to_account_id === account.id), (t) => t.amount));
  const outbound = round2(sum(transfers.filter((t) => t.from_account_id === account.id), (t) => t.amount));

  return {
    ...account,
    income,
    expense,
    inbound,
    outbound,
    balance: round2(Number(account.opening_balance || 0) + income - expense + inbound - outbound),
  };
}

/**
 * Pendiente con una cuenta de negocio: lo que has gastado desde ella para ti
 * menos lo que le has devuelto con traspasos desde tus cuentas personales.
 */
export function businessFloat(account, { expenses, transfers, accounts }) {
  const spent = round2(sum(expenses.filter((e) => e.account_id === account.id), (e) => e.amount));

  const repaid = round2(sum(
    transfers.filter((t) => t.to_account_id === account.id && isPersonal(t.from_account_id, accounts)),
    (t) => t.amount,
  ));

  return { spent, repaid, pending: round2(Math.max(0, spent - repaid)) };
}

/** Gasto del mes hecho desde una cuenta concreta. */
export function monthSpend(account, expenses, month = monthKey()) {
  return round2(sum(
    expenses.filter((e) => e.account_id === account.id && e.date.slice(0, 7) === month),
    (e) => e.amount,
  ));
}

/** Foto completa de todas las cuentas. */
export function accountsOverview({ accounts, expenses, incomes, transfers }, month = monthKey()) {
  const rows = accounts
    .filter((a) => !a.is_archived)
    .map((a) => {
      const row = accountBalance(a, { expenses, incomes, transfers });
      const meta = kindMeta(a.kind);
      return {
        ...row,
        icon: meta.icon,
        kindLabel: meta.label,
        monthSpend: monthSpend(a, expenses, month),
        float: a.counts_as_personal ? null : businessFloat(a, { expenses, transfers, accounts }),
      };
    })
    .sort(byKind);

  const personal = rows.filter((r) => r.counts_as_personal);
  const business = rows.filter((r) => !r.counts_as_personal);

  return {
    rows,
    personal,
    business,
    // Lo que tienes disponible ahora mismo, sin contar el dinero del negocio
    available: round2(sum(personal.filter((r) => r.kind !== 'savings'), (r) => r.balance)),
    savings: round2(sum(personal.filter((r) => r.kind === 'savings'), (r) => r.balance)),
    net: round2(sum(personal, (r) => r.balance)),
    pendingWithBusiness: round2(sum(business, (r) => r.float?.pending || 0)),
    businessMonthSpend: round2(sum(business, (r) => r.monthSpend)),
  };
}

const KIND_ORDER = { checking: 0, cash: 1, card: 2, savings: 3, business: 4 };
const byKind = (a, b) =>
  (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name, 'es');

/* -------------------------------------------------------------- insights --- */

/** Tarjetas de análisis sobre cuentas, en el formato del resto. */
export function accountInsights({ accounts, expenses, incomes, transfers }, month = monthKey()) {
  const out = [];
  if (!accounts.length) return out;

  const view = accountsOverview({ accounts, expenses, incomes, transfers }, month);

  for (const account of view.business) {
    if (!account.float?.pending) continue;
    out.push({
      id: `float-${account.id}`,
      level: 'warn',
      icon: '🏪',
      title: `Debes ${eur(account.float.pending)} a ${account.name}`,
      body: `Has pagado ${eur(account.float.spent)} de gastos personales desde ${account.name} y has devuelto ${eur(account.float.repaid)}. Este mes llevas ${eur(account.monthSpend)} gastados desde esa cuenta.`,
      action: `Cuando se lo devuelvas, hazlo con un traspaso desde tu cuenta a ${account.name} y el pendiente baja solo.`,
    });
  }

  const overdrawn = view.personal.filter((r) => r.balance < 0);
  for (const account of overdrawn) {
    out.push({
      id: `overdrawn-${account.id}`,
      level: 'alert',
      icon: '🔻',
      title: `${account.name} está en negativo`,
      body: `El saldo calculado es ${eur(account.balance)}. Puede que falte registrar algún ingreso o que el saldo inicial de la cuenta no esté puesto.`,
      action: 'Revisa el saldo inicial de la cuenta en la pantalla Cuentas.',
    });
  }

  return out;
}
