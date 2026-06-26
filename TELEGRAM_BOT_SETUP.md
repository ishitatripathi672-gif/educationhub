# 🤖 Telegram Verification Bot - Local Setup Guide

## Prerequisites

Before starting the bot locally, make sure you have:

1. **Node.js** (v16 or higher)
2. **MongoDB** running locally or a connection string
3. **npm** dependencies installed

```bash
npm install
```

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` to create a new bot
3. Follow the prompts:
   - Give your bot a name (e.g., "CodeWithPrime-Study Verification Bot")
   - Give your bot a username (e.g., "Prime-Study_verification_bot") - **This is important!**
4. **Save the BOT_TOKEN** you receive (format: `123456789:ABCdefGHIjklmnoPQRstUVwxyz`)

### Example Response from BotFather:
```
Done! Congratulations on your new bot. You will find it at t.me/Prime-Study_verification_bot. 
You can now add a description, about section and profile picture for your new bot, see /help for a list of commands. By the way, when you've finished creating your cool bot, ping our Bot Support if you want a better username for it. Just ping @BotSupport with the token (kept confidential) and a description of what it does. Congratulations on your new bot. You will find it at t.me/Prime-Study_verification_bot.

Here's your token:
123456789:ABCdefGHIjklmnoPQRstUVwxyz
```

## Step 2: Update Environment Variables

Add the following to your `.env.local` file:

```env
# Telegram Bot Configuration
BOT_TOKEN=123456789:ABCdefGHIjklmnoPQRstUVwxyz
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=Prime-Study_verification_bot

# MongoDB (if not already set)
MONGODB_URI=mongodb://localhost:27017/Prime-Study
```

**Replace:**
- `123456789:ABCdefGHIjklmnoPQRstUVwxyz` with your actual BOT_TOKEN
- `Prime-Study_verification_bot` with your bot's username (without the @)

## Step 3: Start MongoDB

Make sure MongoDB is running:

```bash
# If using MongoDB locally
mongod

# Or if using Docker
docker run -d -p 27017:27017 --name mongodb mongo
```

## Step 4: Start the Bot

### Option A: Run Only the Bot
```bash
npm run bot
```

### Option B: Run Both App & Bot Concurrently
```bash
npm run both
```

This will start:
- **Next.js App** on `http://localhost:3000`
- **Telegram Bot** in polling mode

### Option C: Manual Execution
```bash
npx tsx scripts/bot.ts
```

## Step 5: Test the Bot

1. Open Telegram and search for your bot: `@Prime-Study_verification_bot`
2. Start the bot with `/start`
3. You should see a welcome message

### Test Verification Flow

1. Get a user ID from your app (e.g., from localStorage or API)
2. Send this to the bot:
   ```
   /start verify_USER_ID_HERE
   ```
   Or use the verification link from the app: `https://t.me/Prime-Study_verification_bot?start=verify_USER_ID_HERE`

3. The bot will:
   - Extract your Telegram ID
   - Update the user's record in MongoDB with your Telegram ID
   - Send confirmation message

### Available Bot Commands

Once running, the bot supports:

- `/start` - Start verification
- `/start verify_<userId>` - Verify with a specific user ID
- `/verify <userId>` - Alternative verification command
- `/status` - Check verification status
- `/help` - Show help message

## Bot Features

### ✅ What the Bot Does

1. **Accepts /start with verification code**
   - Captures verification payload: `verify_userId`
   - Extracts the user's Telegram ID and username

2. **Updates Database**
   - Finds the user by ID in MongoDB
   - Stores the Telegram ID in the user's profile
   - Returns confirmation

3. **Provides Feedback**
   - Confirmation messages for successful verification
   - Error handling with user-friendly messages
   - Status checking capability

### 📊 Database Updates

When a user verifies through the bot, the following happens:

```javascript
// User document is updated with:
{
  _id: ObjectId,
  UserName: "John Doe",
  phoneNumber: "+919876543210",
  telegramId: "1234567890",  // ← Bot sets this
  // ... other fields
}
```

## Debugging

### View Bot Logs

The bot will log messages to the console:

```
✅ Connected to MongoDB
🚀 Telegram Bot is starting...
✅ Bot is running in polling mode
📍 /start received with payload: verify_507f1f77bcf86cd799439011
🔍 Processing verification for userId: 507f1f77bcf86cd799439011
📱 Telegram ID: 1234567890, Username: john_doe
✅ User 507f1f77bcf86cd799439011 verified with Telegram ID: 1234567890
```

### Common Issues

| Issue | Solution |
|-------|----------|
| `BOT_TOKEN environment variable is not set` | Add `BOT_TOKEN` to `.env.local` |
| `MONGODB_URI environment variable is not set` | Add `MONGODB_URI` to `.env.local` |
| `Cannot connect to MongoDB` | Ensure MongoDB is running and connection string is correct |
| `Bot doesn't respond` | Check that your `.env.local` has the correct BOT_TOKEN |
| `Bot receives messages but doesn't update DB` | Check MongoDB logs and ensure User model connection is working |

## Sending Verification Link from App

In your app's client code (currently in [app/check/page.tsx](app/check/page.tsx)):

```typescript
// This already exists in the code
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
const telegramUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=verify_${userId}`;
window.open(telegramUrl, "_blank");
```

When user clicks this link:
1. Opens Telegram with your bot
2. Sends `/start verify_userId` automatically
3. Bot processes and updates database
4. User sees confirmation

## Architecture

```
User App (Frontend)
    ↓
    ├─→ Gets userId
    ├─→ Creates verification link
    └─→ Opens: https://t.me/bot?start=verify_userId
        ↓
        Telegram Bot
        ├─→ Receives /start with payload
        ├─→ Extracts userId & Telegram ID
        ├─→ Updates MongoDB User record
        └─→ Sends confirmation
        ↓
        ✅ Verification Complete
```

## Production Deployment

For production, use **webhook** instead of **polling**:

1. Get a valid SSL certificate
2. Update [scripts/bot.ts](scripts/bot.ts):
   ```typescript
   // Replace polling with webhook
   await bot.launch({
     webhook: {
       domain: "your-domain.com",
       port: 443,
       secretPathComponent: "/telegram",
     },
   });
   ```

3. Set up reverse proxy (nginx/Apache) for HTTPS

## Stopping the Bot

Press `Ctrl+C` in the terminal running the bot:

```
🛑 Stopping bot...
```

The bot will gracefully shut down and close database connections.

## Additional Resources

- [Telegraf Documentation](https://telegraf.js.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather Guide](https://core.telegram.org/bots#botfather)

---

**Need help?** Check the bot console logs and MongoDB for debugging information.
