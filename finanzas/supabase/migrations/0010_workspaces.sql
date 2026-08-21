-- ============================================================================
-- Espacios de trabajo: Personal y Empresa.
--
-- Hasta ahora todo colgaba sólo de user_id. Con un negocio de por medio hacen
-- falta dos contabilidades separadas del mismo dueño: categorías propias,
-- cuentas propias, su plan y su análisis, sin que una ensucie a la otra.
--
-- Todo lo que ya existía pasa entero al espacio "Personal", así que nadie
-- pierde nada ni tiene que tocar sus datos.
--
-- El RLS no cambia de idea: sigue siendo por user_id. El espacio separa
-- contabilidades del MISMO usuario, no da acceso a nadie más.
-- ============================================================================

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  kind       text not null default 'personal' check (kind in ('personal', 'business')),
  color      text not null default '#4f46e5',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists workspaces_user_idx on public.workspaces (user_id);

alter table public.workspaces enable row level security;

drop policy if exists workspaces_owner on public.workspaces;
create policy workspaces_owner on public.workspaces
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ------------------------------------------------- un Personal por usuario
insert into public.workspaces (user_id, name, kind, is_default)
select u.id, 'Personal', 'personal', true
from auth.users u
where not exists (select 1 from public.workspaces w where w.user_id = u.id);

-- --------------------------------------------------------- columnas nuevas
alter table public.categories    add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.expenses      add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.incomes       add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.accounts      add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.transfers     add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.debts         add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.debt_payments add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.fixed_items   add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

-- ------------------------------------------------------- todo a "Personal"
do $$
declare
  t text;
begin
  foreach t in array array['categories', 'expenses', 'incomes', 'accounts',
                           'transfers', 'debts', 'debt_payments', 'fixed_items']
  loop
    execute format(
      'update public.%I r set workspace_id = w.id
         from public.workspaces w
        where w.user_id = r.user_id and w.is_default and r.workspace_id is null', t);
    execute format('alter table public.%I alter column workspace_id set not null', t);
    execute format('create index if not exists %I on public.%I (workspace_id)',
                   t || '_workspace_idx', t);
  end loop;
end $$;

-- ------------------------------------------- unicidad, ahora por espacio
-- Personal y Empresa pueden tener cada uno su "Alimentación" o su "Caja".
drop index if exists public.categories_user_type_name_key;
create unique index if not exists categories_ws_type_name_key
  on public.categories (workspace_id, type, lower(name));

drop index if exists public.accounts_user_name_key;
create unique index if not exists accounts_ws_name_key
  on public.accounts (workspace_id, lower(name));

-- ----------------------------------------- alta de usuario: espacio + categorías
create or replace function public.seed_default_categories(target uuid, target_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted integer;
begin
  insert into public.categories (user_id, workspace_id, name, type, color, bucket)
  values
    (target, target_workspace, 'Vivienda',       'expense', '#6366f1', 'needs'),
    (target, target_workspace, 'Alimentación',   'expense', '#22c55e', 'needs'),
    (target, target_workspace, 'Transporte',     'expense', '#0ea5e9', 'needs'),
    (target, target_workspace, 'Salud',          'expense', '#14b8a6', 'needs'),
    (target, target_workspace, 'Deudas/Multas',  'expense', '#ef4444', 'needs'),
    (target, target_workspace, 'Suscripciones',  'expense', '#a855f7', 'wants'),
    (target, target_workspace, 'Ocio',           'expense', '#f59e0b', 'wants'),
    (target, target_workspace, 'Otros',          'expense', '#94a3b8', 'wants'),
    (target, target_workspace, 'Nómina',         'income',  '#16a34a', 'needs'),
    (target, target_workspace, 'Negocio',        'income',  '#0d9488', 'needs'),
    (target, target_workspace, 'Extras',         'income',  '#2563eb', 'needs'),
    (target, target_workspace, 'Otros ingresos', 'income',  '#64748b', 'needs')
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

drop function if exists public.seed_default_categories(uuid);

-- Versión sin argumentos que llama la app: siembra en su espacio por defecto
create or replace function public.seed_default_categories()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws uuid;
begin
  select id into ws from public.workspaces
   where user_id = auth.uid() order by is_default desc, created_at limit 1;

  if ws is null then
    insert into public.workspaces (user_id, name, kind, is_default)
    values (auth.uid(), 'Personal', 'personal', true)
    returning id into ws;
  end if;

  return public.seed_default_categories(auth.uid(), ws);
end;
$$;

revoke all on function public.seed_default_categories(uuid, uuid) from public, anon, authenticated;
revoke all on function public.seed_default_categories() from public, anon, authenticated;
grant execute on function public.seed_default_categories() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws uuid;
begin
  insert into public.workspaces (user_id, name, kind, is_default)
  values (new.id, 'Personal', 'personal', true)
  returning id into ws;

  perform public.seed_default_categories(new.id, ws);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
