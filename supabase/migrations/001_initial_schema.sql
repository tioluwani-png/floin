-- Floin Database Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

-- Businesses
create table if not exists businesses (
  id text primary key,
  user_id text not null,
  name text not null,
  type text not null default 'product' check (type in ('product', 'service', 'hybrid')),
  currency text not null default 'NGN',
  channels text[] not null default '{"instagram","whatsapp"}',
  logo_base64 text,
  created_at timestamptz not null default now()
);

create index if not exists idx_businesses_user_id on businesses(user_id);

-- Sales entries
create table if not exists sales_entries (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  date text not null,
  channel text not null,
  units integer not null default 0,
  amount numeric not null default 0,
  delivery_fee numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_business_id on sales_entries(business_id);
create index if not exists idx_sales_date on sales_entries(date);

-- Expense months
create table if not exists expense_months (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  month_year text not null,
  production numeric not null default 0,
  logistics numeric not null default 0,
  marketing numeric not null default 0,
  packaging numeric not null default 0,
  software numeric not null default 0,
  amenities numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, month_year)
);

create index if not exists idx_expense_months_business_id on expense_months(business_id);

-- Expense others (custom line items within an expense month)
create table if not exists expense_others (
  id text primary key,
  expense_month_id text not null references expense_months(id) on delete cascade,
  label text not null,
  amount numeric not null default 0
);

create index if not exists idx_expense_others_month_id on expense_others(expense_month_id);

-- Products (catalogue for quick-select during sale logging)
create table if not exists products (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  price numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_business_id on products(business_id);

-- Row Level Security
alter table businesses enable row level security;
alter table sales_entries enable row level security;
alter table expense_months enable row level security;
alter table expense_others enable row level security;
alter table products enable row level security;

-- RLS policies: users can only access their own data
create policy "Users can manage their own businesses"
  on businesses for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "Users can manage sales for their businesses"
  on sales_entries for all
  using (business_id in (select id from businesses where user_id = auth.uid()::text))
  with check (business_id in (select id from businesses where user_id = auth.uid()::text));

create policy "Users can manage expenses for their businesses"
  on expense_months for all
  using (business_id in (select id from businesses where user_id = auth.uid()::text))
  with check (business_id in (select id from businesses where user_id = auth.uid()::text));

create policy "Users can manage expense others for their businesses"
  on expense_others for all
  using (expense_month_id in (
    select em.id from expense_months em
    join businesses b on b.id = em.business_id
    where b.user_id = auth.uid()::text
  ))
  with check (expense_month_id in (
    select em.id from expense_months em
    join businesses b on b.id = em.business_id
    where b.user_id = auth.uid()::text
  ));

create policy "Users can manage products for their businesses"
  on products for all
  using (business_id in (select id from businesses where user_id = auth.uid()::text))
  with check (business_id in (select id from businesses where user_id = auth.uid()::text));
