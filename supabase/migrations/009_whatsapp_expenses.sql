-- WhatsApp Expenses Tracking
-- Individual expense entries (not monthly aggregates)

create table if not exists whatsapp_expenses (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  expense_date date not null,
  category text,  -- ads, fuel, transport, supplies, etc. (optional)
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_expenses_business on whatsapp_expenses(business_id);
create index if not exists idx_whatsapp_expenses_date on whatsapp_expenses(expense_date);

-- RLS
alter table whatsapp_expenses enable row level security;

create policy "Users can manage expenses for their businesses"
  on whatsapp_expenses for all
  using (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ))
  with check (business_id in (
    select id from businesses where user_id = auth.uid()::text
  ));
