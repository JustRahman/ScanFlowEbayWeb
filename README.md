# ScanFlow - Book Arbitrage Finder

A web app that helps book sellers find profitable arbitrage opportunities by comparing eBay listings with Amazon prices.

## What It Does

1. **Searches eBay** for books from trusted wholesale sellers (ThriftBooks, Better World Books, etc.)
2. **Looks up Amazon prices** via Keepa API for each book's ISBN
3. **Calculates profit** after Amazon fees (referral, closing, FBA)
4. **Scores deals** and recommends: BUY, REVIEW, or REJECT

## How It Works

```
User searches "textbook"
        ↓
eBay API → Returns listings with prices
        ↓
Extract ISBN from each listing
        ↓
Keepa API → Returns Amazon price, sales rank, competition
        ↓
Calculate: Profit = Amazon Price - eBay Price - Fees
        ↓
Display scored deals with recommendations
```

## Tech Stack

- **Framework**: Next.js 14 (React + API routes)
- **Styling**: Tailwind CSS
- **APIs**: eBay Browse API, Keepa API

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file with your API keys:
   ```
   EBAY_CLIENT_ID=your_ebay_client_id
   EBAY_CLIENT_SECRET=your_ebay_client_secret
   KEEPA_API_KEY=your_keepa_api_key
   ```

3. Run the dev server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── ebay/search/route.ts    # eBay search endpoint
│   │   ├── featured/route.ts       # Featured deals endpoint
│   │   └── keepa/product/route.ts  # Keepa lookup endpoint
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    # Main search page
├── components/
│   └── BookDetailModal.tsx         # Book detail popup
└── services/
    ├── ebayApi.ts                  # eBay API client
    └── keepaApi.ts                 # Keepa API client
```

## Features

- Search books by keyword
- Filter by seller, condition, and max price
- View book details with profit calculation
- See sales velocity (rank drops = estimated sales/month)
- Competition analysis (FBA seller count)
- Risk assessment for each deal
- Direct links to eBay listing and Amazon product page

## API Keys

### eBay
1. Go to https://developer.ebay.com
2. Create an application
3. Get Client ID and Client Secret (Production keys)

### Keepa
1. Go to https://keepa.com
2. Subscribe to API access
3. Get your API key from account settings
