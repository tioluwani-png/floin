# WhatsApp Bot Testing Guide

Complete step-by-step guide to test your FLOIN WhatsApp bot.

---

## Step 1: Meta Business Manager Setup (15 minutes)

### Create Meta Developer Account

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **"My Apps"** → **"Create App"**
3. Choose **"Business"** as app type
4. Fill in:
   - **App Name**: "FLOIN" (or "FLOIN Test")
   - **App Contact Email**: Your email
   - **Business Account**: Select or create one
5. Click **"Create App"**

### Add WhatsApp Product

1. In your app dashboard, click **"Add Product"**
2. Find **"WhatsApp"** and click **"Set Up"**
3. This creates a WhatsApp Business Account (WABA) automatically

### Get Test Phone Number (Instant!)

Meta gives you a **test number immediately** - you can start testing within minutes!

1. In **WhatsApp → Getting Started** tab
2. You'll see a **test phone number** (e.g., +1 555...)
3. Note down:
   - **Phone number ID** (looks like: `123456789012345`)
   - **Test number** (the actual WhatsApp number)
   - **Temporary access token** (valid 24 hours)

### Add Your Phone as Tester

1. Scroll to **"To"** field
2. Click **"Manage phone number list"**
3. Add **your personal WhatsApp number** (the one you'll test with)
4. Verify via code sent to WhatsApp
5. ✅ You can now message the test number!

---

## Step 2: Get Permanent Credentials (10 minutes)

### Create System User (for permanent token)

1. Click **hamburger menu** → **"Business Settings"**
2. Go to **"System Users"** (under "Users" section)
3. Click **"Add"** → Create new system user
   - **Name**: "FLOIN Server"
   - **Role**: Admin
4. Click **"Add Assets"**
   - Select your app
   - Select the WABA
   - Toggle **Full Control** on both
5. Click **"Generate New Token"**
   - Select your app
   - Check permissions:
     - ✅ `whatsapp_business_messaging`
     - ✅ `whatsapp_business_management`
   - **Copy this token!** (This is your `WHATSAPP_TOKEN`)

### Get App Secret

1. Go back to your app dashboard
2. Click **"Settings"** → **"Basic"**
3. Copy **"App Secret"** (click "Show")
4. This is your `WHATSAPP_APP_SECRET`

---

## Step 3: Run Database Migration

Before testing, make sure all tables exist:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your Floin project
3. Click **"SQL Editor"** → **"New Query"**
4. Run each migration file:

```sql
-- Run 004_whatsapp_schema.sql (copy entire file)
-- Run 005_owner_withdrawals.sql (copy entire file)
```

5. Create storage bucket:
   - **Storage** → **"Create bucket"**
   - Name: `monthly-reports`
   - Public: ✅ Yes

---

## Step 4: Configure Environment Variables

Update your `.env.local`:

```env
# Existing Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# WhatsApp Cloud API
WHATSAPP_TOKEN=your_permanent_token_from_step2
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_from_step1
WHATSAPP_APP_SECRET=your_app_secret_from_step2
WHATSAPP_VERIFY_TOKEN=any_random_string_make_one_up

# AI APIs
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key

# Cron Security
CRON_SECRET=any_random_string
```

**Important**:
- `WHATSAPP_VERIFY_TOKEN` - **YOU make this up!** (e.g., "floin-webhook-2026")
- You'll use this same string when configuring the webhook in Meta

---

## Step 5: Deploy or Test Locally

### Option A: Deploy to Vercel (Recommended)

1. **Push to GitHub:**
   ```bash
   cd floin
   git add .
   git commit -m "Add WhatsApp bot - Phase 2 complete"
   git push origin main
   ```

2. **Deploy to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repo
   - Add all environment variables (from Step 4)
   - Click **"Deploy"**

3. **Note your URL**: `https://your-app.vercel.app`

### Option B: Local Testing (with Tunnel)

If you want to test locally first:

1. **Install Cloudflare Tunnel:**
   ```bash
   npm install -g cloudflared
   ```

2. **Start Next.js dev server:**
   ```bash
   cd floin
   npm run dev
   ```
   (Runs on http://localhost:3000)

3. **Start tunnel (new terminal):**
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. **Copy the public URL** (e.g., `https://abc123.trycloudflare.com`)

---

## Step 6: Configure Webhook in Meta

1. Go to your app dashboard
2. **WhatsApp** → **"Configuration"**
3. In **Webhook** section, click **"Edit"**

### Configure Webhook URL:

**Callback URL:**
```
https://your-app.vercel.app/api/whatsapp/webhook
```
(Or your cloudflared URL if testing locally)

**Verify Token:**
```
your_WHATSAPP_VERIFY_TOKEN_from_env
```
(The one YOU made up in Step 4)

4. Click **"Verify and Save"**
   - ✅ Should show "Verified" with green checkmark
   - ❌ If it fails: check URL is correct, verify token matches .env

### Subscribe to Webhook Fields:

Still in Configuration, scroll to **"Webhook fields"**:

1. Find **"messages"** field
2. Click **"Subscribe"** ✅
3. Optionally subscribe to:
   - `message_status` (delivery receipts)
   - `message_echoes` (for debugging)

---

## Step 7: Test the Bot! 🎉

### Send Your First Message

1. Open **WhatsApp** on your phone
2. Start a chat with the **test number** (from Step 1)
3. Send: **"Hello"**

**Expected Response:**
```
👋 Welcome to FLOIN!

What's your business name?
```

4. Reply: **"Test Shop"**

**Expected Response:**
```
Welcome to FLOIN! 🎉

Your business "Test Shop" is set up.

Log your first sale now! Try:
"Sold 3 bags 45k"

Type "help" anytime for assistance.
```

### Test Core Features

**1. Log a Sale (Text):**
```
You: Sold 3 bags 45k

Bot: 📝 Confirm this sale?
     💰 Amount: ₦45,000
     📦 Units: 3
     📅 Date: Today

     [Confirm] [Cancel] buttons

You: Yes

Bot: ✅ Sale saved! Today's total: ₦45,000
```

**2. Log a Sale (Voice Note):**
- Record voice: "I don sell two power bank 5000 naira"
- Bot: "🎤 Processing your voice note..."
- Bot: Shows confirmation with parsed details
- You: "Yes"
- Bot: "✅ Sale saved!"

**3. Credit Sale:**
```
You: Mama Nkechi carry 1 bag on credit 15k

Bot: 📝 Confirm this sale?
     💰 Amount: ₦15,000
     📦 Units: 1

     💳 Credit Sale
     Customer: Mama Nkechi owes ₦15,000

You: Yes

Bot: ✅ Sale saved!
```

**4. Check Today's Sales:**
```
You: How much today?

Bot: 📊 Today's Summary
     💰 Total sales: ₦65,000
     📦 Units sold: 6
     📋 Transactions: 3
```

**5. Check Debts:**
```
You: Who dey owe me?

Bot: 💳 Outstanding Debts (1)

     👤 Mama Nkechi
        Owes: ₦15,000
        1 day old

     Total owed: ₦15,000

     💡 Reply "remind Mama Nkechi"
```

**6. Save Customer Phone:**
```
You: Mama Nkechi phone is 08012345678

Bot: ✅ Saved Mama Nkechi's number!
     You can now send reminders
```

**7. Send Reminder:**
```
You: remind Mama Nkechi

Bot: ✅ Reminder sent to Mama Nkechi!
     They've been notified about ₦15,000.
```

(Mama Nkechi receives a polite WhatsApp message)

**8. Mark Debt Paid:**
```
You: mark Mama Nkechi paid

Bot: ✅ Debt cleared!
     Mama Nkechi has paid ₦15,000
     🎉 Great job collecting!
```

**9. Owner Withdrawal:**
```
You: I took 20k for myself

Bot: 📝 Confirm owner withdrawal?
     💵 Amount: ₦20,000
     📌 Note: Personal withdrawal (not business expense)

You: Yes

Bot: ✅ Withdrawal recorded!
     This is tracked separately from business expenses.
```

**10. Help:**
```
You: help

Bot: 📚 FLOIN Help

     Log a sale: "Sold 3 bags 45k" or 🎤 voice note
     Credit sale: "Mama Nkechi carry 1 bag on credit 15k"
     Owner withdrawal: "I took 20k for myself"
     Check today: "How much today?"
     Manage debts: "Who dey owe me?"
     ...
```

---

## Step 8: Verify in Database

Check that data is being saved:

1. Go to **Supabase Dashboard** → **Table Editor**
2. Check tables:

**whatsapp_users:**
- Should see your phone number
- business_id should be set
- onboarding_completed_at should have timestamp

**whatsapp_messages_raw:**
- Should see all messages (inbound + outbound)
- processed = true

**businesses:**
- Should see "Test Shop" or your business name

**sales_entries:**
- Should see your test sales
- channel = 'whatsapp'
- amounts in naira (not kobo)

**whatsapp_debts:**
- Should see Mama Nkechi's debt (if you tested credit)
- amount_kobo and balance_kobo are integers

**owner_withdrawals:**
- Should see your 20k withdrawal

---

## Step 9: Test Daily Summary (Manual Trigger)

Since daily summaries run at 9pm, test manually:

```bash
curl "https://your-app.vercel.app/api/cron/daily-summaries" \
  -H "Authorization: Bearer your_cron_secret"
```

**Expected**: You receive a WhatsApp message with today's summary!

---

## Step 10: Test Monthly Report (Manual)

Generate a test PDF report:

```bash
curl -X POST "https://your-app.vercel.app/api/cron/monthly-reports?month=2026-06&business=YOUR_BUSINESS_ID" \
  -H "Authorization: Bearer your_cron_secret"
```

(Get business_id from Supabase → businesses table)

**Expected**:
- PDF is generated
- Uploaded to Supabase Storage
- WhatsApp message with download link

---

## Troubleshooting

### "Webhook verification failed"
- ✅ Check callback URL is correct: `/api/whatsapp/webhook`
- ✅ Check verify token matches exactly (case-sensitive)
- ✅ Try with `https://` not `http://`
- ✅ If local: make sure tunnel is running

### "No response from bot"
- ✅ Check Vercel logs (if deployed) or console (if local)
- ✅ Verify webhook is subscribed to "messages" field
- ✅ Check your phone is added as a tester
- ✅ Test number must be the one from Meta dashboard

### "Signature verification failed"
- ✅ Check `WHATSAPP_APP_SECRET` is correct
- ✅ Copy from App Settings → Basic
- ✅ Make sure no extra spaces in .env file

### "Voice notes not working"
- ✅ Check `OPENAI_API_KEY` is set
- ✅ Verify OpenAI account has credits
- ✅ Check Whisper API is enabled

### "LLM not parsing correctly"
- ✅ Check `ANTHROPIC_API_KEY` is set
- ✅ Verify Anthropic account has credits
- ✅ Check logs for parsing errors

### "PDF generation fails"
- ✅ Check `monthly-reports` bucket exists in Supabase Storage
- ✅ Bucket must be public
- ✅ Verify @react-pdf/renderer is installed

---

## Going to Production

### 1. Register Real Phone Number

The test number only works for developers. For production:

1. **Meta Dashboard** → **WhatsApp** → **Phone Numbers**
2. Click **"Add Phone Number"**
3. Options:
   - **Use existing WhatsApp number** (migrate from app)
   - **Get new number** (from Meta partner like Twilio)
4. Complete **business verification**:
   - Upload CAC documents
   - Proof of business
   - Takes 1-3 days for approval

### 2. Display Name & Profile

1. Set **display name**: "FLOIN"
2. Add **profile photo**: FLOIN logo
3. Add **business description**

### 3. Message Templates

For users who haven't messaged in 24 hours, you need approved templates:

1. **WhatsApp** → **Message Templates**
2. Create template: **"daily_summary"**
   ```
   Your FLOIN summary for {{1}} is ready. Reply 'summary' to see it.
   ```
3. Category: Utility
4. Submit for approval (usually approved in hours)

### 4. Monitoring

Set up monitoring:
- **Vercel logs**: Check for errors
- **Supabase logs**: Monitor database queries
- **Sentry**: Error tracking (optional)
- **Meta Dashboard**: Message delivery rates, quality rating

---

## Cost Estimate

**Free Tier (Test):**
- Test phone number: ✅ Free
- Up to 1,000 service conversations/month: ✅ Free
- Business-initiated (templates): ~$0.02 each

**Production Pricing:**
- First 1,000 service conversations: Free
- Additional service conversations: $0.005 - $0.01 each
- Business-initiated: $0.015 - $0.02 each
- Nigeria rate: ~₦10-20 per template message

**Your Cost Structure:**
- Active users who message daily: ~Free (service window)
- Daily summaries to inactive users: ~₦15/message
- Monthly reports: Free (within service window)
- Debt reminders: ~₦15/message

**Example**: 100 active users, 20 inactive
- Active (messaged today): Free summaries
- Inactive: 20 × ₦15 = ₦300/day
- Monthly: ~₦9,000 for 100 users

---

## Next Steps

1. ✅ Test all features above
2. 🎯 Get 5 real traders to use it for 1 week
3. 📊 Monitor: confirmation rates, retention, errors
4. 🐛 Fix any bugs found
5. 🚀 Launch to first 100 users in Computer Village!

---

## Quick Reference

**Test Message Examples:**
```
Sold 3 bags 45k
I don sell 5000 naira
Mama Nkechi carry 2 bags on credit 15k
How much today?
Who dey owe me?
Mama Nkechi phone is 080...
remind Mama Nkechi
mark Mama Nkechi paid
I took 20k for myself
help
```

**Important URLs:**
- Meta Dashboard: https://developers.facebook.com/apps
- Supabase: https://supabase.com/dashboard
- Vercel: https://vercel.com/dashboard

**Support:**
- WhatsApp API Docs: https://developers.facebook.com/docs/whatsapp
- Meta Support: https://business.facebook.com/business/help

---

**You're ready to test! 🚀**

Start with "Hello" and work through the test features above. Each feature builds on the previous one to tell the complete FLOIN story.
