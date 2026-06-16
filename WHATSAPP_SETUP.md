# WhatsApp Bot Setup Guide

## Week 1 Progress ✅

All foundation tasks completed:
1. ✅ Database migration created
2. ✅ npm packages installed
3. ✅ Webhook route implemented
4. ✅ WhatsApp API client built
5. ✅ LLM parser with Pidgin support
6. ✅ Confirmation workflow
7. ✅ Message router

## Next Steps

### 1. Run Database Migration

Run the migration in your Supabase SQL Editor:

```bash
# Navigate to: https://supabase.com/dashboard
# Select your project → SQL Editor → New Query
# Copy and paste the contents of:
supabase/migrations/004_whatsapp_schema.sql
# Click "Run"
```

### 2. Set Up Meta Business Manager & WhatsApp API

#### A. Create WhatsApp Business App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app → Type: **Business**
3. Add Product → **WhatsApp**
4. This gives you a test number immediately

#### B. Get Your Credentials

From the WhatsApp API Setup page, note:
- **Phone Number ID** (looks like: `123456789012345`)
- **Temporary Access Token** (for testing)
- **App Secret** (App Settings → Basic)
- **WABA ID** (WhatsApp Business Account ID)

#### C. Generate Permanent Token

1. Business Settings → System Users → Create system user (admin role)
2. Assign app + WABA assets to this user
3. Generate Token with permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. **Save this token** - it's your permanent `WHATSAPP_TOKEN`

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in all values:

```env
# WhatsApp Configuration
WHATSAPP_TOKEN=your_permanent_token_from_step_2c
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_from_step_2b
WHATSAPP_APP_SECRET=your_app_secret_from_step_2b
WHATSAPP_VERIFY_TOKEN=make_up_any_random_string

# Supabase Service Role
SUPABASE_SERVICE_ROLE_KEY=get_from_supabase_dashboard_settings_api

# Anthropic API
ANTHROPIC_API_KEY=get_from_anthropic_console

# Cron Security
CRON_SECRET=generate_random_string
```

### 4. Deploy to Vercel (or test locally)

#### Local Testing with ngrok/cloudflared

```bash
# Terminal 1: Start Next.js dev server
npm run dev

# Terminal 2: Start tunnel (example with cloudflared)
cloudflared tunnel --url http://localhost:3000
```

Note the public URL (e.g., `https://abc123.trycloudflare.com`)

#### Configure Webhook in Meta

1. WhatsApp → Configuration
2. Webhook → Edit
3. Callback URL: `https://your-domain.com/api/whatsapp/webhook`
4. Verify Token: (same as `WHATSAPP_VERIFY_TOKEN` in your .env)
5. Subscribe to: **messages** webhook field
6. Click **Verify and Save**

### 5. Test the Bot

Send a test message to your WhatsApp Business number:

```
Sold 3 bags for 45k
```

Expected flow:
1. Bot receives message ✅
2. Parses with Claude ✅
3. Sends confirmation with buttons ✅
4. You reply "Yes" ✅
5. Bot saves to database and sends receipt ✅

### 6. Check Logs

Monitor Vercel logs or your local console for:
- ✅ Webhook verified
- ✅ Message stored
- ✅ LLM parse results
- ✅ Confirmation sent
- ✅ Sale committed

## Troubleshooting

### Webhook not receiving messages

1. Check Meta webhook subscription status
2. Verify signature is correct (check `WHATSAPP_APP_SECRET`)
3. Check Vercel/cloudflared logs

### LLM parsing errors

1. Verify `ANTHROPIC_API_KEY` is valid
2. Check Anthropic account has credits
3. Review parse errors in logs

### Database errors

1. Verify migration ran successfully
2. Check `SUPABASE_SERVICE_ROLE_KEY` is correct
3. Ensure RLS policies don't block service role

## Testing Checklist

- [ ] Webhook verification succeeds
- [ ] English message: "Sold 5k" → parses correctly
- [ ] Pidgin message: "I don sell 3000 naira" → parses correctly
- [ ] Confirmation with "Yes" → saves to database
- [ ] Cancel with "No" → rejects pending action
- [ ] Query: "How much today?" → returns correct total
- [ ] Help command → shows help message
- [ ] New user → onboarding flow works

## Phase 2 Features (Coming Next)

Week 2-6 will add:
- Daily 9pm summaries (cron)
- Debt tracking (credit sales)
- Weekly/monthly queries
- Voice note support (Whisper)
- Payment integration (Paystack)

## Resources

- [WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Supabase Docs](https://supabase.com/docs)
- [Implementation Plan](C:\Users\AKEJU TIOLUWANI\.claude\plans\sunny-orbiting-gizmo.md)
