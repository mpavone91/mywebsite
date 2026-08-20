-- ============================================================================
-- Deudas y sus pagos.
--
-- El saldo pendiente NO se guarda: se deriva de los pagos registrados
-- (initial_amount − suma de pagos), para que nunca pueda desincronizarse.
-- La vista debt_status hace ese cálculo del lado del servidor.
-- ============================================================================

create table if not exists public.debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  creditor        text,
  kind            text not null default 'other'
                    check (kind in ('card', 'loan', 'personal', 'mortgage', 'other')),
  initial_amount  numeric(12, 2) not null check (initial_amount > 0),
  -- TAE en porcentaje anual: 18.5 = 18,5 %. 0 = sin intereses.
  annual_rate     numeric(6, 3) not null default 0 check (annual_rate >= 0 and annual_rate < 1000),
  minimum_payment numeric(12, 2) not null default 0 check (minimum_payment >= 0),
  due_day         smallint check (due_day between 1 and 31),
  start_date      date not null default current_date,
  -- categoría de gasto con la que se registran los pagos
  category_id     uuid references public.categories (id) on delete set null,
  note            text,
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists debts_user_idx     on public.debts (user_id);
create index if not exists debts_category_idx on public.debts (category_id);

create table if not exists public.debt_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id    uuid not null references public.debts (id) on delete cascade,
  amount     numeric(12, 2) not null check (amount > 0),
  date       date not null default current_date,
  -- gasto asociado, para que el pago cuente en el cierre del mes
  expense_id uuid references public.expenses (id) on delete set null,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists debt_payments_user_date_idx on public.debt_payments (user_id, date desc);
create index if not exists debt_payments_debt_idx      on public.debt_payments (debt_id);
create index if not exists debt_payments_expense_idx   on public.debt_payments (expense_id);

-- ----------------------------------------------------------------------- RLS
alter table public.debts         enable row level security;
alter table public.debt_payments enable row level security;

drop policy if exists debts_owner on public.debts;
create policy debts_owner on public.debts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists debt_payments_owner on public.debt_payments;
create policy debt_payments_owner on public.debt_payments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- vista
create or replace view public.debt_status with (security_invoker = on) as
  select
    d.*,
    coalesce(p.paid, 0)                        as paid,
    d.initial_amount - coalesce(p.paid, 0)     as balance,
    case when d.initial_amount > 0
         then round(coalesce(p.paid, 0) / d.initial_amount, 4)
    end                                        as progress,
    p.payment_count,
    p.last_payment_date,
    (d.closed_at is not null or d.initial_amount - coalesce(p.paid, 0) <= 0) as is_settled
  from public.debts d
  left join (
    select debt_id,
           sum(amount)   as paid,
           count(*)      as payment_count,
           max(date)     as last_payment_date
    from public.debt_payments
    group by debt_id
  ) p on p.debt_id = d.id;
