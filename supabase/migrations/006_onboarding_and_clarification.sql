-- Onboarding State Machine & Clarification Context
-- Fixes two bugs: (1) onboarding not asking questions, (2) bot forgetting context during clarifications

-- Add onboarding_state column to whatsapp_users
alter table whatsapp_users add column if not exists onboarding_state text not null default 'new'
  check (onboarding_state in ('new', 'asked_name', 'asked_biz', 'first_sale', 'done'));

-- Add index for onboarding state
create index if not exists idx_whatsapp_users_onboarding_state on whatsapp_users(onboarding_state);

-- Add owner_name column to store user's name from onboarding
alter table whatsapp_users add column if not exists owner_name text;

-- Update pending_actions to support 'withdrawal' and 'clarifying' stage
alter table whatsapp_pending_actions drop constraint if exists whatsapp_pending_actions_action_type_check;
alter table whatsapp_pending_actions add constraint whatsapp_pending_actions_action_type_check
  check (action_type in ('sale', 'expense', 'debt_payment', 'withdrawal', 'correction', 'clarifying'));

-- Add partial_parse column for clarification context
alter table whatsapp_pending_actions add column if not exists partial_parse jsonb;

-- Set default onboarding_state='done' for existing users who completed onboarding
update whatsapp_users
set onboarding_state = 'done'
where onboarding_completed_at is not null and onboarding_state = 'new';
