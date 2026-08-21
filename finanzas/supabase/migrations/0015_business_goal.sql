-- ============================================================================
-- Lo que hay que facturar para no perder dinero.
--
-- En el negocio no hay ingreso fijo: la facturación es diaria y variable. Lo
-- que sí es fijo es lo que se va cada mes —alquiler, nóminas, suministros—, y
-- de ahí sale la pregunta que de verdad importa: cuánto hay que facturar como
-- mínimo para cubrirlo, y cuánto más para ganar lo que uno quiere ganar.
--
-- El objetivo de ganancia se guarda por espacio. Todo lo demás se deriva.
-- ============================================================================

alter table public.workspaces
  add column if not exists profit_goal numeric(12, 2) not null default 0
    check (profit_goal >= 0);

-- ---------------------------------------------------------------------------
-- "Nóminas" en vez de "Personal" en las categorías de negocio.
--
-- En un local, "Personal" es lo que se paga a las empleadas; pero con la cuenta
-- corriente de socios de por medio ("Massimo Personal") el nombre se presta a
-- confusión justo donde no conviene. Se renombra en vez de crear una categoría
-- nueva, para no dejar los gastos ya apuntados colgando de la vieja.
-- ---------------------------------------------------------------------------
update public.categories c
   set name = 'Nóminas'
  from public.workspaces w
 where w.id = c.workspace_id
   and w.kind = 'business'
   and c.type = 'expense'
   and c.name = 'Personal'
   and not exists (
     select 1 from public.categories o
      where o.workspace_id = c.workspace_id
        and o.type = 'expense'
        and lower(o.name) = 'nóminas'
   );

-- Y para los espacios de empresa que se creen a partir de ahora
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
    (uid, ws, 'Nóminas',        'expense', '#0ea5e9', 'needs'),
    (uid, ws, 'Alquiler',       'expense', '#a855f7', 'needs'),
    (uid, ws, 'Suministros',    'expense', '#f59e0b', 'needs'),
    (uid, ws, 'Impuestos',      'expense', '#ef4444', 'needs'),
    (uid, ws, 'Marketing',      'expense', '#ec4899', 'wants'),
    (uid, ws, 'Mantenimiento',  'expense', '#14b8a6', 'needs'),
    (uid, ws, 'Otros gastos',   'expense', '#94a3b8', 'wants'),
    (uid, ws, 'Facturación',    'income',  '#16a34a', 'needs'),
    (uid, ws, 'Otros ingresos', 'income',  '#64748b', 'needs');

  insert into public.accounts (user_id, workspace_id, name, kind, color, role, is_default) values
    (uid, ws, 'TPV / Tarjeta',  'checking', '#0ea5e9', 'card',    true),
    (uid, ws, 'Cobros online',  'checking', '#6366f1', 'online',  false),
    (uid, ws, 'Caja',           'cash',     '#78716c', 'cash',    false),
    (uid, ws, 'Reservas',       'checking', '#f59e0b', 'reserva', false);

  return ws;
end;
$$;

revoke all on function public.create_business_workspace(text) from public, anon;
grant execute on function public.create_business_workspace(text) to authenticated;
