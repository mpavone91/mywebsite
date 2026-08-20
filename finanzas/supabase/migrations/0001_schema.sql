-- ============================================================================
-- Finanzas Personales — esquema base
-- Tablas: categories, incomes, expenses
-- Todo con RLS por user_id = auth.uid()
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- categories
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  type        text not null default 'expense' check (type in ('income', 'expense')),
  color       text not null default '#64748b',
  -- bucket alimenta la regla 50/30/20 del bloque de Análisis
  bucket      text not null default 'wants' check (bucket in ('needs', 'wants', 'savings')),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists categories_user_type_name_key
  on public.categories (user_id, type, lower(name));
create index if not exists categories_user_idx
  on public.categories (user_id) where is_archived = false;

-- ------------------------------------------------------------------- incomes
create table if not exists public.incomes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0),
  category_id  uuid references public.categories (id) on delete set null,
  source       text,
  date         date not null default current_date,
  is_recurring boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists incomes_user_date_idx on public.incomes (user_id, date desc);
create index if not exists incomes_recurring_idx on public.incomes (user_id, is_recurring) where is_recurring;

-- ------------------------------------------------------------------ expenses
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0),
  category_id  uuid references public.categories (id) on delete set null,
  note         text,
  date         date not null default current_date,
  is_recurring boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);
create index if not exists expenses_user_cat_idx  on public.expenses (user_id, category_id);
create index if not exists expenses_recurring_idx on public.expenses (user_id, is_recurring) where is_recurring;

-- ----------------------------------------------------------------------- RLS
alter table public.categories enable row level security;
alter table public.incomes    enable row level security;
alter table public.expenses   enable row level security;

drop policy if exists categories_owner on public.categories;
create policy categories_owner on public.categories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists incomes_owner on public.incomes;
create policy incomes_owner on public.incomes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists expenses_owner on public.expenses;
create policy expenses_owner on public.expenses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
