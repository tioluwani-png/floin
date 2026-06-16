-- Language Preference Support (Pidgin / English)
-- Allows users to choose their preferred language for bot interactions

-- Add language_pref column to whatsapp_users
alter table whatsapp_users
  add column if not exists language_pref text not null default 'auto'
  check (language_pref in ('pidgin', 'english', 'auto'));

-- Update onboarding_state to include language selection step
alter table whatsapp_users drop constraint if exists whatsapp_users_onboarding_state_check;
alter table whatsapp_users add constraint whatsapp_users_onboarding_state_check
  check (onboarding_state in ('new', 'asked_name', 'asked_lang', 'asked_biz', 'first_sale', 'done'));

-- Create index for language preference queries
create index if not exists idx_whatsapp_users_language_pref on whatsapp_users(language_pref);

-- Add comment for documentation
comment on column whatsapp_users.language_pref is
  'User language preference: pidgin, english, or auto (detect from usage)';
