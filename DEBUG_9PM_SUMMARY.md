# 9pm Summary Not Showing - Debugging Guide

## Quick Checklist

### 1. **Is it deployed to Vercel production?**
Vercel crons ONLY run on production deployments, not:
- ❌ Local dev (`npm run dev`)
- ❌ Preview deployments (PR branches)
- ✅ Production deployment only

**Check:**
- Go to Vercel dashboard → Your project
- Check "Deployments" tab → Is there a recent production deployment?
- Crons tab → Should show "daily-summaries" scheduled

**Fix:** Deploy latest changes to production:
```bash
git push origin main  # Already done
# Wait for Vercel auto-deploy
# OR manually deploy via Vercel dashboard
```

---

### 2. **Environment variables configured?**
The cron needs these in production:

**Required:**
```bash
CRON_SECRET=your-secret-here
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
```

**Check:**
- Vercel dashboard → Settings → Environment Variables
- Make sure all are set for "Production"

---

### 3. **Correct time zone?**
Schedule: `"0 20 * * *"` = **20:00 UTC** = **9:00pm WAT** (Lagos time)

**Current time check:**
- What time is it NOW in Nigeria?
- Did 9pm already pass today?
- If not, wait until 9pm and check again

---

### 4. **Are you in the database as an active user?**
The cron only sends to users matching:
- `is_active = true`
- `business_id` is not null
- `subscription_status` in ['trial', 'active']
- `last_message_at` within 24 hours (for free-form messages)

**Check via Supabase dashboard:**
```sql
SELECT wa_phone, business_id, subscription_status, last_message_at, is_active
FROM whatsapp_users
WHERE wa_phone = 'YOUR_PHONE_NUMBER';
```

**Fix:**
- If `is_active = false`: Update to true
- If `business_id` is null: Complete onboarding
- If `last_message_at` older than 24h: Send any message to bot first

---

### 5. **24-Hour Service Window**
WhatsApp's policy: Free-form messages only work within 24 hours of user's last message.

**Current behavior:**
- If you messaged today → Gets full summary ✅
- If you DIDN'T message today → Skipped (template message not implemented yet)

**Check:**
- Did you send ANY message to the bot today (before 9pm)?
- If no → That's why! The cron skips inactive users

**Fix:**
- Send any message to bot: "hi"
- Wait until tomorrow's 9pm summary

---

## Manual Test (Debug Right Now)

Instead of waiting for 9pm, manually trigger the cron:

**Option 1 - Using curl (if deployed):**
```bash
curl -X POST "https://your-app.vercel.app/api/cron/daily-summaries?phone=YOUR_WHATSAPP_NUMBER" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Option 2 - Vercel dashboard:**
- Go to Deployments → Latest production
- Find "Functions" or "Logs"
- Look for `/api/cron/daily-summaries` executions at 20:00 UTC

---

## Common Issues

### Issue: "Cron runs but I get nothing"
**Symptoms:** Logs show cron executed, but no WhatsApp message

**Causes:**
1. 24-hour window expired (didn't message today)
2. `last_message_at` not updated properly
3. WhatsApp token expired/invalid

**Debug:**
Check Vercel function logs for:
```
Processing X users...
⏭️ Skipped YOUR_PHONE (inactive, template not implemented)
```

### Issue: "Unauthorized" in logs
**Cause:** CRON_SECRET not set or incorrect

**Fix:**
- Vercel → Settings → Environment Variables
- Add `CRON_SECRET` with a random string
- Redeploy

### Issue: "No active users"
**Cause:** Database has no users matching criteria

**Fix:**
- Check Supabase `whatsapp_users` table
- Verify `is_active=true` and `business_id` is set

---

## What the Cron Actually Does

Current implementation sends:
```
📊 Daily Summary — Monday, Jun 17

💰 Sales: ₦50,000
📦 Units: 25
📋 Transactions: 8
📸 Top channel: Instagram

💳 Outstanding debts: ₦20,000
👥 Debtors: 3 people

Sent by FLOIN at 9pm 🌙
```

**Note:** Current version shows SALES ONLY (not expenses/profit/cash). This needs updating to use `getDailyTotals()`.

---

## Next Steps

1. **Verify deployment:**
   - Check Vercel dashboard → Deployments → Latest production
   - Confirm all env vars set

2. **Send a test message:**
   - Message the bot: "hi"
   - This updates your `last_message_at`

3. **Wait for 9pm WAT (or test manually):**
   - Schedule: Every day at 9pm Lagos time
   - Or use manual test endpoint

4. **Check Vercel logs:**
   - Deployments → Your production deployment → "View Function Logs"
   - Filter by `/api/cron/daily-summaries`
   - Look for execution at 20:00 UTC

5. **If still not working:**
   - Share Vercel function logs
   - Share your phone number (last 4 digits)
   - Share screenshot of whatsapp_users table row

---

## Known Limitation

The cron currently uses old `calculateDailySummary()` which:
- ❌ Shows sales only (no expenses/profit/cash)
- ❌ Not using `getDailyTotals()` for consistency

**Should show:**
```
📊 Daily Summary — Jun 17

💰 Sales: ₦50,000
📉 Expenses: ₦2,000
🟢 Profit: ₦48,000

💵 Cash in drawer: ₦38,000
📌 Owed to you: ₦10,000 (1 person)
```

This can be fixed by updating the daily summaries cron to use `getDailyTotals()`.
