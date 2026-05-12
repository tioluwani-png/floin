-- Team Members & Invitations
-- Run this in your Supabase SQL Editor after 001_initial_schema.sql

-- Business members (team access)
create table if not exists business_members (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  user_email text,
  user_name text,
  user_avatar_url text,
  joined_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists idx_business_members_business_id on business_members(business_id);
create index if not exists idx_business_members_user_id on business_members(user_id);

-- Business invites (shareable invite links)
create table if not exists business_invites (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  token text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_business_invites_token on business_invites(token);
create index if not exists idx_business_invites_business_id on business_invites(business_id);

-- Helper function: returns all business IDs accessible to the current user
create or replace function accessible_business_ids()
returns setof text
language sql
security definer
stable
as $$
  select id from businesses where user_id = auth.uid()::text
  union
  select business_id from business_members where user_id = auth.uid()::text
$$;

-- Enable RLS on new tables
alter table business_members enable row level security;
alter table business_invites enable row level security;

-- ============================================================
-- Drop existing RLS policies (from 001_initial_schema.sql)
-- ============================================================

drop policy if exists "Users can manage their own businesses" on businesses;
drop policy if exists "Users can manage sales for their businesses" on sales_entries;
drop policy if exists "Users can manage expenses for their businesses" on expense_months;
drop policy if exists "Users can manage expense others for their businesses" on expense_others;
drop policy if exists "Users can manage products for their businesses" on products;

-- ============================================================
-- Recreate RLS policies with member access
-- ============================================================

-- businesses: owners + members can read/update, only owners can insert/delete
create policy "Users can read accessible businesses"
  on businesses for select
  using (
    user_id = auth.uid()::text
    or id in (select business_id from business_members where user_id = auth.uid()::text)
  );

create policy "Users can insert their own businesses"
  on businesses for insert
  with check (user_id = auth.uid()::text);

create policy "Users can update accessible businesses"
  on businesses for update
  using (
    user_id = auth.uid()::text
    or id in (select business_id from business_members where user_id = auth.uid()::text)
  );

create policy "Only owners can delete businesses"
  on businesses for delete
  using (user_id = auth.uid()::text);

-- sales_entries: full access for owners + members
create policy "Users can manage sales for accessible businesses"
  on sales_entries for all
  using (business_id in (select accessible_business_ids()))
  with check (business_id in (select accessible_business_ids()));

-- expense_months: full access for owners + members
create policy "Users can manage expenses for accessible businesses"
  on expense_months for all
  using (business_id in (select accessible_business_ids()))
  with check (business_id in (select accessible_business_ids()));

-- expense_others: full access for owners + members (through expense_months)
create policy "Users can manage expense others for accessible businesses"
  on expense_others for all
  using (expense_month_id in (
    select em.id from expense_months em
    where em.business_id in (select accessible_business_ids())
  ))
  with check (expense_month_id in (
    select em.id from expense_months em
    where em.business_id in (select accessible_business_ids())
  ));

-- products: full access for owners + members
create policy "Users can manage products for accessible businesses"
  on products for all
  using (business_id in (select accessible_business_ids()))
  with check (business_id in (select accessible_business_ids()));

-- ============================================================
-- RLS policies for business_members
-- ============================================================

-- Members can see other members of businesses they belong to
create policy "Members can view members of their businesses"
  on business_members for select
  using (
    business_id in (select accessible_business_ids())
  );

-- Owners can add members, or users can add themselves (accepting invite)
create policy "Users can insert members"
  on business_members for insert
  with check (
    business_id in (select id from businesses where user_id = auth.uid()::text)
    or user_id = auth.uid()::text
  );

-- Owners can remove members, or members can remove themselves
create policy "Users can remove members"
  on business_members for delete
  using (
    business_id in (select id from businesses where user_id = auth.uid()::text)
    or user_id = auth.uid()::text
  );

-- ============================================================
-- RLS policies for business_invites
-- ============================================================

-- Owners have full access to their invites
create policy "Owners can manage invites"
  on business_invites for all
  using (
    business_id in (select id from businesses where user_id = auth.uid()::text)
  )
  with check (
    business_id in (select id from businesses where user_id = auth.uid()::text)
  );

-- Any authenticated user can read invites (needed to look up token when accepting)
create policy "Authenticated users can read invites"
  on business_invites for select
  using (auth.uid() is not null);
