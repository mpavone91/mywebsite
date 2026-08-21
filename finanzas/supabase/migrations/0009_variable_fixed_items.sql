-- ============================================================================
-- Apuntes del plan con importe variable.
--
-- Hay cosas que se repiten todos los meses pero nunca por el mismo importe: la
-- luz, una nómina con comisiones, lo que reparte un negocio. Declararlas con un
-- número fijo obliga a corregirlo a mano cada mes y aun así miente.
--
-- Con amount_mode = 'average' el importe deja de escribirse: sale de la media
-- de lo que se haya registrado de verdad en los últimos meses. El campo
-- `amount` se conserva como estimación inicial, para que el plan tenga algo
-- que enseñar mientras no haya histórico suficiente.
--
-- `match_text` es la palabra con la que se reconocen esos movimientos (por
-- defecto, el nombre del apunte).
-- ============================================================================

alter table public.fixed_items
  add column if not exists amount_mode text not null default 'fixed'
    check (amount_mode in ('fixed', 'average'));

alter table public.fixed_items
  add column if not exists lookback_months smallint not null default 6
    check (lookback_months between 2 and 24);

alter table public.fixed_items
  add column if not exists match_text text;

comment on column public.fixed_items.amount_mode is
  'fixed = el importe lo escribe el usuario; average = se calcula desde los movimientos registrados';
comment on column public.fixed_items.amount is
  'Importe declarado. En modo average sólo se usa como estimación mientras no haya histórico';

-- La vista sigue dando el equivalente mensual del importe declarado. Para los
-- apuntes en modo average ese número es sólo la estimación inicial: la media
-- real se calcula sobre los movimientos, y eso vive en la app (js/plan.js).
-- Se recrea en vez de reemplazarse: `f.*` ahora trae columnas nuevas y
-- CREATE OR REPLACE VIEW no admite insertarlas antes de las existentes.
drop view if exists public.fixed_items_monthly;

create view public.fixed_items_monthly with (security_invoker = on) as
  select
    f.*,
    round(f.amount * case f.frequency
                       when 'weekly'    then 52.0 / 12.0
                       when 'monthly'   then 1
                       when 'quarterly' then 1.0 / 3.0
                       when 'yearly'    then 1.0 / 12.0
                     end, 2) as monthly_amount
  from public.fixed_items f;
