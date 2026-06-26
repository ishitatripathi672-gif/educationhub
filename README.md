# PRIME-STUDY LMS Platform

A premium Next.js Learning Management System (LMS) platform with integrated Telegram Bot capabilities.

## 🚀 One-Click Deploy to Heroku

You can easily deploy this application to Heroku with a single click:

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

> **Note**: To make the button work, replace the deploy link with your own GitHub repository URL in the format:
> `https://heroku.com/deploy?template=https://github.com/YOUR_USERNAME/YOUR_REPOSITORY`

---

## 🛠️ Deployment Instructions (Step-by-Step)

### Option 1: Heroku Deploy Button (Recommended)
1. Fork or push this repository to your own GitHub account.
2. Update the deploy link in this `README.md` with your repository URL.
3. Click the **Deploy to Heroku** button.
4. Fill in the required environment variables:
   * **`MONGODB_URI`**: Your MongoDB database connection string.
   * **`JWT_SECRET`**: Automatically generated secure key (you can leave this as is or enter custom value).
   * **`BASE_URL`**: Your Heroku App URL (e.g., `https://your-app-name.herokuapp.com`).
   * **`NEXT_PUBLIC_BASE_URL`**: Same as `BASE_URL`.
   * **`NEXT_PUBLIC_URL`**: Same as `BASE_URL`.
   * **`BOT_TOKEN`** (Optional): Telegram Bot token if you are running the bot integration.
5. Click **Deploy App**. Heroku will automatically install dependencies, build the Next.js app, and start the web server!

### Option 2: Heroku CLI Deployment
If you prefer deploying via the Heroku CLI, run the following commands in your terminal:

```bash
# 1. Login to Heroku
heroku login

# 2. Create a Heroku App
heroku create your-app-name

# 3. Set Environment Variables
heroku config:set MONGODB_URI="your_mongodb_uri"
heroku config:set BASE_URL="https://your-app-name.herokuapp.com"
heroku config:set NEXT_PUBLIC_BASE_URL="https://your-app-name.herokuapp.com"
heroku config:set NEXT_PUBLIC_URL="https://your-app-name.herokuapp.com"
heroku config:set JWT_SECRET="your_jwt_secret"

# 4. Deploy your code
git push heroku main
```

---

## ⚙️ Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Run the Telegram Bot:
   ```bash
   npm run bot
   ```
4. Build the application for production:
   ```bash
   npm run build
   ```
5. Start the production server locally:
   ```bash
   npm run start
   ```

---

*Made by Sattu Op Bolte & Improved for One-Click Heroku Deployment.*
