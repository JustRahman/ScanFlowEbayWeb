/**
 * eBay Browse API Service (Server-side)
 *
 * Uses OAuth 2.0 Client Credentials flow to access public listing data.
 * Runs on Next.js server to avoid CORS and keep secrets secure.
 */

const EBAY_API_BASE = 'https://api.ebay.com';
const EBAY_OAUTH_URL = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
const EBAY_BROWSE_URL = `${EBAY_API_BASE}/buy/browse/v1`;

// Logging helper
function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] [eBay] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [eBay] ${message}`);
  }
}

// Client credentials from environment (server-side only)
const CLIENT_ID = process.env.EBAY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';

// OAuth scopes for Browse API
const OAUTH_SCOPES = 'https://api.ebay.com/oauth/api_scope';

interface OAuthToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface EbaySearchParams {
  query: string;
  category_ids?: string;
  limit?: number;
  offset?: number;
  filter?: string;
  sort?: string;
}

export interface EbayItemSummary {
  itemId: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  image?: {
    imageUrl: string;
  };
  condition?: string;
  conditionId?: string;
  itemLocation?: {
    country: string;
    postalCode?: string;
  };
  seller?: {
    username: string;
    feedbackPercentage?: string;
    feedbackScore?: number;
  };
  itemWebUrl: string;
  itemAffiliateWebUrl?: string;
  shippingOptions?: Array<{
    shippingCost?: {
      value: string;
      currency: string;
    };
    shippingCostType?: string;
  }>;
  categories?: Array<{
    categoryId: string;
    categoryName: string;
  }>;
  buyingOptions?: string[];
  localizedAspects?: Array<{
    type: string;
    name: string;
    value: string;
  }>;
  isbn?: string[];
  epid?: string;
  gtin?: string;
  mpn?: string;
  legacyItemId?: string;
  itemCreationDate?: string;
}

export interface EbaySearchResponse {
  total: number;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
}

// Token cache with lock to prevent race conditions
let cachedToken: OAuthToken | null = null;
let tokenExpiresAt: number = 0;
let tokenFetchPromise: Promise<string> | null = null; // Lock for concurrent requests

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 2, // eBay requires max 2 retries for 5xx errors
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// 24-hour item cache to prevent re-scanning same items
const itemCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedItem<T>(key: string): T | null {
  const cached = itemCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as T;
  }
  if (cached) {
    itemCache.delete(key); // Clean up expired entry
  }
  return null;
}

function setCachedItem(key: string, data: unknown): void {
  itemCache.set(key, { data, timestamp: Date.now() });
}

// Clean up expired cache entries periodically
function cleanupCache(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  itemCache.forEach((value, key) => {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => itemCache.delete(key));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper with retry logic for rate limiting (HTTP 429)
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context: string = 'eBay API'
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = RATE_LIMIT_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        log(`RATE LIMITED (429) - attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries + 1}`);

        if (attempt === RATE_LIMIT_CONFIG.maxRetries) {
          log('RATE LIMIT EXCEEDED - stopping');
          throw new Error(`Rate limit exceeded`);
        }

        const retryAfter = response.headers.get('Retry-After');
        let waitTime = delay;

        if (retryAfter) {
          const retrySeconds = parseInt(retryAfter, 10);
          if (!isNaN(retrySeconds)) {
            waitTime = retrySeconds * 1000;
          }
        }

        waitTime = Math.min(waitTime, RATE_LIMIT_CONFIG.maxDelayMs);
        log(`Waiting ${waitTime}ms before retry...`);

        await sleep(waitTime);
        delay = Math.min(delay * RATE_LIMIT_CONFIG.backoffMultiplier, RATE_LIMIT_CONFIG.maxDelayMs);
        continue;
      }

      if (response.status >= 500 && response.status < 600) {
        if (attempt === RATE_LIMIT_CONFIG.maxRetries) {
          throw new Error(`${context}: Server error ${response.status} after retries`);
        }

        console.warn(`${context}: Server error (${response.status}). Retrying...`);
        await sleep(delay);
        delay = Math.min(delay * RATE_LIMIT_CONFIG.backoffMultiplier, RATE_LIMIT_CONFIG.maxDelayMs);
        continue;
      }

      return response;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
        console.warn(`${context}: Network error. Retrying...`);
        await sleep(delay);
        delay = Math.min(delay * RATE_LIMIT_CONFIG.backoffMultiplier, RATE_LIMIT_CONFIG.maxDelayMs);
        continue;
      }
    }
  }

  throw lastError || new Error(`${context}: Request failed after retries`);
}

/**
 * Get OAuth access token using Client Credentials flow
 * Uses a lock to prevent race conditions with concurrent requests
 */
async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('eBay API credentials not configured');
  }

  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
    return cachedToken.access_token;
  }

  // If another request is already fetching a token, wait for it
  if (tokenFetchPromise) {
    console.log('Waiting for existing token fetch...');
    return tokenFetchPromise;
  }

  // Create a new token fetch promise (acts as a lock)
  tokenFetchPromise = (async () => {
    try {
      // Double-check cache after acquiring lock (another request may have completed)
      if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
        return cachedToken.access_token;
      }

      log('Fetching new OAuth token...');
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
          cache: 'no-store', // CRITICAL: Disable Next.js fetch caching
        } as RequestInit,
        'eBay OAuth'
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('eBay OAuth error:', error);
        throw new Error(`eBay OAuth failed: ${response.status} - ${error}`);
      }

      const token: OAuthToken = await response.json();
      log(`OAuth token obtained, expires in ${token.expires_in}s`);
      cachedToken = token;
      tokenExpiresAt = Date.now() + (token.expires_in * 1000);

      return token.access_token;
    } finally {
      // Release the lock
      tokenFetchPromise = null;
    }
  })();

  return tokenFetchPromise;
}

/**
 * Search eBay listings using Browse API
 */
export async function searchEbayListings(params: EbaySearchParams): Promise<EbaySearchResponse> {
  const accessToken = await getAccessToken();

  const queryParams = new URLSearchParams({
    q: params.query,
    limit: String(params.limit || 200),
    offset: String(params.offset || 0),
    fieldgroups: 'EXTENDED',
  });

  if (params.category_ids) queryParams.append('category_ids', params.category_ids);
  if (params.filter) queryParams.append('filter', params.filter);
  if (params.sort) queryParams.append('sort', params.sort);

  const url = `${EBAY_BROWSE_URL}/item_summary/search?${queryParams.toString()}`;

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      cache: 'no-store', // CRITICAL: Disable Next.js fetch caching
    } as RequestInit,
    'eBay Search'
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('eBay search error response:', error);
    throw new Error(`eBay search failed: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Get item details by item ID (with 24-hour cache)
 */
