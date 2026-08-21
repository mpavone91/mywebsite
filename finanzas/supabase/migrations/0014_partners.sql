-- ============================================================================
-- Cuenta corriente de socios.
--
-- Cuando un socio paga algo suyo con dinero del negocio, el negocio no ha
-- gastado: ha prestado. Y cuando aporta dinero, no ha facturado: le han
-- devuelto parte de ese préstamo. Meter esas dos cosas entre los gastos y los
-- ingresos del local falsearía el resultado del mes, que es justo el número
-- que se mira para saber si el negocio va bien.
--
-- Por eso un socio es una entidad del espacio de empresa, y los movimientos
-- suyos van marcados: siguen moviendo el dinero de las cuentas —salió del TPV,
-- entró en caja— pero quedan fuera del resultado. Lo que queda vivo es su
-- saldo: retiradas menos aportaciones, o sea lo que ese socio le debe al
-- negocio.
-- ============================================================================

create table if not exists public.partners (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default public.default_workspace()
                 references public.workspaces (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  color        text not null default '#6366f1',
  -- El socio que es el propio dueño de la cuenta: su saldo también aparece en
  -- su espacio personal como lo que le debe al negocio.
  is_me        boolean not null default false,
  note         text,
  created_at   timestamptz not null default now()
);

create unique index if not exists partners_ws_name_key
  on public.partners (workspace_id, lower(trim(name)));

-- Un solo socio puede ser "yo" dentro de un mismo espacio
create unique index if not exists partners_ws_me_key
  on public.partners (workspace_id) where is_me;

create index if not exists partners_ws_idx on public.partners (workspace_id);

alter table public.partners enable row level security;

drop policy if exists partners_owner on public.partners;
create policy partners_owner on public.partners
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- La marca en los movimientos.
--
-- Un gasto con partner_id es una retirada: el socio se llevó ese dinero.
-- Un ingreso con partner_id es una aportación: el socio lo devolvió.
-- En ambos casos el movimiento sigue siendo real para la cuenta de la que sale
-- o en la que entra; lo que cambia es que no cuenta como gasto ni como ingreso
-- del negocio.
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column if not exists partner_id uuid references public.partners (id) on delete restrict;

alter table public.incomes
  add column if not exists partner_id uuid references public.partners (id) on delete restrict;

create index if not exists expenses_partner_idx on public.expenses (partner_id)
  where partner_id is not null;
create index if not exists incomes_partner_idx on public.incomes (partner_id)
  where partner_id is not null;

-- El espejo en lo personal: el gasto que uno se apunta al aportar dinero al
-- negocio apunta a la aportación que lo originó, para poder deshacer las dos
-- cosas a la vez.
alter table public.expenses
  add column if not exists partner_income_id uuid references public.incomes (id) on delete cascade;

create index if not exists expenses_partner_income_idx on public.expenses (partner_income_id)
  where partner_income_id is not null;

-- --------------------------------------------------------------------- vista
-- Saldo de cada socio: lo que ha sacado menos lo que ha devuelto.
create or replace view public.partner_balances with (security_invoker = on) as
  select
    p.id as partner_id,
    p.workspace_id,
    p.name,
    p.is_me,
    coalesce(d.drawn, 0)        as drawn,
    coalesce(c.contributed, 0)  as contributed,
    coalesce(d.drawn, 0) - coalesce(c.contributed, 0) as balance
  from public.partners p
  left join (
    select partner_id, sum(amount) as drawn
    from public.expenses where partner_id is not null group by partner_id
  ) d on d.partner_id = p.id
  left join (
    select partner_id, sum(amount) as contributed
    from public.incomes where partner_id is not null group by partner_id
  ) c on c.partner_id = p.id;
