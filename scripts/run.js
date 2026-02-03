#!/usr/bin/env node
/**
 * ScanFlow eBay Book Scanner - CLI Script
 *
 * Usage:
 *   node scripts/run.js              # Fetch + Evaluate
 *   node scripts/run.js --fetch      # Only fetch from eBay
 *   node scripts/run.js --evaluate   # Only evaluate pending books
 *   node scripts/run.js --stats      # Show stats only
 *   node scripts/run.js --reset      # Reset all decisions to pending
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ==================== CONFIG ====================
const CONFIG = {
  // eBay settings
  EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,

  // Keepa settings
  KEEPA_API_KEY: process.env.KEEPA_API_KEY,
  KEEPA_DELAY: 1200, // ms between Keepa calls
  MIN_KEEPA_TOKENS: 100,

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,

  // Search settings
  SELLERS: ['oneplanetbooks'],
  CONDITIONS: ['LIKE_NEW'],
  MIN_PRICE: 3,
  MAX_PRICE: 25,

  // Use Books category (267) with keyword searches
  BOOKS_CATEGORY_ID: '267',

  // Search queries (like BetterWorldBooks scraper)
  SEARCH_QUERIES: [
    'textbook',
    'college textbook',
    'university textbook',
    'medical textbook',
    'nursing textbook',
    'biology textbook',
    'chemistry textbook',
    'physics textbook',
    'calculus textbook',
    'psychology textbook',
    'accounting textbook',
    'economics textbook',
    'business textbook',
    'engineering textbook',
    'computer science textbook',
    'statistics textbook',
    'anatomy textbook',
    'pharmacology textbook',
    'law textbook',
    'history textbook',
    'sociology textbook',
    'mathematics textbook',
    'organic chemistry',
    'microbiology textbook',
    'biochemistry textbook',
    'philosophy textbook',
    'programming textbook',
    'data science textbook',
    'electrical engineering textbook',
    'nutrition textbook',
    'pathology textbook',
    'political science textbook',
    'criminal justice textbook',
    'public health textbook',
    'finance textbook',
    'neuroscience textbook',
    'genetics textbook',
    'math textbook',
    'motivational books',
    'anatomy',
    'economics',
    'self help books',
  ],

  // Decision thresholds
  BUY: {
    MULTIPLIER: 6,
    MAX_SALES_RANK: 1500000,
    MIN_DROPS_90: 3,
    // Exception 1: High Buy Price
    HIGH_BUY_PRICE_THRESHOLD: 3000, // cents ($30)
    HIGH_BUY_PRICE_MIN_MULT: 3,
    HIGH_BUY_PRICE_MAX_RANK: 1000000,
    HIGH_BUY_PRICE_MIN_DROPS: 10,
    // Exception 2: High Profit
    HIGH_PROFIT_THRESHOLD: 10000, // cents ($100)
    HIGH_PROFIT_MAX_RANK: 1000000,
    HIGH_PROFIT_MIN_DROPS: 10,
  },
  REVIEW: {
    MULTIPLIER: 4,
    MAX_SALES_RANK: 2500000,
    MIN_DROPS_90: 2,
  },

  // Fees
  REFERRAL_FEE_PERCENT: 0.15,
  CLOSING_FEE: 180, // cents
  FBA_FULFILLMENT_FEE: 350, // cents
  FBM_SHIPPING_COST: 400, // cents
};

const CONDITION_IDS = {
  'NEW': '1000',
  'LIKE_NEW': '2750',
  'VERY_GOOD': '4000',
  'GOOD': '5000',
  'ACCEPTABLE': '6000',
};

// ==================== GLOBALS ====================
let supabase = null;
let ebayToken = null;
let ebayTokenExpires = 0;
let keepaTokens = null;

const stats = {
  fetched: 0,
  saved: 0,
  duplicates: 0,
  evaluated: 0,
  buy: 0,
  review: 0,
  reject: 0,
  errors: 0,
  startTime: null,
};

// ==================== UTILS ====================
const delay = ms => new Promise(r => setTimeout(r, ms));

function log(msg, type = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    'info': '   ',
    'success': ' ✓ ',
    'warning': ' ⚠ ',
    'error': ' ✗ ',
    'skip': ' → ',
    'buy': ' $ ',
    'review': ' ? ',
    'reject': ' - ',
    'keepa': ' ⟳ ',
    'ebay': ' 🔍 ',
  }[type] || '   ';
  console.log(`[${timestamp}]${prefix}${msg}`);
}

// ==================== SUPABASE ====================
function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    log('Missing SUPABASE_URL or SUPABASE_KEY', 'error');
    process.exit(1);
  }
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  log('Supabase connected', 'success');
}

async function getExistingISBNs() {
  const isbns = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('oneplanetbooks_books')
      .select('isbn')
      .range(from, from + pageSize - 1);

    if (error) {
      log(`Error loading ISBNs: ${error.message}`, 'error');
      break;
    }
    if (!data || data.length === 0) break;

    data.forEach(row => isbns.add(row.isbn));
    from += pageSize;
    if (data.length < pageSize) break;
  }

  return isbns;
}

async function saveBook(book) {
  const { error } = await supabase
    .from('oneplanetbooks_books')
    .insert(book);

  if (error) {
    if (error.code === '23505') {
      return 'duplicate';
    }
    log(`Insert error: ${error.message}`, 'warning');
    return 'error';
  }
  return 'saved';
}

async function updateBookEvaluation(isbn, data) {
  const { error } = await supabase
    .from('oneplanetbooks_books')
    .update({ ...data, evaluated_at: new Date().toISOString() })
    .eq('isbn', isbn);

  if (error) {
    log(`Update error for ${isbn}: ${error.message}`, 'error');
    return false;
  }
  return true;
}

async function getPendingBooks() {
  const allBooks = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('oneplanetbooks_books')
      .select('*')
      .is('decision', null)
      .order('scraped_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      log(`Error fetching pending: ${error.message}`, 'error');
      break;
    }
    if (!data || data.length === 0) break;

    allBooks.push(...data);
    from += pageSize;
    if (data.length < pageSize) break;
  }

  return allBooks;
}

async function getStats() {
  const [total, pending, buy, review, reject] = await Promise.all([
    supabase.from('oneplanetbooks_books').select('*', { count: 'exact', head: true }),
    supabase.from('oneplanetbooks_books').select('*', { count: 'exact', head: true }).is('decision', null),
    supabase.from('oneplanetbooks_books').select('*', { count: 'exact', head: true }).eq('decision', 'BUY'),
    supabase.from('oneplanetbooks_books').select('*', { count: 'exact', head: true }).eq('decision', 'REVIEW'),
    supabase.from('oneplanetbooks_books').select('*', { count: 'exact', head: true }).eq('decision', 'REJECT'),
  ]);

  return {
    total: total.count || 0,
    pending: pending.count || 0,
    buy: buy.count || 0,
    review: review.count || 0,
    reject: reject.count || 0,
  };
}

// ==================== EBAY API ====================
async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires - 300000) {
    return ebayToken;
  }

  if (!CONFIG.EBAY_CLIENT_ID || !CONFIG.EBAY_CLIENT_SECRET) {
    throw new Error('Missing eBay credentials');
  }

  const credentials = Buffer.from(`${CONFIG.EBAY_CLIENT_ID}:${CONFIG.EBAY_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!response.ok) {
    throw new Error(`eBay OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in * 1000);
  log('eBay token obtained', 'success');
  return ebayToken;
}

async function searchEbay(query, limit = 200, offset = 0) {
  const token = await getEbayToken();

  // Build filters - seller first, then price with bounded range and currency
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 30);
  const minDateStr = minDate.toISOString();

  // Order matters: seller first, then price with explicit bounds and currency
  const filters = [
    `sellers:{${CONFIG.SELLERS.join('|')}}`,
    `price:[${CONFIG.MIN_PRICE}..${CONFIG.MAX_PRICE}]`,
    `priceCurrency:USD`,
    `conditionIds:{${CONFIG.CONDITIONS.map(c => CONDITION_IDS[c]).join('|')}}`,
    'buyingOptions:{FIXED_PRICE}',
    `itemCreationDate:[${minDateStr}]`,
  ];

  // Build URL with proper encoding
  const filterStr = filters.join(',');
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&category_ids=${CONFIG.BOOKS_CATEGORY_ID}&limit=${limit}&offset=${offset}&filter=${encodeURIComponent(filterStr)}&fieldgroups=EXTENDED&sort=newlyListed`;

  // Debug: show filter being used (first request only)
  if (offset === 0) {
    log(`  Filter: ${filterStr}`, 'info');
  }

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (response.status === 429) {
    log('eBay rate limited! Stopping fetch to start evaluation...', 'warning');
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    throw new Error(`eBay search failed: ${response.status}`);
  }

  return response.json();
}

async function fetchItemDetails(itemId) {
  const token = await getEbayToken();
  const url = `https://api.ebay.com/buy/browse/v1/item/${itemId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

function extractISBN(item) {
  if (item.isbn && item.isbn.length > 0) return item.isbn[0];
  if (item.gtin) {
    const clean = item.gtin.replace(/[-\s]/g, '');
    if (clean.length === 10 || clean.length === 13) return clean;
  }
  if (item.localizedAspects) {
    const isbnAspect = item.localizedAspects.find(a => a.name.toLowerCase().includes('isbn'));
    if (isbnAspect) return isbnAspect.value;
  }
  const match = item.title.match(/\b(97[89]\d{10}|\d{9}[\dX])\b/i);
  if (match) return match[1];
  return null;
}

// ==================== KEEPA API ====================
async function checkKeepaTokens() {
  if (!CONFIG.KEEPA_API_KEY) return null;

  try {
    const response = await fetch(`https://api.keepa.com/token?key=${CONFIG.KEEPA_API_KEY}`);
    const data = await response.json();
    keepaTokens = data.tokensLeft;
    return data.tokensLeft;
  } catch (e) {
    return null;
  }
}

async function waitForKeepaTokens() {
  let tokens = await checkKeepaTokens();

  while (tokens !== null && tokens < CONFIG.MIN_KEEPA_TOKENS) {
    log(`Keepa tokens: ${tokens} < ${CONFIG.MIN_KEEPA_TOKENS}. Waiting 60s...`, 'keepa');
    await delay(60000);
    tokens = await checkKeepaTokens();
  }

  if (tokens !== null) {
    log(`Keepa tokens: ${tokens}`, 'keepa');
  }
}

async function fetchKeepaData(isbn) {
  if (!CONFIG.KEEPA_API_KEY) throw new Error('No Keepa API key');

  // Include history=1 to get csv price history data
  const url = `https://api.keepa.com/product?key=${CONFIG.KEEPA_API_KEY}&domain=1&code=${isbn}&stats=180&history=1&offers=20`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.tokensLeft !== undefined) {
    keepaTokens = data.tokensLeft;
  }

  if (!data.products || data.products.length === 0) {
    return null;
  }

  return data.products[0];
}

// Batch fetch up to 100 ISBNs at once
async function fetchKeepaDataBatch(isbns) {
  if (!CONFIG.KEEPA_API_KEY) throw new Error('No Keepa API key');
  if (isbns.length === 0) return {};

  // Join ISBNs with comma for batch request
  const codes = isbns.join(',');
  const url = `https://api.keepa.com/product?key=${CONFIG.KEEPA_API_KEY}&domain=1&code=${codes}&stats=180&history=1&offers=20`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.tokensLeft !== undefined) {
    keepaTokens = data.tokensLeft;
    log(`Keepa tokens left: ${keepaTokens}`, 'keepa');
  }

  // Map products by ASIN/ISBN for easy lookup
  const results = {};
  if (data.products) {
    for (const product of data.products) {
      // Try to match by EAN (ISBN-13) or code
      if (product.eanList && product.eanList.length > 0) {
        for (const ean of product.eanList) {
          results[ean] = product;
        }
      }
      if (product.asin) {
        results[product.asin] = product;
      }
    }
  }

  return results;
}

function getKeepaPrice(product) {
  // Get NEW prices from csv history (like BooksRun scraper)
  // csv[10] = NEW FBA price, csv[1] = NEW FBM price, csv[2] = USED price
  const csv = product.csv;
  const stats = product.stats;

  // Get current prices from csv history
  const currentPrices = { fba: null, newFBM: null, used: null };

  if (csv) {
    // NEW FBA price (index 10)
    if (csv[10] && csv[10].length >= 2) {
      const lastPrice = csv[10][csv[10].length - 1];
      if (lastPrice > 0) currentPrices.fba = lastPrice;
    }

    // NEW FBM price (index 1)
    if (csv[1] && csv[1].length >= 2) {
      const lastPrice = csv[1][csv[1].length - 1];
      if (lastPrice > 0) currentPrices.newFBM = lastPrice;
    }

    // USED price (index 2)
    if (csv[2] && csv[2].length >= 2) {
      const lastPrice = csv[2][csv[2].length - 1];
      if (lastPrice > 0) currentPrices.used = lastPrice;
    }
  }

  // Get 180-day average prices (protects against seasonal spikes)
  const avgPrices = { fba: null, newFBM: null, used: null };

  if (stats && stats.avg180) {
    if (stats.avg180[10] > 0) avgPrices.fba = stats.avg180[10];
    if (stats.avg180[1] > 0) avgPrices.newFBM = stats.avg180[1];
    if (stats.avg180[2] > 0) avgPrices.used = stats.avg180[2];
  }

  // Use minimum of current vs 180-day average (protects against seasonal spikes)
  const finalPrices = { fba: null, newFBM: null, used: null };

  for (const type of ['fba', 'newFBM', 'used']) {
    const current = currentPrices[type];
    const avg = avgPrices[type];

    if (current && avg) {
      finalPrices[type] = Math.min(current, avg);
    } else {
      finalPrices[type] = current || avg; // Use whichever is available
    }
  }

  // Priority: NEW FBA → NEW FBM → USED
  return finalPrices.fba || finalPrices.newFBM || finalPrices.used;
}

function getSalesRankDrops90(product) {
  return product.stats?.salesRankDrops90 || 0;
}

function getSalesRank(product) {
  // Use average sales rank from stats
  const avg = product.stats?.avg90;
  if (avg && avg[3] > 0) return avg[3];

  // Fallback to current
  const current = product.stats?.current;
  if (current && current[3] > 0) return current[3];

  return null;
}

// ==================== DECISION LOGIC ====================
function makeDecision(buyPrice, amazonPrice, salesRank, salesRankDrops90) {
  const result = {
    decision: 'REJECT',
    reason: '',
    fba_profit: null,
    fbm_profit: null,
    multiplier: null,
  };

  // KNOCKOUT: No Amazon price
  if (!amazonPrice) {
    result.reason = 'No Amazon price';
    return result;
  }

  const multiplier = amazonPrice / buyPrice;
  result.multiplier = multiplier;

  // Calculate profits
  const referralFee = Math.round(amazonPrice * CONFIG.REFERRAL_FEE_PERCENT);
  const fbaProfit = amazonPrice - buyPrice - referralFee - CONFIG.CLOSING_FEE - CONFIG.FBA_FULFILLMENT_FEE;
  const fbmProfit = amazonPrice - buyPrice - referralFee - CONFIG.CLOSING_FEE - CONFIG.FBM_SHIPPING_COST;
  const profit = Math.max(fbaProfit, fbmProfit);

  result.fba_profit = fbaProfit;
  result.fbm_profit = fbmProfit;

  const metricsStr = `${multiplier.toFixed(1)}x | Rank: ${salesRank?.toLocaleString() || 'N/A'} | Drops: ${salesRankDrops90} | Profit: $${(profit / 100).toFixed(0)}`;

  // KNOCKOUT: Sales rank > 3M
  if (salesRank && salesRank > 3000000) {
    result.reason = `Rank ${salesRank.toLocaleString()} > 3M`;
    return result;
  }

  // KNOCKOUT: Multiplier < 4x
  if (multiplier < CONFIG.REVIEW.MULTIPLIER) {
    result.reason = `${multiplier.toFixed(1)}x < 4x`;
    return result;
  }

  // KNOCKOUT: No sales in 90 days
  if (salesRankDrops90 === 0) {
    result.reason = 'No sales (drops90 = 0)';
    return result;
  }

  // === BUY DECISION ===

  // Normal BUY: >= 6x, rank < 1.5M, drops >= 3
  const meetsNormalBuy = multiplier >= CONFIG.BUY.MULTIPLIER &&
                         (!salesRank || salesRank < CONFIG.BUY.MAX_SALES_RANK) &&
                         salesRankDrops90 >= CONFIG.BUY.MIN_DROPS_90;

  // Exception 1: High Buy Price (>= $30): >= 3x, rank < 2.5M, drops >= 3
  const meetsHighBuyPrice = buyPrice >= CONFIG.BUY.HIGH_BUY_PRICE_THRESHOLD &&
                            multiplier >= CONFIG.BUY.HIGH_BUY_PRICE_MIN_MULT &&
                            (!salesRank || salesRank < CONFIG.BUY.HIGH_BUY_PRICE_MAX_RANK) &&
                            salesRankDrops90 >= CONFIG.BUY.HIGH_BUY_PRICE_MIN_DROPS;

  // Exception 2: High Profit (>= $100): any multiplier, rank < 2.5M, drops >= 3
  const meetsHighProfit = profit >= CONFIG.BUY.HIGH_PROFIT_THRESHOLD &&
                          (!salesRank || salesRank < CONFIG.BUY.HIGH_PROFIT_MAX_RANK) &&
                          salesRankDrops90 >= CONFIG.BUY.HIGH_PROFIT_MIN_DROPS;

  // === REVIEW DECISION ===
  // >= 4x, rank < 2.5M, drops >= 2
  const meetsReview = multiplier >= CONFIG.REVIEW.MULTIPLIER &&
                      (!salesRank || salesRank < CONFIG.REVIEW.MAX_SALES_RANK) &&
                      salesRankDrops90 >= CONFIG.REVIEW.MIN_DROPS_90;

  // === FINAL DECISION ===
  if (meetsNormalBuy) {
    result.decision = 'BUY';
    result.reason = metricsStr;
  } else if (meetsHighBuyPrice) {
    result.decision = 'BUY';
    result.reason = `HIGH BUY PRICE | ${metricsStr}`;
  } else if (meetsHighProfit) {
    result.decision = 'BUY';
    result.reason = `HIGH PROFIT | ${metricsStr}`;
  } else if (meetsReview) {
    result.decision = 'REVIEW';
    result.reason = metricsStr;
  } else {
    result.reason = metricsStr;
  }

  return result;
}

// ==================== MAIN FUNCTIONS ====================
async function fetchBooks(startFrom = null) {
  log('\n========== FETCHING BOOKS FROM EBAY ==========\n', 'ebay');

  const existingISBNs = await getExistingISBNs();
  log(`Found ${existingISBNs.size} existing ISBNs in database`, 'info');
  log(`Seller: ${CONFIG.SELLERS.join(', ')}`, 'info');
  log(`Queries: ${CONFIG.SEARCH_QUERIES.length}`, 'info');
  log(`Max Price: $${CONFIG.MAX_PRICE}\n`, 'info');

  let detailFetches = 0;
  let noIsbn = 0;

  // Find starting index if startFrom is specified
  let startIndex = 0;
  if (startFrom) {
    const idx = CONFIG.SEARCH_QUERIES.findIndex(q => q.toLowerCase().includes(startFrom.toLowerCase()));
    if (idx >= 0) {
      startIndex = idx;
      log(`Starting from query: "${CONFIG.SEARCH_QUERIES[idx]}" (index ${idx})`, 'info');
    }
  }

  for (let i = startIndex; i < CONFIG.SEARCH_QUERIES.length; i++) {
    const query = CONFIG.SEARCH_QUERIES[i];
    log(`\n[${i + 1}/${CONFIG.SEARCH_QUERIES.length}] "${query}"`, 'ebay');

    let saved = 0;

    try {
      const results = await searchEbay(query, 200, 0);

      if (!results.itemSummaries || results.itemSummaries.length === 0) {
        log(`  No results`, 'info');
        continue;
      }

      log(`  Found ${results.itemSummaries.length} listings`, 'info');

      // Debug: Check first item's seller and price
      if (results.itemSummaries.length > 0) {
        const first = results.itemSummaries[0];
        log(`  DEBUG: First item - Seller: ${first.seller?.username}, Price: $${first.price?.value}`, 'warning');
      }

      stats.fetched += results.itemSummaries.length;

      for (const item of results.itemSummaries) {
        let isbn = extractISBN(item);

        // If no ISBN from search, fetch full item details
        if (!isbn) {
          detailFetches++;
          const details = await fetchItemDetails(item.itemId);
          if (details) {
            isbn = extractISBN(details);
          }
          await delay(150); // Small delay for detail fetches
        }

        // Skip if still no ISBN
        if (!isbn) {
          noIsbn++;
          continue;
        }

        // Skip if already exists
        if (existingISBNs.has(isbn)) {
          stats.duplicates++;
          continue;
        }

        const price = Math.round(parseFloat(item.price.value) * 100);
        const shipping = item.shippingOptions?.[0]?.shippingCost
          ? Math.round(parseFloat(item.shippingOptions[0].shippingCost.value) * 100)
          : 0;

        const book = {
          isbn,
          title: item.title.substring(0, 500),
          price: price + shipping,
          condition: item.condition || 'Very Good',
          seller: item.seller?.username || 'oneplanetbooks',
          category: query,
          ebay_item_id: item.itemId,
          ebay_url: item.itemWebUrl,
          image_url: item.image?.imageUrl || null,
          shipping,
          scraped_at: new Date().toISOString(),
        };

        const result = await saveBook(book);
        if (result === 'saved') {
          saved++;
          stats.saved++;
          existingISBNs.add(isbn);
          log(`  + ${isbn} - $${((price + shipping) / 100).toFixed(2)} - ${item.title.substring(0, 40)}...`, 'success');
        } else if (result === 'duplicate') {
          stats.duplicates++;
        } else {
          stats.errors++;
        }
      }

      log(`  Saved: ${saved} new books`, 'info');
      await delay(500); // Delay between queries

    } catch (error) {
      if (error.message === 'RATE_LIMITED') {
        log(`\nRate limited - stopping fetch, will start evaluation`, 'warning');
        break;
      }
      log(`  Error: ${error.message}`, 'error');
      stats.errors++;
    }
  }

  log(`\n========== FETCH COMPLETE ==========`, 'success');
  log(`Fetched: ${stats.fetched}`, 'info');
  log(`Saved: ${stats.saved}`, 'info');
  log(`Duplicates: ${stats.duplicates}`, 'info');
  log(`No ISBN: ${noIsbn}`, 'info');
  log(`Detail fetches: ${detailFetches}`, 'info');
}

async function evaluateBooks() {
  log('\n========== EVALUATING WITH KEEPA ==========\n', 'keepa');

  // Get ALL pending books (with pagination)
  const pendingBooks = await getPendingBooks();

  if (pendingBooks.length === 0) {
    log('No pending books to evaluate', 'info');
    return;
  }

  log(`Found ${pendingBooks.length} pending books`, 'info');
  await checkKeepaTokens();

  if (keepaTokens !== null && keepaTokens < CONFIG.MIN_KEEPA_TOKENS) {
    log(`Keepa tokens (${keepaTokens}) below minimum (${CONFIG.MIN_KEEPA_TOKENS}). Stopping.`, 'warning');
    return;
  }

  // Process one book at a time
  for (let i = 0; i < pendingBooks.length; i++) {
    // Check tokens before each request - wait if low
    if (keepaTokens !== null && keepaTokens < CONFIG.MIN_KEEPA_TOKENS) {
      log(`\nKeepa tokens (${keepaTokens}) below minimum (${CONFIG.MIN_KEEPA_TOKENS}). Waiting for refill...`, 'warning');
      await waitForKeepaTokens();
    }

    const book = pendingBooks[i];
    log(`[${i + 1}/${pendingBooks.length}] ${book.isbn} | Tokens: ${keepaTokens || 'N/A'}`, 'keepa');

    try {
      const keepaProduct = await fetchKeepaData(book.isbn);

      if (!keepaProduct) {
        await updateBookEvaluation(book.isbn, { decision: 'REJECT', score: 0 });
        stats.reject++;
        stats.evaluated++;
        log(`  → REJECT (not on Amazon)`, 'reject');
        continue;
      }

      const amazonPrice = getKeepaPrice(keepaProduct);
      const salesRank = getSalesRank(keepaProduct);
      const salesRankDrops90 = getSalesRankDrops90(keepaProduct);

      const decision = makeDecision(book.price, amazonPrice, salesRank, salesRankDrops90);

      await updateBookEvaluation(book.isbn, {
        decision: decision.decision,
        asin: keepaProduct.asin,
        amazon_price: amazonPrice,
        sales_rank: salesRank,
        sales_rank_drops_90: salesRankDrops90,
        fba_profit: decision.fba_profit,
        fbm_profit: decision.fbm_profit,
        score: decision.multiplier ? Math.round(decision.multiplier * 10) : 0,
      });

      stats.evaluated++;
      if (decision.decision === 'BUY') {
        stats.buy++;
        log(`  → BUY (${decision.reason})`, 'buy');
      } else if (decision.decision === 'REVIEW') {
        stats.review++;
        log(`  → REVIEW (${decision.reason})`, 'review');
      } else {
        stats.reject++;
        log(`  → REJECT (${decision.reason})`, 'reject');
      }

      // Delay between requests
      if (i < pendingBooks.length - 1) {
        await delay(CONFIG.KEEPA_DELAY);
      }

    } catch (error) {
      log(`  → Error: ${error.message}`, 'error');
      await updateBookEvaluation(book.isbn, { decision: 'REJECT', score: 0 });
      stats.reject++;
      stats.evaluated++;
      stats.errors++;
    }
  }

  log(`\n========== EVALUATION COMPLETE ==========`, 'success');
  log(`Evaluated: ${stats.evaluated}, BUY: ${stats.buy}, REVIEW: ${stats.review}, REJECT: ${stats.reject}`, 'info');
}

async function resetAllDecisions() {
  log('\n========== RESETTING ALL DECISIONS ==========\n', 'warning');

  const { data, error } = await supabase
    .from('oneplanetbooks_books')
    .update({
      decision: null,
      evaluated_at: null,
      score: null,
    })
    .not('decision', 'is', null);

  if (error) {
    log(`Error resetting: ${error.message}`, 'error');
    return;
  }

  log('All books reset to pending', 'success');
}

async function showStats() {
  const dbStats = await getStats();

  console.log('\n┌─────────────────────────────────────┐');
  console.log('│       EBAY BOOKS DATABASE           │');
  console.log('├─────────────────────────────────────┤');
  console.log(`│  Total:    ${String(dbStats.total).padStart(6)}                │`);
  console.log(`│  Pending:  ${String(dbStats.pending).padStart(6)}                │`);
  console.log(`│  BUY:      ${String(dbStats.buy).padStart(6)}                │`);
  console.log(`│  REVIEW:   ${String(dbStats.review).padStart(6)}                │`);
  console.log(`│  REJECT:   ${String(dbStats.reject).padStart(6)}                │`);
  console.log('└─────────────────────────────────────┘\n');
}

// ==================== MAIN ====================
async function main() {
  const args = process.argv.slice(2);
  const fetchOnly = args.includes('--fetch');
  const evaluateOnly = args.includes('--evaluate');
  const statsOnly = args.includes('--stats');
  const resetOnly = args.includes('--reset');

  // Get --start-from value
  let startFrom = null;
  const startFromIdx = args.findIndex(a => a === '--start-from');
  if (startFromIdx >= 0 && args[startFromIdx + 1]) {
    startFrom = args[startFromIdx + 1];
  }

  stats.startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║   SCANFLOW EBAY BOOK SCANNER          ║');
  console.log('╚═══════════════════════════════════════╝\n');

  initSupabase();

  if (statsOnly) {
    await showStats();
    return;
  }

  if (resetOnly) {
    await resetAllDecisions();
    await showStats();
    return;
  }

  if (!fetchOnly && !evaluateOnly) {
    // Default: fetch then evaluate
    await fetchBooks(startFrom);
    await evaluateBooks();
  } else if (fetchOnly) {
    await fetchBooks(startFrom);
  } else if (evaluateOnly) {
    await evaluateBooks();
  }

  await showStats();

  const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
  log(`\nCompleted in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, 'success');
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'error');
  process.exit(1);
});
