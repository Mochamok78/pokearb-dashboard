# Pokearb Dashboard with eBay API

## Setup (one time)

1. Copy `.env.example` to `.env`
2. Open `.env` and paste your real eBay keys:
   ```
   EBAY_CLIENT_ID=your_real_client_id
   EBAY_CLIENT_SECRET=your_real_client_secret
   ```
3. In the terminal inside this folder run:
   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:3000 in your browser.

## How to get eBay keys
1. Go to https://developer.ebay.com
2. Sign in → Create an App
3. Copy App ID (Client ID) and Cert ID (Client Secret) into the `.env` file.

## Using the Search Bot
- Click **Search Bot** in the sidebar
- Type a card name (e.g. `charizard base set`)
- Click **Search eBay**
- Results appear with title, price, condition, and link

## Deploy to pokearb.org later
Once it works locally, we can move the same code to Vercel (serverless) so it runs on your domain. Tell me when local search works.