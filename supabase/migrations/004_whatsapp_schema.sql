-- WhatsApp Bot Schema
-- Adds tables for WhatsApp AI bookkeeping bot integration

-- WhatsApp Users
-- Links WhatsApp phone numbers to Floin users and tracks subscription
create table if not exists whatsapp_users (
  id text primary key,
  wa_phone text not null unique,
  user_id text,  -- nullable for guest mode, references auth.users(id)
  business_id text references businesses(id) on delete set null,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'pidgin')),
  timezone text not null default 'Africa/Lagos',
  is_active boolean not null default true,
  onboarding_completed_at timestamptz,
  trial_ends_at timestamptz,
  subscription_status text not null default 'trial' check (subscription_status in ('trial', 'active', 'expired')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_users_phone on whatsapp_users(wa_phone);
create index if not exists idx_whatsapp_users_user_id on whatsapp_users(user_id);
create index if not exists idx_whatsapp_users_business_id on whatsapp_users(business_id);

-- WhatsApp Messages Raw
-- Zero-lost-message guarantee - every webhook event persists here first
create table if not exists whatsapp_messages_raw (
  id text primary key,
  wa_message_id text not null unique,  -- WhatsApp's message ID (dedupe key)
  wa_phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,  -- text, audio, image, document
  body text,
  media_url text,
  media_mime_type text,
  received_at timestamptz not null,
  processed boolean not null default false,
  processed_at timestamptz,
  error_message text,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_raw_wa_id on whatsapp_messages_raw(wa_message_id);
create index if not exists idx_messages_raw_phone on whatsapp_messages_raw(wa_phone);
create index if not exists idx_messages_raw_unprocessed on whatsapp_messages_raw(processed) where processed = false;
create index if not exists idx_messages_raw_created on whatsapp_messages_raw(created_at desc);

-- WhatsApp Pending Actions
-- Confirm-before-commit workflow state
create table if not exists whatsapp_pending_actions (
  id text primary key,
  wa_phone text not null,
  business_id text not null references businesses(id) on delete cascade,
  action_type text not null check (action_type in ('sale', 'expense', 'debt_payment', 'correction')),
  intent_data jsonb not null,  -- {amount_kobo, units, note, date, etc}
  confirmation_message text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  committed_record_id text,  -- FK to sales_entries.id or whatsapp_debts.id after commit
  created_at timestamptz not null default now()
);

create index if not exists idx_pending_wa_phone on whatsapp_pending_actions(wa_phone);
create index if not exists idx_pending_status on whatsapp_pending_actions(status);
create index if not exists idx_pending_expires on whatsapp_pending_actions(expires_at) where status = 'pending';

-- WhatsApp Debts
-- Credit sales tracking
create table if not exists whatsapp_debts (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  customer_name text not null,
  customer_phone text,
  amount_kobo bigint not null check (amount_kobo >= 0),  -- ALWAYS in kobo (integers)
  balance_kobo bigint not null check (balance_kobo >= 0),
  sale_date date not null,
  due_date date,
  note text,
  status text not null default 'outstanding' check (status in ('outstanding', 'partial', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_debts_business on whatsapp_debts(business_id);
create index if not exists idx_debts_status on whatsapp_debts(status);
create index if not exists idx_debts_customer on whatsapp_debts(customer_name);

-- WhatsApp Debt Payments
-- Payment history for debts
create table if not exists whatsapp_debt_payments (
  id text primary key,
  debt_id text not null references whatsapp_debts(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  payment_date date not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_debt_payments_debt on whatsapp_debt_payments(debt_id);
create index if not exists idx_debt_payments_date on whatsapp_debt_payments(payment_date);

-- WhatsApp Daily Summaries
-- Cached daily summary data for 9pm messages
create table if not exists whatsapp_daily_summaries (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  summary_date date not null,
  total_sales_kobo bigint not null default 0,
  sales_count integer not null default 0,
  total_expenses_kobo bigint not null default 0,
  top_channel text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, summary_date)
);

create index if not exists idx_summaries_business on whatsapp_daily_summaries(business_id);
create index if not exists idx_summaries_date on whatsapp_daily_summaries(summary_date);

-- WhatsApp Link Codes
-- Temporary codes for linking WhatsApp accounts to web users
create table if not exists whatsapp_link_codes (
  id text primary key,
  code text not null unique,  -- 6-char alphanumeric
  user_id text not null,
  business_id text references businesses(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_link_codes_code on whatsapp_link_codes(code);
create index if not exists idx_link_codes_user on whatsapp_link_codes(user_id);

-- Row Level Security
alter table whatsapp_users enable row level security;
alter table whatsapp_messages_raw enable row level security;
alter table whatsapp_pending_actions enable row level security;
alter table whatsapp_debts enable row level security;
alter table whatsapp_debt_payments enable row level security;
alter table whatsapp_daily_summaries enable row level security;
alter table whatsapp_link_codes enable row level security;

-- RLS Policies
-- Note: Server-side webhook operations use service role key and bypass RLS
-- These policies are for potential future web dashboard access to WhatsApp data

-- WhatsApp users can see their own record
create policy "Users can view their own WhatsApp profile"
  on whatsapp_users for select
  using (user_id = auth.uid()::text);

-- Users can view messages for their linked WhatsApp account
create policy "Users can view their WhatsApp messages"
  on whatsapp_messages_raw for select
  using (wa_phone in (
    select wa_phone from whatsapp_users where user_id = auth.uid()::text
  ));

-- Users can view pending actions for their businesses
create policy "Users can view pending actions for their businesses"
  on whatsapp_pending_actions for select
  using (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ));

-- Users can view debts for their businesses
create policy "Users can manage debts for their businesses"
  on whatsapp_debts for all
  using (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ))
  with check (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ));

-- Users can view debt payments for their debts
create policy "Users can manage debt payments for their businesses"
  on whatsapp_debt_payments for all
  using (debt_id in (
    select d.id from whatsapp_debts d
    join businesses b on b.id = d.business_id
    where b.user_id = auth.uid()::text
  ))
  with check (debt_id in (
    select d.id from whatsapp_debts d
    join businesses b on b.id = d.business_id
    where b.user_id = auth.uid()::text
  ));

-- Users can view summaries for their businesses
create policy "Users can view summaries for their businesses"
  on whatsapp_daily_summaries for select
  using (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ));

-- Users can view their own link codes
create policy "Users can view their own link codes"
  on whatsapp_link_codes for select
  using (user_id = auth.uid()::text);