export async function getEbayItem(itemId: string): Promise<EbayItemSummary | null> {
  // Check cache first
  const cacheKey = `item:${itemId}`;
  const cached = getCachedItem<EbayItemSummary>(cacheKey);
  if (cached) {
    log(`ITEM CACHE HIT: ${itemId}`);
    return cached;
  }

  log(`ITEM FETCH: ${itemId}`);
  const accessToken = await getAccessToken();
  const url = `${EBAY_BROWSE_URL}/item/${itemId}`;

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    },
    'eBay Get Item'
  );

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`eBay get item failed: ${response.status}`);
  }

  const item = await response.json();

  // Cache the result
  setCachedItem(cacheKey, item);

  const isbn = extractISBN(item);
  log(`ITEM FETCHED: ${itemId}`, {
    title: item.title?.substring(0, 50),
    isbn: isbn || 'NOT FOUND',
    price: item.price?.value,
  });

  return item;
}

// Book wholesale sellers
export const ALL_BOOK_SELLERS = [
  { id: 'oneplanetbooks', name: 'One Planet Books' },
];

// Featured sellers for auto-search
export const FEATURED_SELLERS = ['oneplanetbooks'];

export const DEFAULT_SELLERS = ['oneplanetbooks'];

export const BOOK_CONDITIONS: Record<string, string> = {
  'NEW': '1000',
  'LIKE_NEW': '2750',
  'VERY_GOOD': '4000',
  'GOOD': '5000',
  'ACCEPTABLE': '6000',
};

