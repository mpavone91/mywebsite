-- ============================================================================
-- Vistas de cierre diario y mensual.
-- security_invoker = on  ->  la vista respeta el RLS de las tablas base,
-- de forma que cada usuario sólo ve sus propios agregados.
-- ============================================================================

-- Movimientos unificados (ingresos con signo +, gastos con signo -)
create or replace view public.movements with (security_invoker = on) as
  select id, user_id, 'income'::text as kind, amount, category_id,
         source as description, date, is_recurring, created_at
  from public.incomes
  union all
  select id, user_id, 'expense'::text as kind, amount, category_id,
         note as description, date, is_recurring, created_at
  from public.expenses;

-- Cierre diario: saldo del día = ingresos del día - gastos del día
create or replace view public.daily_balance with (security_invoker = on) as
  select
    user_id,
    date,
    sum(case when kind = 'income'  then amount else 0 end) as income,
    sum(case when kind = 'expense' then amount else 0 end) as expense,
    sum(case when kind = 'income'  then amount else -amount end) as balance
  from public.movements
  group by user_id, date;

-- Cierre mensual: totales del mes + tasa de ahorro
create or replace view public.monthly_summary with (security_invoker = on) as
  select
    user_id,
    date_trunc('month', date)::date as month,
    sum(case when kind = 'income'  then amount else 0 end) as income,
    sum(case when kind = 'expense' then amount else 0 end) as expense,
    sum(case when kind = 'income'  then amount else -amount end) as balance,
    case
      when sum(case when kind = 'income' then amount else 0 end) > 0
      then round(
        sum(case when kind = 'income' then amount else -amount end)
        / sum(case when kind = 'income' then amount else 0 end), 4)
    end as savings_rate,
    sum(case when kind = 'expense' and is_recurring then amount else 0 end) as recurring_expense
  from public.movements
  group by user_id, date_trunc('month', date)::date;

-- Desglose mensual por categoría de gasto
create or replace view public.monthly_category_summary with (security_invoker = on) as
  select
    e.user_id,
    date_trunc('month', e.date)::date as month,
    e.category_id,
    coalesce(c.name, 'Sin categoría') as category_name,
    coalesce(c.color, '#94a3b8')      as color,
    coalesce(c.bucket, 'wants')       as bucket,
    sum(e.amount) as total,
    count(*)      as tx_count
  from public.expenses e
  left join public.categories c on c.id = e.category_id
  group by e.user_id, date_trunc('month', e.date)::date,
           e.category_id, c.name, c.color, c.bucket;
