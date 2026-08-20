-- ============================================================================
-- Categorías por defecto para cada usuario nuevo.
-- Se crean con un trigger sobre auth.users y también se pueden re-lanzar
-- desde la app con la RPC seed_default_categories() (idempotente).
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
    (target, 'Vivienda',      'expense', '#6366f1', 'needs'),
    (target, 'Alimentación',  'expense', '#22c55e', 'needs'),
    (target, 'Transporte',    'expense', '#0ea5e9', 'needs'),
    (target, 'Salud',         'expense', '#14b8a6', 'needs'),
    (target, 'Deudas/Multas', 'expense', '#ef4444', 'needs'),
    (target, 'Suscripciones', 'expense', '#a855f7', 'wants'),
    (target, 'Ocio',          'expense', '#f59e0b', 'wants'),
    (target, 'Otros',         'expense', '#94a3b8', 'wants'),
    (target, 'Nómina',        'income',  '#16a34a', 'needs'),
    (target, 'MOMU',          'income',  '#0d9488', 'needs'),
    (target, 'Restaurante',   'income',  '#2563eb', 'needs'),
    (target, 'Otros ingresos','income',  '#64748b', 'needs')
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Versión sin argumentos que la app llama vía supabase.rpc('seed_default_categories')
create or replace function public.seed_default_categories()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.seed_default_categories(auth.uid());
$$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_categories() to authenticated;

-- Trigger: al darse de alta un usuario, sembrar sus categorías
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