export const ALL_CONDITIONS = [
  { id: 'NEW', name: 'New' },
  { id: 'LIKE_NEW', name: 'Like New' },
  { id: 'VERY_GOOD', name: 'Very Good' },
  { id: 'GOOD', name: 'Good' },
  { id: 'ACCEPTABLE', name: 'Acceptable' },
];

export const DEFAULT_CONDITIONS = ['LIKE_NEW'];

export type BookCondition = 'NEW' | 'LIKE_NEW' | 'VERY_GOOD' | 'GOOD' | 'ACCEPTABLE';

// Book subcategories (under main Books category 267)
export const BOOK_CATEGORIES = [
  { id: '2228', name: 'Textbooks & Education', limit: 2000 },
  { id: '182964', name: 'Engineering', limit: 1000 },
  { id: '11769', name: 'Medicine & Health', limit: 1000 },
  { id: '465', name: 'Science & Mathematics', limit: 1000 },
];

export const DEFAULT_CATEGORY = '2228'; // Textbooks, Education

// Search all configured categories and combine results with pagination
export async function searchAllCategories(query: string, options?: {
  minPrice?: number;
  maxPrice?: number;
  conditions?: BookCondition[];
  sellers?: string[];
}): Promise<{ items: EbayItemSummary[]; total: number; categoryBreakdown: Record<string, number> }> {
  const allItems: EbayItemSummary[] = [];
  let totalCount = 0;
  const categoryBreakdown: Record<string, number> = {};
  const PAGE_SIZE = 200; // eBay API max per request

  // Search each category with pagination to reach configured limit
  for (const category of BOOK_CATEGORIES) {
    const categoryItems: EbayItemSummary[] = [];
    let offset = 0;

    try {
      console.log(`Searching ${category.name} (target: ${category.limit})...`);

      // Fetch pages until we reach the limit or run out of results
      while (categoryItems.length < category.limit) {
        const results = await searchEbayBooks(query, {
          ...options,
          categoryId: category.id,
          limit: PAGE_SIZE,
          offset: offset,
        });

        if (!results.itemSummaries || results.itemSummaries.length === 0) {
          break; // No more results
        }

        categoryItems.push(...results.itemSummaries);
        totalCount += results.total || 0;

        // Check if we've fetched all available or reached our limit
        if (results.itemSummaries.length < PAGE_SIZE || categoryItems.length >= category.limit) {
          break;
        }

        offset += PAGE_SIZE;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Trim to exact limit
      const trimmedItems = categoryItems.slice(0, category.limit);
      allItems.push(...trimmedItems);
      categoryBreakdown[category.name] = trimmedItems.length;

      console.log(`${category.name}: fetched ${trimmedItems.length} items`);
    } catch (error) {
      console.error(`Error searching ${category.name}:`, error);
      categoryBreakdown[category.name] = categoryItems.length;
    }
  }

  return { items: allItems, total: totalCount, categoryBreakdown };
}

/**
 * Search for books (category 267)
 * Filter order matches script: sellers, price, priceCurrency, conditionIds, buyingOptions, itemCreationDate
 */
export async function searchEbayBooks(query: string, options?: {
  limit?: number;
  offset?: number;
  minPrice?: number;
  maxPrice?: number;
  conditions?: BookCondition[];
  sellers?: string[];
  maxListingAgeDays?: number;
  categoryId?: string;
}): Promise<EbaySearchResponse> {
  log(`SEARCH START`, {
    query,
    sellers: options?.sellers,
    conditions: options?.conditions,
    priceRange: `$${options?.minPrice || 0}-$${options?.maxPrice || 'unlimited'}`,
    category: options?.categoryId || DEFAULT_CATEGORY,
    limit: options?.limit || 200,
  });

  const filters: string[] = [];

  // 1. Sellers filter (first, as per script)
  if (options?.sellers && options.sellers.length > 0) {
    filters.push(`sellers:{${options.sellers.join('|')}}`);
  }

  // 2. Price filter
  if (options?.minPrice && options?.maxPrice && options.maxPrice < 100000) {
    filters.push(`price:[${options.minPrice}..${options.maxPrice}]`);
  } else if (options?.minPrice) {
    filters.push(`price:[${options.minPrice}..]`);
  } else if (options?.maxPrice && options.maxPrice < 100000) {
    filters.push(`price:[..${options.maxPrice}]`);
  }

  // 3. Price currency (required for consistency)
  filters.push('priceCurrency:USD');

  // 4. Condition filter
  if (options?.conditions && options.conditions.length > 0) {
    const conditionIds = options.conditions.map(c => BOOK_CONDITIONS[c]).join('|');
    filters.push(`conditionIds:{${conditionIds}}`);
  }

  // 5. Fixed price only
  filters.push('buyingOptions:{FIXED_PRICE}');

  // 6. Listing age filter (default: 30 days)
  const maxAgeDays = options?.maxListingAgeDays ?? 30;
  if (maxAgeDays > 0) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - maxAgeDays);
    filters.push(`itemCreationDate:[${minDate.toISOString()}]`);
  }

  log(`FILTER: ${filters.join(',')}`);

  const results = await searchEbayListings({
    query,
    category_ids: options?.categoryId || DEFAULT_CATEGORY,
    limit: options?.limit || 200,
    offset: options?.offset || 0,
    filter: filters.length > 0 ? filters.join(',') : undefined,
    sort: 'newlyListed',
  });

  log(`SEARCH RESULT`, {
    total: results.total,
    returned: results.itemSummaries?.length || 0,
  });

  return results;
}

