-- ScanFlow - eBay Books Table (multi-seller)
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ebay_books (
  id SERIAL PRIMARY KEY,

  -- eBay listing data
  isbn VARCHAR(13) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,                -- Price in cents
  condition VARCHAR(50) NOT NULL,
  seller VARCHAR(100) NOT NULL,          -- 'booksrun', 'oneplanetbooks'
  category VARCHAR(100) NOT NULL,
  ebay_item_id VARCHAR(50) NOT NULL,
  ebay_url TEXT NOT NULL,
  image_url TEXT,
  shipping INTEGER DEFAULT 0,            -- Shipping cost in cents
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Amazon/Keepa evaluation data (filled after evaluation)
  decision VARCHAR(10),                  -- 'BUY', 'REVIEW', 'REJECT', 'BOUGHT'
  asin VARCHAR(20),
  amazon_price INTEGER,                  -- Realistic sell price in cents
  sales_rank INTEGER,                    -- 180-day average sales rank
  sales_rank_drops_30 INTEGER,
  sales_rank_drops_90 INTEGER,
  fba_profit INTEGER,                    -- FBA profit in cents
  fbm_profit INTEGER,                    -- FBM profit in cents
  fba_roi DECIMAL(5,2),                  -- ROI percentage (legacy)
  score INTEGER,                         -- Decision score 0-100 (legacy)
  amazon_flag VARCHAR(10),               -- 'green', 'yellow', 'red' (Amazon 1P stockout)
  book_type VARCHAR(50),                 -- 'Paperback', 'Hardcover', etc.
  weight_oz DECIMAL(6,1),               -- Weight in ounces
  evaluated_at TIMESTAMP WITH TIME ZONE,

  -- Action tracking
  bought_at TIMESTAMP WITH TIME ZONE     -- Set when user marks as BOUGHT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ebay_books_isbn ON ebay_books(isbn);
CREATE INDEX IF NOT EXISTS idx_ebay_books_decision ON ebay_books(decision);
CREATE INDEX IF NOT EXISTS idx_ebay_books_scraped_at ON ebay_books(scraped_at);
CREATE INDEX IF NOT EXISTS idx_ebay_books_score ON ebay_books(score DESC);
CREATE INDEX IF NOT EXISTS idx_ebay_books_seller ON ebay_books(seller);
CREATE INDEX IF NOT EXISTS idx_ebay_books_bought_at ON ebay_books(bought_at);
CREATE INDEX IF NOT EXISTS idx_ebay_books_pending ON ebay_books(scraped_at) WHERE decision IS NULL;

-- Enable Row Level Security
ALTER TABLE ebay_books ENABLE ROW LEVEL SECURITY;

-- Allow all operations
CREATE POLICY "Allow all operations" ON ebay_books
  FOR ALL
  USING (true)
  WITH CHECK (true);
