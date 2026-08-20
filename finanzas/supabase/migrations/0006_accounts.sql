-- ============================================================================
-- Cuentas (bancos) y traspasos entre ellas.
--
-- Tres ideas que sostienen el modelo:
--
-- 1. Cada gasto e ingreso sabe de qué cuenta sale o a cuál entra. Un
--    account_id nulo significa "sin asignar" y cuenta como personal, para que
--    todo lo registrado antes de esta migración siga siendo válido.
--
-- 2. Un traspaso entre cuentas propias NO es ni ingreso ni gasto: mueve dinero
--    de sitio, no cambia el patrimonio. Por eso vive en su propia tabla y no
--    entra en ningún total del mes.
--
-- 3. Una cuenta puede quedar fuera de los totales personales
--    (counts_as_personal = false). Es el caso del dinero del negocio: lo que
--    se gasta desde ahí no sale del bolsillo personal, sino que queda como
--    pendiente de devolver al negocio.
-- ============================================================================

create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                text not null,
  kind                text not null default 'checking'
                        check (kind in ('checking', 'savings', 'business', 'cash', 'card')),
  color               text not null default '#4f46e5',
  -- Saldo que ya había en la cuenta antes de empezar a usar la app
  opening_balance     numeric(12, 2) not null default 0,
  -- false = el dinero de esta cuenta no es personal (negocio)
  counts_as_personal  boolean not null default true,
  is_default          boolean not null default false,
  is_archived         boolean not null default false,
  note                text,
  created_at          timestamptz not null default now()
);

create unique index if not exists accounts_user_name_key on public.accounts (user_id, lower(name));
create index if not exists accounts_user_idx on public.accounts (user_id) where is_archived = false;

alter table public.expenses add column if not exists account_id uuid references public.accounts (id) on delete set null;
alter table public.incomes  add column if not exists account_id uuid references public.accounts (id) on delete set null;

create index if not exists expenses_account_idx on public.expenses (account_id);
create index if not exists incomes_account_idx  on public.incomes  (account_id);

create table if not exists public.transfers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete cascade,
  to_account_id   uuid not null references public.accounts (id) on delete cascade,
  amount          numeric(12, 2) not null check (amount > 0),
  date            date not null default current_date,
  note            text,
  created_at      timestamptz not null default now(),
  constraint transfers_distinct_accounts check (from_account_id <> to_account_id)
);

create index if not exists transfers_user_date_idx on public.transfers (user_id, date desc);
create index if not exists transfers_from_idx      on public.transfers (from_account_id);
create index if not exists transfers_to_idx        on public.transfers (to_account_id);

-- ----------------------------------------------------------------------- RLS
alter table public.accounts  enable row level security;
alter table public.transfers enable row level security;

drop policy if exists accounts_owner on public.accounts;
create policy accounts_owner on public.accounts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists transfers_owner on public.transfers;
create policy transfers_owner on public.transfers
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- vista
-- Saldo de cada cuenta: lo que había + ingresos − gastos + traspasos recibidos
-- − traspasos enviados.
create or replace view public.account_balances with (security_invoker = on) as
  select
    a.*,
    a.opening_balance
      + coalesce(i.total, 0)
      - coalesce(e.total, 0)
      + coalesce(tin.total, 0)
      - coalesce(tout.total, 0) as balance,
    coalesce(i.total, 0)    as total_income,
    coalesce(e.total, 0)    as total_expense,
    coalesce(tin.total, 0)  as total_transfers_in,
    coalesce(tout.total, 0) as total_transfers_out
  from public.accounts a
  left join (select account_id, sum(amount) total from public.incomes  group by account_id) i    on i.account_id = a.id
  left join (select account_id, sum(amount) total from public.expenses group by account_id) e    on e.account_id = a.id
  left join (select to_account_id,   sum(amount) total from public.transfers group by to_account_id)   tin  on tin.to_account_id = a.id
  left join (select from_account_id, sum(amount) total from public.transfers group by from_account_id) tout on tout.from_account_id = a.id;