/**
 * Extract ISBN from eBay item
 */
export function extractISBN(item: EbayItemSummary): string | null {
  if (item.isbn && item.isbn.length > 0) return item.isbn[0];

  if (item.gtin) {
    const cleanGtin = item.gtin.replace(/[-\s]/g, '');
    if (cleanGtin.length === 10 || cleanGtin.length === 13) return cleanGtin;
  }

  if (item.localizedAspects) {
    const isbnAspect = item.localizedAspects.find(a => a.name.toLowerCase().includes('isbn'));
    if (isbnAspect) return isbnAspect.value;
  }

  const isbnMatch = item.title.match(/\b(\d{10}|\d{13})\b/);
  if (isbnMatch) return isbnMatch[1];

  return null;
}

/**
 * Convert eBay item to deal format
 */
export function convertToDeal(item: EbayItemSummary) {
  const price = parseFloat(item.price.value) * 100;
  const shippingCost = item.shippingOptions?.[0]?.shippingCost
    ? parseFloat(item.shippingOptions[0].shippingCost.value) * 100
    : 0;

  return {
    ebayItemId: item.itemId,
    ebayTitle: item.title,
    ebayPrice: Math.round(price + shippingCost),
    ebayUrl: item.itemWebUrl,
    ebayCondition: item.condition || 'Unknown',
    ebaySeller: item.seller?.username || 'Unknown',
    ebaySellerRating: item.seller?.feedbackPercentage
      ? parseFloat(item.seller.feedbackPercentage)
      : null,
    ebayImage: item.image?.imageUrl || null,
    ebayShipping: Math.round(shippingCost),
    isbn: extractISBN(item),
  };
}
