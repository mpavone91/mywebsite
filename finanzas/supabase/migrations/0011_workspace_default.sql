-- ============================================================================
-- Valor por defecto de workspace_id.
--
-- La migración anterior dejó la columna obligatoria, y eso rompe a cualquier
-- cliente que todavía no la envíe: la versión desplegada en ese momento, o una
-- pestaña vieja que alguien tenga abierta.
--
-- Con este default el servidor resuelve solo el espacio por defecto del
-- usuario, así que las dos versiones de la app conviven sin romperse. Una vez
-- que todos los clientes envíen la columna, el default deja de usarse pero no
-- estorba: sigue siendo la red de seguridad de las pestañas viejas.
-- ============================================================================

create or replace function public.default_workspace()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.workspaces
   where user_id = auth.uid()
   order by is_default desc, created_at
   limit 1
$$;

revoke all on function public.default_workspace() from public, anon;
grant execute on function public.default_workspace() to authenticated;

alter table public.categories    alter column workspace_id set default public.default_workspace();
alter table public.expenses      alter column workspace_id set default public.default_workspace();
alter table public.incomes       alter column workspace_id set default public.default_workspace();
alter table public.accounts      alter column workspace_id set default public.default_workspace();
alter table public.transfers     alter column workspace_id set default public.default_workspace();
alter table public.debts         alter column workspace_id set default public.default_workspace();
alter table public.debt_payments alter column workspace_id set default public.default_workspace();
alter table public.fixed_items   alter column workspace_id set default public.default_workspace();
