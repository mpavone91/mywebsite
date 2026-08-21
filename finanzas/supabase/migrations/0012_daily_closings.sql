-- ============================================================================
-- Cierres diarios del local.
--
-- Un cierre es el parte del día: cuánto entró por tarjeta, cuánto por cobros
-- online y cuánto en efectivo. Es el documento que llega desde el local, así
-- que se guarda tal cual, con su fecha y su nota.
--
-- Además, cada cierre crea sus tres ingresos correspondientes (uno por forma
-- de cobro, cada uno en su cuenta). Así todo lo que ya existe —el cierre del
-- mes, el análisis, el histórico, el plan— funciona sobre el negocio sin
-- inventar un camino paralelo. La FK con ON DELETE CASCADE mantiene las dos
-- cosas en sintonía: si se borra el cierre, se van sus ingresos.
-- ============================================================================

-- Qué papel juega una cuenta dentro de un cierre. Sólo tiene sentido en un
-- espacio de empresa; en el personal se queda a null.
alter table public.accounts
  add column if not exists role text check (role in ('card', 'online', 'cash'));

create unique index if not exists accounts_ws_role_key
  on public.accounts (workspace_id, role) where role is not null;

create table if not exists public.daily_closings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default public.default_workspace()
                 references public.workspaces (id) on delete cascade,
  date         date not null default current_date,
  card         numeric(12, 2) not null default 0 check (card >= 0),
  online       numeric(12, 2) not null default 0 check (online >= 0),
  cash         numeric(12, 2) not null default 0 check (cash >= 0),
  total        numeric(12, 2) generated always as (card + online + cash) stored,
  note         text,
  created_at   timestamptz not null default now(),
  -- Un único parte por día y local
  constraint daily_closings_one_per_day unique (workspace_id, date)
);

create index if not exists daily_closings_ws_date_idx
  on public.daily_closings (workspace_id, date desc);

-- Los ingresos que nacen de un cierre saben de cuál vienen
alter table public.incomes
  add column if not exists closing_id uuid references public.daily_closings (id) on delete cascade;

create index if not exists incomes_closing_idx on public.incomes (closing_id);

alter table public.daily_closings enable row level security;

drop policy if exists daily_closings_owner on public.daily_closings;
create policy daily_closings_owner on public.daily_closings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================================
-- Alta de un espacio de empresa, con sus categorías y sus cuentas de cobro.
-- Va en el servidor para que sea atómico: o queda todo montado, o nada.
-- ============================================================================

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
    (uid, ws, 'TPV / Tarjeta',  'checking', '#0ea5e9', 'card',   true),
    (uid, ws, 'Cobros online',  'checking', '#6366f1', 'online', false),
    (uid, ws, 'Caja',           'cash',     '#78716c', 'cash',   false);

  return ws;
end;
$$;

revoke all on function public.create_business_workspace(text) from public, anon;
grant execute on function public.create_business_workspace(text) to authenticated;

-- --------------------------------------------------------------------- vista
-- Facturación por mes y forma de cobro, para consultarlo desde SQL igual que
-- lo calcula la app.
create or replace view public.monthly_takings with (security_invoker = on) as
  select
    workspace_id,
    date_trunc('month', date)::date as month,
    sum(card)   as card,
    sum(online) as online,
    sum(cash)   as cash,
    sum(total)  as total,
    count(*)    as closings
  from public.daily_closings
  group by workspace_id, date_trunc('month', date)::date;
