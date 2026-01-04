/**
 * eBay Browse API Service (Server-side)
 *
 * Uses OAuth 2.0 Client Credentials flow to access public listing data.
 * Runs on Next.js server to avoid CORS and keep secrets secure.
 */

const EBAY_API_BASE = 'https://api.ebay.com';
const EBAY_OAUTH_URL = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
const EBAY_BROWSE_URL = `${EBAY_API_BASE}/buy/browse/v1`;

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

// Token cache
let cachedToken: OAuthToken | null = null;
let tokenExpiresAt: number = 0;

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

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
        if (attempt === RATE_LIMIT_CONFIG.maxRetries) {
          throw new Error(`${context}: Rate limit exceeded after ${RATE_LIMIT_CONFIG.maxRetries} retries`);
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
        console.warn(`${context}: Rate limited (429). Waiting ${waitTime}ms...`);

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
 */
async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('eBay API credentials not configured');
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
    return cachedToken.access_token;
  }

  console.log('Fetching new eBay OAuth token...');
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

  const token: OAuthToken = await response.json();
  cachedToken = token;
  tokenExpiresAt = Date.now() + (token.expires_in * 1000);

  return token.access_token;
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
        'Content-Type': 'application/json',
      },
    },
    'eBay Search'
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`eBay search failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get item details by item ID
 */
export async function getEbayItem(itemId: string): Promise<EbayItemSummary | null> {
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

  return response.json();
}

// Book wholesale sellers
export const ALL_BOOK_SELLERS = [
  { id: 'betterworldbooks', name: 'Better World Books' },
  { id: 'booksrun', name: 'BooksRun' },
  { id: 'hpb-red', name: 'Half Price Books' },
  { id: 'thrift.books', name: 'ThriftBooks' },
  { id: 'thriftbooksstore', name: 'ThriftBooks Store' },
  { id: 'oneplanetbooks', name: 'One Planet Books' },
  { id: 'wonderbooks', name: 'Wonder Book' },
  { id: 'bookoutlet2', name: 'Book Outlet' },
  { id: 'alibrisbooks', name: 'Alibris' },
];

// Featured sellers for auto-search
export const FEATURED_SELLERS = ['betterworldbooks', 'booksrun', 'oneplanetbooks', 'thriftbooksstore'];

export const DEFAULT_SELLERS = ['betterworldbooks', 'booksrun'];

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

/**
 * Search for books (category 267)
 */
export async function searchEbayBooks(query: string, options?: {
  limit?: number;
  minPrice?: number;
  maxPrice?: number;
  conditions?: BookCondition[];
  sellers?: string[];
  maxListingAgeDays?: number;
}): Promise<EbaySearchResponse> {
  const filters: string[] = [];

  if (options?.minPrice && options?.maxPrice && options.maxPrice < 100000) {
    filters.push(`price:[${options.minPrice}..${options.maxPrice}]`);
  } else if (options?.minPrice) {
    filters.push(`price:[${options.minPrice}..]`);
  } else if (options?.maxPrice && options.maxPrice < 100000) {
    filters.push(`price:[..${options.maxPrice}]`);
  }

  if (options?.conditions && options.conditions.length > 0) {
    const conditionIds = options.conditions.map(c => BOOK_CONDITIONS[c]).join('|');
    filters.push(`conditionIds:{${conditionIds}}`);
  }

  if (options?.sellers && options.sellers.length > 0) {
    filters.push(`sellers:{${options.sellers.join('|')}}`);
  }

  if (options?.maxListingAgeDays && options.maxListingAgeDays > 0) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - options.maxListingAgeDays);
    filters.push(`itemCreationDate:[${minDate.toISOString()}]`);
  }

  filters.push('buyingOptions:{FIXED_PRICE}');

  return searchEbayListings({
    query,
    category_ids: '267',
    limit: options?.limit || 200,
    filter: filters.length > 0 ? filters.join(',') : undefined,
    sort: 'newlyListed',
  });
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
