-- ============================================================================
-- Categorías por defecto genéricas.
--
-- El sembrado original llevaba nombres propios ("MOMU", "Restaurante") que
-- venían del primer usuario. Cualquiera que se registre debe encontrar
-- categorías que le sirvan sin tener que borrar las de otro.
--
-- Además se renombran las que ya se sembraron a usuarios existentes, pero
-- SÓLO si no tienen ningún movimiento asociado: si alguien ya las está usando,
-- se quedan como están.
-- ============================================================================

create or replace function public.seed_default_categories(target uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted integer;
begin
  insert into public.categories (user_id, name, type, color, bucket)
  values
    (target, 'Vivienda',       'expense', '#6366f1', 'needs'),
    (target, 'Alimentación',   'expense', '#22c55e', 'needs'),
    (target, 'Transporte',     'expense', '#0ea5e9', 'needs'),
    (target, 'Salud',          'expense', '#14b8a6', 'needs'),
    (target, 'Deudas/Multas',  'expense', '#ef4444', 'needs'),
    (target, 'Suscripciones',  'expense', '#a855f7', 'wants'),
    (target, 'Ocio',           'expense', '#f59e0b', 'wants'),
    (target, 'Otros',          'expense', '#94a3b8', 'wants'),
    (target, 'Nómina',         'income',  '#16a34a', 'needs'),
    (target, 'Negocio',        'income',  '#0d9488', 'needs'),
    (target, 'Extras',         'income',  '#2563eb', 'needs'),
    (target, 'Otros ingresos', 'income',  '#64748b', 'needs')
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Limpieza de lo ya sembrado, sin tocar nada que esté en uso
update public.categories c
set name = case lower(c.name)
             when 'momu' then 'Negocio'
             when 'restaurante' then 'Extras'
           end
where c.type = 'income'
  and lower(c.name) in ('momu', 'restaurante')
  and not exists (select 1 from public.incomes  i where i.category_id = c.id)
  and not exists (select 1 from public.expenses e where e.category_id = c.id)
  -- y sólo si el nombre nuevo no lo tiene ya
  and not exists (
    select 1 from public.categories o
    where o.user_id = c.user_id
      and o.type = c.type
      and lower(o.name) = case lower(c.name)
                            when 'momu' then 'negocio'
                            when 'restaurante' then 'extras'
                          end
  );
