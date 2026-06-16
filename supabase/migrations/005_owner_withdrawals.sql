-- Owner Withdrawals Tracking
-- Track money taken out of business for personal use

create table if not exists owner_withdrawals (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  withdrawal_date date not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_withdrawals_business on owner_withdrawals(business_id);
create index if not exists idx_withdrawals_date on owner_withdrawals(withdrawal_date);

-- Row Level Security
alter table owner_withdrawals enable row level security;

-- RLS Policy: Users can manage withdrawals for their businesses
create policy "Users can manage withdrawals for their businesses"
  on owner_withdrawals for all
  using (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ))
  with check (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ));
