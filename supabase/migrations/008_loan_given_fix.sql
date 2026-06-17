-- Fix money categorization - separate loans from sales
-- Bug: Cash loans were being recorded as credit sales, inflating revenue

-- Update pending_actions to support loan_given action type
alter table whatsapp_pending_actions drop constraint if exists whatsapp_pending_actions_action_type_check;
alter table whatsapp_pending_actions add constraint whatsapp_pending_actions_action_type_check
  check (action_type in ('sale', 'expense', 'debt_payment', 'withdrawal', 'correction', 'clarifying', 'loan_given'));

-- Add loan_given flag to debts table to distinguish loans from credit sales
alter table whatsapp_debts add column if not exists is_loan boolean not null default false;

-- Add index for querying loans vs credit sales separately
create index if not exists idx_debts_is_loan on whatsapp_debts(is_loan);

-- Comment for clarity
comment on column whatsapp_debts.is_loan is
  'true = cash loan given (NOT revenue), false = credit sale (IS revenue)';
