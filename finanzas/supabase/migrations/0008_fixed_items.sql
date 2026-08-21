-- ============================================================================
-- Plan mensual: ingresos y gastos fijos.
--
-- Esto NO sustituye a los movimientos reales. Es la otra mitad de la foto:
-- los movimientos cuentan lo que ha pasado, y estos apuntes declaran con qué
-- cuentas cada mes. De la resta entre los dos sale la pregunta que importa:
-- cuánto queda libre para gastar, o cuánto falta por ingresar.
--
-- La periodicidad se guarda tal cual (un seguro anual se apunta como anual) y
-- el equivalente mensual se calcula al vuelo. Guardar ya la división mensual
-- obligaría a recordar el importe real cada vez que hubiera que revisarlo.
-- ============================================================================

create table if not exists public.fixed_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('income', 'expense')),
  name         text not null,
  amount       numeric(12, 2) not null check (amount > 0),
  frequency    text not null default 'monthly'
                 check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  category_id  uuid references public.categories (id) on delete set null,
  account_id   uuid references public.accounts (id) on delete set null,
  day_of_month smallint check (day_of_month between 1 and 31),
  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists fixed_items_user_idx     on public.fixed_items (user_id) where is_active;
create index if not exists fixed_items_category_idx on public.fixed_items (category_id);
create index if not exists fixed_items_account_idx  on public.fixed_items (account_id);

alter table public.fixed_items enable row level security;

drop policy if exists fixed_items_owner on public.fixed_items;
create policy fixed_items_owner on public.fixed_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- vista
-- Equivalente mensual de cada apunte, para poder consultarlo desde SQL con la
-- misma cuenta que hace la app.
create or replace view public.fixed_items_monthly with (security_invoker = on) as
  select
    f.*,
    round(f.amount * case f.frequency
                       when 'weekly'    then 52.0 / 12.0
                       when 'monthly'   then 1
                       when 'quarterly' then 1.0 / 3.0
                       when 'yearly'    then 1.0 / 12.0
                     end, 2) as monthly_amount
  from public.fixed_items f;
