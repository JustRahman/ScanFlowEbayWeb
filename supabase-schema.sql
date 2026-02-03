-- Create the ebay_books table for storing eBay book listings
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ebay_books (
  id SERIAL PRIMARY KEY,

  -- eBay listing data
  isbn VARCHAR(13) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,                -- Price in cents
  condition VARCHAR(50) NOT NULL,
  seller VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  ebay_item_id VARCHAR(50) NOT NULL,
  ebay_url TEXT NOT NULL,
  image_url TEXT,
  shipping INTEGER DEFAULT 0,            -- Shipping cost in cents
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Amazon/Keepa evaluation data (filled after evaluation)
  decision VARCHAR(10),                  -- 'BUY', 'REVIEW', 'REJECT'
  asin VARCHAR(20),
  amazon_price INTEGER,                  -- Price in cents
  sales_rank INTEGER,
  sales_rank_drops_30 INTEGER,
  sales_rank_drops_90 INTEGER,
  fba_profit INTEGER,                    -- Profit in cents
  fbm_profit INTEGER,                    -- Profit in cents
  fba_roi DECIMAL(5,2),                  -- ROI percentage
  score INTEGER,                         -- Decision score 0-100
  evaluated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ebay_books_isbn ON ebay_books(isbn);
CREATE INDEX IF NOT EXISTS idx_ebay_books_decision ON ebay_books(decision);
CREATE INDEX IF NOT EXISTS idx_ebay_books_scraped_at ON ebay_books(scraped_at);
CREATE INDEX IF NOT EXISTS idx_ebay_books_score ON ebay_books(score DESC);
CREATE INDEX IF NOT EXISTS idx_ebay_books_pending ON ebay_books(scraped_at) WHERE decision IS NULL;

-- Enable Row Level Security (optional but recommended)
ALTER TABLE ebay_books ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (adjust as needed)
CREATE POLICY "Allow all operations" ON ebay_books
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- One Planet Books Table
-- =====================================================

CREATE TABLE IF NOT EXISTS oneplanetbooks_books (
  id SERIAL PRIMARY KEY,

  -- eBay listing data
  isbn VARCHAR(13) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,                -- Price in cents
  condition VARCHAR(50) NOT NULL,
  seller VARCHAR(100) NOT NULL DEFAULT 'oneplanetbooks',
  category VARCHAR(100) NOT NULL,
  ebay_item_id VARCHAR(50) NOT NULL,
  ebay_url TEXT NOT NULL,
  image_url TEXT,
  shipping INTEGER DEFAULT 0,            -- Shipping cost in cents
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Amazon/Keepa evaluation data (filled after evaluation)
  decision VARCHAR(10),                  -- 'BUY', 'REVIEW', 'REJECT'
  asin VARCHAR(20),
  amazon_price INTEGER,                  -- Price in cents
  sales_rank INTEGER,
  sales_rank_drops_30 INTEGER,
  sales_rank_drops_90 INTEGER,
  fba_profit INTEGER,                    -- Profit in cents
  fbm_profit INTEGER,                    -- Profit in cents
  fba_roi DECIMAL(5,2),                  -- ROI percentage
  score INTEGER,                         -- Decision score 0-100
  evaluated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_oneplanetbooks_books_isbn ON oneplanetbooks_books(isbn);
CREATE INDEX IF NOT EXISTS idx_oneplanetbooks_books_decision ON oneplanetbooks_books(decision);
CREATE INDEX IF NOT EXISTS idx_oneplanetbooks_books_scraped_at ON oneplanetbooks_books(scraped_at);
CREATE INDEX IF NOT EXISTS idx_oneplanetbooks_books_score ON oneplanetbooks_books(score DESC);
CREATE INDEX IF NOT EXISTS idx_oneplanetbooks_books_pending ON oneplanetbooks_books(scraped_at) WHERE decision IS NULL;

-- Enable Row Level Security
ALTER TABLE oneplanetbooks_books ENABLE ROW LEVEL SECURITY;

-- Allow all operations
CREATE POLICY "Allow all operations" ON oneplanetbooks_books
  FOR ALL
  USING (true)
  WITH CHECK (true);
