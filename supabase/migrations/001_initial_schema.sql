-- Floin Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Businesses table
create table public.businesses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text check (type in ('product', 'service', 'hybrid')) not null default 'product',
  currency text not null default 'NGN',
  channels text[] default array['instagram', 'whatsapp']::text[],
  created_at timestamptz default now() not null
);

-- Sales entries table
create table public.sales_entries (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  date date not null default current_date,
  channel text not null,
  units integer not null default 1,
  amount numeric(12, 2) not null,
  note text,
  created_at timestamptz default now() not null
);

-- Monthly expense tracker
create table public.expense_months (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  month_year text not null, -- format: YYYY-MM
  production numeric(12, 2) default 0,
  logistics numeric(12, 2) default 0,
  marketing numeric(12, 2) default 0,
  packaging numeric(12, 2) default 0,
  software numeric(12, 2) default 0,
  amenities numeric(12, 2) default 0,
  notes text,
  created_at timestamptz default now() not null,
  unique(business_id, month_year)
);

-- Custom "other" expenses
create table public.expense_others (
  id uuid default uuid_generate_v4() primary key,
  expense_month_id uuid references public.expense_months(id) on delete cascade not null,
  label text not null,
  amount numeric(12, 2) not null
);

-- Product catalogue (for faster sale entry)
create table public.products (
  id uuid default uuid_generate_v4() primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  price numeric(12, 2) not null,
  created_at timestamptz default now() not null
);

-- Indexes for performance
create index idx_sales_business_date on public.sales_entries(business_id, date desc);
create index idx_sales_business_month on public.sales_entries(business_id, date);
create index idx_expenses_business_month on public.expense_months(business_id, month_year);
create index idx_products_business on public.products(business_id);

-- Row Level Security
alter table public.businesses enable row level security;
alter table public.sales_entries enable row level security;
alter table public.expense_months enable row level security;
alter table public.expense_others enable row level security;
alter table public.products enable row level security;

-- RLS Policies: Users can only access their own business data
create policy "Users can manage their own businesses"
  on public.businesses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage sales for their businesses"
  on public.sales_entries for all
  using (business_id in (select id from public.businesses where user_id = auth.uid()))
  with check (business_id in (select id from public.businesses where user_id = auth.uid()));

create policy "Users can manage expenses for their businesses"
  on public.expense_months for all
  using (business_id in (select id from public.businesses where user_id = auth.uid()))
  with check (business_id in (select id from public.businesses where user_id = auth.uid()));

create policy "Users can manage other expenses for their businesses"
  on public.expense_others for all
  using (expense_month_id in (
    select em.id from public.expense_months em
    join public.businesses b on b.id = em.business_id
    where b.user_id = auth.uid()
  ))
  with check (expense_month_id in (
    select em.id from public.expense_months em
    join public.businesses b on b.id = em.business_id
    where b.user_id = auth.uid()
  ));

create policy "Users can manage products for their businesses"
  on public.products for all
  using (business_id in (select id from public.businesses where user_id = auth.uid()))
  with check (business_id in (select id from public.businesses where user_id = auth.uid()));
