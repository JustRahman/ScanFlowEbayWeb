import { MIN_PRICE, MAX_PRICE } from './config.js';

const EBAY_API_BASE = 'https://api.ebay.com';
const EBAY_OAUTH_URL = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
const EBAY_BROWSE_URL = `${EBAY_API_BASE}/buy/browse/v1`;
const OAUTH_SCOPES = 'https://api.ebay.com/oauth/api_scope';

const CLIENT_ID = process.env.EBAY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const EPN_CAMPAIGN_ID = process.env.EPN_CAMPAIGN_ID || '5339135996';

// OAuth token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context: string,
  onTokenExpired?: () => Promise<string>,
): Promise<Response> {
  const maxRetries = 4;
  let delay = 2000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // 401 Unauthorized — token expired, refresh and retry
      if (response.status === 401 && onTokenExpired && attempt < maxRetries) {
        console.log(`  ${context}: Token expired, refreshing...`);
        const newToken = await onTokenExpired();
        // Update the Authorization header with new token
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${newToken}`);
        options = { ...options, headers };
        continue;
      }

      // 429 Rate limit
      if (response.status === 429) {
        if (attempt === maxRetries) throw new Error(`${context}: Rate limit exceeded after ${maxRetries} retries`);
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
        console.log(`  ${context}: Rate limited (429), waiting ${Math.round(waitTime / 1000)}s...`);
        await sleep(waitTime);
        delay *= 2;
        continue;
      }

      // 5xx Server errors
      if (response.status >= 500) {
        if (attempt === maxRetries) throw new Error(`${context}: Server error ${response.status} after ${maxRetries} retries`);
        console.log(`  ${context}: Server error ${response.status}, retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      // 400-level errors (except 401/429) — don't retry, these are client errors
      if (response.status >= 400) {
        const body = await response.text();
        throw new Error(`${context}: HTTP ${response.status} — ${body.substring(0, 200)}`);
      }

      return response;
    } catch (error) {
      // Network errors (timeout, DNS, connection refused)
      if (error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'))) {
        if (attempt === maxRetries) throw new Error(`${context}: Network error after ${maxRetries} retries — ${error}`);
        console.log(`  ${context}: Network error, retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw error; // Re-throw non-network errors (like our own HTTP error throws)
    }
  }

  throw new Error(`${context}: Failed after ${maxRetries} retries`);
}

export async function getOAuthToken(): Promise<string> {
  // Return cached token if still valid (5 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 300_000) {
    return cachedToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('eBay API credentials not configured (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET)');
  }

  console.log('Fetching eBay OAuth token...');
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetchWithRetry(
    EBAY_OAUTH_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(OAUTH_SCOPES)}`,
    },
    'eBay OAuth'
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`eBay OAuth failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  console.log(`OAuth token obtained, expires in ${data.expires_in}s`);

  return cachedToken!;
}

export interface ScrapedBook {
  isbn: string;
  title: string;
  price: number;        // cents
  condition: string;
  seller: string;
  category: string;
  ebay_item_id: string;
  ebay_url: string;
  image_url: string | null;
  shipping: number;     // cents
  scraped_at: string;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  image?: { imageUrl: string };
  condition?: string;
  seller?: { username: string };
  itemWebUrl: string;
  itemAffiliateWebUrl?: string;
  shippingOptions?: Array<{
    shippingCost?: { value: string; currency: string };
  }>;
  localizedAspects?: Array<{
    type: string;
    name: string;
    value: string;
  }>;
  isbn?: string[];
  gtin?: string;
}

function extractISBN(item: EbayItemSummary): string | null {
  // Direct ISBN field
  if (item.isbn && item.isbn.length > 0) return item.isbn[0];

  // GTIN field
  if (item.gtin) {
    const clean = item.gtin.replace(/[-\s]/g, '');
    if (clean.length === 10 || clean.length === 13) return clean;
  }

  // localizedAspects — the primary extraction method
  if (item.localizedAspects) {
    const isbnAspect = item.localizedAspects.find(a => a.name === 'ISBN');
    if (isbnAspect) return isbnAspect.value;
  }

  return null;
}

export async function searchListings(
  seller: string,
  categoryId: string,
): Promise<ScrapedBook[]> {
  let token = await getOAuthToken();
  const books: ScrapedBook[] = [];
  const PAGE_SIZE = 200;
  let offset = 0;
  let consecutiveErrors = 0;

  // Price filter uses dollars for the API
  const minPriceDollars = (MIN_PRICE / 100).toFixed(2);
  const maxPriceDollars = (MAX_PRICE / 100).toFixed(2);

  const filters = [
    `sellers:{${seller}}`,
    `price:[${minPriceDollars}..${maxPriceDollars}]`,
    'priceCurrency:USD',
    'conditionIds:{4000}', // Very Good only
    'buyingOptions:{FIXED_PRICE}',
  ].join(',');

  // Fetch ALL pages until no more results
  while (true) {
    const params = new URLSearchParams({
      q: '',
      category_ids: categoryId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      filter: filters,
      sort: 'newlyListed',
      fieldgroups: 'EXTENDED',
    });

    const url = `${EBAY_BROWSE_URL}/item_summary/search?${params.toString()}`;

    let response: Response;
    try {
      response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'X-EBAY-C-ENDUSERCTX': `affiliateCampaignId=${EPN_CAMPAIGN_ID},affiliateReferenceId=scanflow`,
          },
        },
        `eBay Search (page ${offset / PAGE_SIZE + 1})`,
        async () => {
          // Token refresh callback — called on 401
          cachedToken = null;
          tokenExpiresAt = 0;
          token = await getOAuthToken();
          return token;
        },
      );
    } catch (error) {
      consecutiveErrors++;
      console.error(`  Page ${offset / PAGE_SIZE + 1} failed: ${error}`);
      if (consecutiveErrors >= 3) {
        console.error(`  Stopping: ${consecutiveErrors} consecutive page errors`);
        break;
      }
      // Skip this page and try next
      offset += PAGE_SIZE;
      await sleep(2000);
      continue;
    }
    consecutiveErrors = 0;

    const data = await response.json();
    const items: EbayItemSummary[] = data.itemSummaries || [];

    if (items.length === 0) break;

    const now = new Date().toISOString();

    for (const item of items) {
      const isbn = extractISBN(item);
      if (!isbn) continue;

      const priceCents = Math.round(parseFloat(item.price.value) * 100);
      const shippingCents = item.shippingOptions?.[0]?.shippingCost
        ? Math.round(parseFloat(item.shippingOptions[0].shippingCost.value) * 100)
        : 0;

      books.push({
        isbn,
        title: item.title,
        price: priceCents,
        condition: item.condition || 'Unknown',
        seller,
        category: categoryId,
        ebay_item_id: item.itemId,
        ebay_url: item.itemAffiliateWebUrl || item.itemWebUrl,
        image_url: item.image?.imageUrl || null,
        shipping: shippingCents,
        scraped_at: now,
      });
    }

    console.log(`    Page ${offset / PAGE_SIZE + 1}: ${items.length} items (${books.length} with ISBN so far)`);

    // Stop if we got fewer than a full page — no more results
    if (items.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
    await sleep(200);
  }

  return books;
}
