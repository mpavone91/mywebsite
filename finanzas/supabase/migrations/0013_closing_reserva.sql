-- ============================================================================
-- Cuarta forma de cobro en el cierre: Reserva.
--
-- El parte del día llevaba tarjeta, online y efectivo. Las reservas son dinero
-- que entra por su propio camino y conviene verlo aparte, no diluido dentro de
-- otra forma de cobro: cuánto pesa sobre la facturación del mes es justo una de
-- las cosas que se quieren mirar.
--
-- Se trata igual que las otras tres: su columna en el parte, su cuenta de cobro
-- y su ingreso al guardar. Los cierres que ya existen se quedan con reserva = 0,
-- que es exactamente lo que valían.
-- ============================================================================

alter table public.accounts
  drop constraint if exists accounts_role_check;

alter table public.accounts
  add constraint accounts_role_check
  check (role in ('card', 'online', 'cash', 'reserva'));

alter table public.daily_closings
  add column if not exists reserva numeric(12, 2) not null default 0 check (reserva >= 0);

-- El total es una columna generada: hay que rehacer su expresión para que
-- cuente también las reservas.
alter table public.daily_closings
  alter column total set expression as (card + online + cash + reserva);

-- ---------------------------------------------------------------------------
-- Cuenta de reservas para los espacios de empresa que ya existen.
-- ---------------------------------------------------------------------------
insert into public.accounts (user_id, workspace_id, name, kind, color, role, is_default)
select w.user_id, w.id, 'Reservas', 'checking', '#f59e0b', 'reserva', false
from public.workspaces w
where w.kind = 'business'
  and not exists (
    select 1 from public.accounts a
    where a.workspace_id = w.id and a.role = 'reserva'
  );

-- ---------------------------------------------------------------------------
-- Y para los que se creen a partir de ahora.
-- ---------------------------------------------------------------------------
create or replace function public.create_business_workspace(ws_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'sin sesión';
  end if;

  insert into public.workspaces (user_id, name, kind, color, is_default)
  values (uid, coalesce(nullif(trim(ws_name), ''), 'Empresa'), 'business', '#0d9488', false)
  returning id into ws;

  insert into public.categories (user_id, workspace_id, name, type, color, bucket) values
    (uid, ws, 'Proveedores',    'expense', '#6366f1', 'needs'),
    (uid, ws, 'Personal',       'expense', '#0ea5e9', 'needs'),
    (uid, ws, 'Alquiler',       'expense', '#a855f7', 'needs'),
    (uid, ws, 'Suministros',    'expense', '#f59e0b', 'needs'),
    (uid, ws, 'Impuestos',      'expense', '#ef4444', 'needs'),
    (uid, ws, 'Marketing',      'expense', '#ec4899', 'wants'),
    (uid, ws, 'Mantenimiento',  'expense', '#14b8a6', 'needs'),
    (uid, ws, 'Otros gastos',   'expense', '#94a3b8', 'wants'),
    (uid, ws, 'Facturación',    'income',  '#16a34a', 'needs'),
    (uid, ws, 'Otros ingresos', 'income',  '#64748b', 'needs');

  insert into public.accounts (user_id, workspace_id, name, kind, color, role, is_default) values
    (uid, ws, 'TPV / Tarjeta',  'checking', '#0ea5e9', 'card',    true),
    (uid, ws, 'Cobros online',  'checking', '#6366f1', 'online',  false),
    (uid, ws, 'Caja',           'cash',     '#78716c', 'cash',    false),
    (uid, ws, 'Reservas',       'checking', '#f59e0b', 'reserva', false);

  return ws;
end;
$$;

revoke all on function public.create_business_workspace(text) from public, anon;
grant execute on function public.create_business_workspace(text) to authenticated;

-- --------------------------------------------------------------------- vista
-- La vista añade una columna, así que se rehace en vez de reemplazarse.
drop view if exists public.monthly_takings;

create view public.monthly_takings with (security_invoker = on) as
  select
    workspace_id,
    date_trunc('month', date)::date as month,
    sum(card)    as card,
    sum(online)  as online,
    sum(cash)    as cash,
    sum(reserva) as reserva,
    sum(total)   as total,
    count(*)     as closings
  from public.daily_closings
  group by workspace_id, date_trunc('month', date)::date;
