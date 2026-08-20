-- ============================================================================
-- Endurecer los permisos de las funciones SECURITY DEFINER.
--
-- Por defecto Postgres concede EXECUTE a PUBLIC en cada función nueva, y
-- PostgREST expone el esquema public como RPC: sin esto, /rest/v1/rpc/...
-- quedaría al alcance del rol anon. Los triggers siguen funcionando porque
-- se ejecutan en el contexto del dueño de la tabla, no del que llama.
-- ============================================================================

-- Función de trigger: no debe ser invocable como RPC por nadie
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Sembrado de categorías: sólo para usuarios autenticados
revoke all on function public.seed_default_categories()     from public, anon, authenticated;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_categories() to authenticated;

-- Índices que cubren las claves foráneas de category_id (el compuesto
-- (user_id, category_id) no sirve: la FK necesita category_id como primera
-- columna al borrar o archivar una categoría).
drop index if exists public.expenses_user_cat_idx;
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists incomes_category_idx  on public.incomes  (category_id);
