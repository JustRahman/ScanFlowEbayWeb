/**
 * Keepa API Service (Server-side)
 * Fetches Amazon product data including prices, sales rank, and offers.
 */

const KEEPA_API_BASE = 'https://api.keepa.com';
const KEEPA_API_KEY = process.env.KEEPA_API_KEY || '';

// Amazon domain IDs
const AMAZON_DOMAINS = { US: 1, UK: 2, DE: 3, FR: 4, CA: 6 };

// Keepa price type indices
const PRICE_TYPES = {
  AMAZON: 0,
  NEW: 1,
  USED: 2,
  SALES_RANK: 3,
  NEW_FBA: 7,
  COUNT_NEW: 11,
  COUNT_USED: 12,
  RATING: 16,
  COUNT_REVIEWS: 17,
  BUY_BOX_USED: 23,
  COUNT_NEW_FBA: 28,
};

// ISBN conversion utilities
export function isbn10to13(isbn10: string): string | null {
  const clean = isbn10.replace(/[-\s]/g, '');
  if (clean.length !== 10) return null;
  const base = '978' + clean.substring(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return base + checkDigit;
}

export function isbn13to10(isbn13: string): string | null {
  const clean = isbn13.replace(/[-\s]/g, '');
  if (clean.length !== 13 || !clean.startsWith('978')) return null;
  const base = clean.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(base[i], 10) * (10 - i);
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? '0' : remainder === 1 ? 'X' : (11 - remainder).toString();
  return base + checkDigit;
}

export interface KeepaProduct {
  asin: string;
  title: string;
  salesRank: number | null;
  amazonPrice: number | null;
  newPrice: number | null;
  usedPrice: number | null;
  newFbaPrice: number | null;
  buyBoxPrice: number | null;
  newOfferCount: number;
  usedOfferCount: number;
  fbaOfferCount: number;
  rating: number | null;
  reviewCount: number;
  salesRank30DayAvg: number | null;
  salesRank90DayAvg: number | null;
  salesRankDrops30: number | null;
  salesRankDrops90: number | null;
  daysWithSales30: number;
  daysWithSales90: number;
  avgPrice90: number | null;
  outOfStockPercentage90: number | null;
  imageUrl: string | null;
  category: string | null;
  isAmazon: boolean;
  lastUpdate: number;
}

interface KeepaStats {
  current?: number[];
  avg30?: number[];
  avg90?: number[];
  salesRankDrops90?: number;
  salesRankDrops30?: number;
  buyBoxPrice?: number;
  offerCountNew?: number;
  offerCountUsed?: number;
  offerCountFBA?: number;
  outOfStockPercentage90?: number;
}

interface KeepaProductRaw {
  asin: string;
  title?: string;
  csv?: (number[] | null)[];
  stats?: KeepaStats;
  imagesCSV?: string;
  categoryTree?: Array<{ catId: number; name: string }>;
  lastUpdate?: number;
}

interface KeepaApiResponse {
  tokensLeft: number;
  tokensConsumed: number;
  products?: KeepaProductRaw[];
  error?: { message: string };
}

function getLatestValue(csv: number[] | null | undefined): number | null {
  if (!csv || csv.length < 2) return null;
  const value = csv[csv.length - 1];
  return value < 0 ? null : value;
}

function keepaPriceToCents(price: number | undefined | null): number | null {
  if (price === undefined || price === null || price < 0) return null;
  return price;
}

function calculateDaysWithSales(rankCsv: number[] | null | undefined, days: number): number {
  if (!rankCsv || rankCsv.length < 4) return 0;
  const now = Date.now();
  const cutoffTime = now - (days * 24 * 60 * 60 * 1000);
  const daysWithDrops = new Set<string>();
  let prevRank: number | null = null;

  for (let i = 0; i < rankCsv.length - 1; i += 2) {
    const keepaTime = rankCsv[i];
    const rank = rankCsv[i + 1];
    const timestamp = (keepaTime + 21564000) * 60000;

    if (timestamp < cutoffTime) {
      prevRank = rank > 0 ? rank : null;
      continue;
    }
    if (rank < 0) continue;

    if (prevRank !== null && rank < prevRank) {
      const date = new Date(timestamp);
      daysWithDrops.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
    }
    prevRank = rank;
  }
  return daysWithDrops.size;
}

function parseKeepaProduct(raw: KeepaProductRaw): KeepaProduct {
  const csv = raw.csv || [];
  const stats = raw.stats;
  const currentStats = stats?.current || [];

  const salesRank = getLatestValue(csv[PRICE_TYPES.SALES_RANK]);
  const salesRank30DayAvg = stats?.avg30?.[PRICE_TYPES.SALES_RANK] ?? null;
  const salesRank90DayAvg = stats?.avg90?.[PRICE_TYPES.SALES_RANK] ?? null;

  const amazonPrice = keepaPriceToCents(currentStats[PRICE_TYPES.AMAZON] ?? getLatestValue(csv[PRICE_TYPES.AMAZON]));
  const newPrice = keepaPriceToCents(currentStats[PRICE_TYPES.NEW] ?? getLatestValue(csv[PRICE_TYPES.NEW]));
  const usedPrice = keepaPriceToCents(currentStats[PRICE_TYPES.USED] ?? getLatestValue(csv[PRICE_TYPES.USED]));
  const newFbaPrice = keepaPriceToCents(currentStats[PRICE_TYPES.NEW_FBA] ?? getLatestValue(csv[PRICE_TYPES.NEW_FBA]));

  const rawBuyBoxPrice = stats?.buyBoxPrice;
  const buyBoxPrice = rawBuyBoxPrice != null && rawBuyBoxPrice > 0 ? rawBuyBoxPrice : null;

  const newOfferCount = stats?.offerCountNew ?? currentStats[PRICE_TYPES.COUNT_NEW] ?? 0;
  const usedOfferCount = stats?.offerCountUsed ?? currentStats[PRICE_TYPES.COUNT_USED] ?? 0;
  const fbaOfferCount = stats?.offerCountFBA ?? currentStats[PRICE_TYPES.COUNT_NEW_FBA] ?? 0;

  const rating = currentStats[PRICE_TYPES.RATING] ?? getLatestValue(csv[PRICE_TYPES.RATING]);
  const reviewCount = currentStats[PRICE_TYPES.COUNT_REVIEWS] ?? getLatestValue(csv[PRICE_TYPES.COUNT_REVIEWS]) ?? 0;

  let imageUrl: string | null = null;
  if (raw.imagesCSV) {
    const images = raw.imagesCSV.split(',');
    if (images.length > 0) {
      imageUrl = `https://images-na.ssl-images-amazon.com/images/I/${images[0]}`;
    }
  }

  let category: string | null = null;
  if (raw.categoryTree && raw.categoryTree.length > 0) {
    category = raw.categoryTree[raw.categoryTree.length - 1].name;
  }

  const salesRankDrops90 = stats?.salesRankDrops90 ?? null;
  // Use actual 30-day value from Keepa if available, otherwise estimate from 90-day
  const salesRankDrops30 = stats?.salesRankDrops30 ?? (salesRankDrops90 !== null ? Math.round(salesRankDrops90 / 3) : null);

  const rankCsv = csv[PRICE_TYPES.SALES_RANK];
  const daysWithSales30 = calculateDaysWithSales(rankCsv, 30);
  const daysWithSales90 = calculateDaysWithSales(rankCsv, 90);

  const avgPrice90 = keepaPriceToCents(stats?.avg90?.[PRICE_TYPES.NEW]);

  // outOfStockPercentage90 should be a number 0-100, validate it
  const rawOos = stats?.outOfStockPercentage90;
  const outOfStockPercentage90 = typeof rawOos === 'number' && rawOos >= 0 && rawOos <= 100 ? rawOos : null;

  return {
    asin: raw.asin,
    title: raw.title || '',
    salesRank,
    amazonPrice,
    newPrice,
    usedPrice,
    newFbaPrice,
    buyBoxPrice,
    newOfferCount: Math.max(0, newOfferCount),
    usedOfferCount: Math.max(0, usedOfferCount),
    fbaOfferCount: Math.max(0, fbaOfferCount),
    rating: rating !== null && rating >= 0 ? rating : null,
    reviewCount: Math.max(0, reviewCount),
    salesRank30DayAvg,
    salesRank90DayAvg,
    salesRankDrops30,
    salesRankDrops90,
    daysWithSales30,
    daysWithSales90,
    avgPrice90,
    outOfStockPercentage90,
    imageUrl,
    category,
    isAmazon: amazonPrice !== null && amazonPrice > 0,
    lastUpdate: raw.lastUpdate || 0,
  };
}

/**
 * Validate ISBN format (10 or 13 digits)
 */
export function validateIsbn(isbn: string): { valid: boolean; error?: string } {
  const clean = isbn.replace(/[-\s]/g, '');

  if (!clean) {
    return { valid: false, error: 'ISBN is empty' };
  }

  if (!/^\d+X?$/i.test(clean)) {
    return { valid: false, error: 'ISBN must contain only digits (and X for ISBN-10)' };
  }

  if (clean.length === 10) {
    // ISBN-10 validation
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(clean[i], 10) * (10 - i);
    }
    const lastChar = clean[9].toUpperCase();
    sum += lastChar === 'X' ? 10 : parseInt(lastChar, 10);
    if (sum % 11 !== 0) {
      return { valid: false, error: 'Invalid ISBN-10 checksum' };
    }
    return { valid: true };
  }

  if (clean.length === 13) {
    // ISBN-13 validation
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(clean[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    if (checkDigit !== parseInt(clean[12], 10)) {
      return { valid: false, error: 'Invalid ISBN-13 checksum' };
    }
    return { valid: true };
  }

  return { valid: false, error: `ISBN must be 10 or 13 digits (got ${clean.length})` };
}

export async function getProductByIsbn(isbn: string): Promise<KeepaProduct | null> {
  if (!KEEPA_API_KEY) {
    console.error('Keepa API key not configured');
    return null;
  }

  const cleanIsbn = isbn.replace(/[-\s]/g, '');

  // Validate ISBN format
  const validation = validateIsbn(cleanIsbn);
  if (!validation.valid) {
    console.error('Invalid ISBN:', validation.error);
    return null;
  }
  const url = `${KEEPA_API_BASE}/product?key=${KEEPA_API_KEY}&domain=1&code=${cleanIsbn}&stats=180&offers=20`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Keepa API error:', response.status);
      return null;
    }

    const data: KeepaApiResponse = await response.json();
    if (data.error) {
      console.error('Keepa API error:', data.error.message);
      return null;
    }

    console.log(`Keepa tokens left: ${data.tokensLeft}, consumed: ${data.tokensConsumed}`);

    if (!data.products || data.products.length === 0) {
      return null;
    }

    return parseKeepaProduct(data.products[0]);
  } catch (error) {
    console.error('Keepa API fetch error:', error);
    return null;
  }
}

// Fee calculation for profit estimation
export function calculateFees(ebayPriceCents: number, amazonPriceCents: number): {
  fbaProfit: number;
  fbmProfit: number;
  fbaRoi: number;
  fbmRoi: number;
  referralFee: number;
  fulfillmentFee: number;
} {
  const referralFee = Math.round(amazonPriceCents * 0.15);
  const fulfillmentFee = 354; // ~$3.54 average for books
  const inboundShipping = 50; // ~$0.50 per book
  const closingFee = 180; // $1.80 media closing fee
  const fbmShipping = 399; // $3.99 media mail

  const ebayFee = Math.round(ebayPriceCents * 0.13);
  const totalEbayCost = ebayPriceCents + ebayFee;

  const fbaProfit = amazonPriceCents - referralFee - fulfillmentFee - inboundShipping - totalEbayCost;
  const fbmProfit = amazonPriceCents - referralFee - closingFee - fbmShipping - totalEbayCost;

  const fbaRoi = totalEbayCost > 0 ? Math.round((fbaProfit / totalEbayCost) * 100) : 0;
  const fbmRoi = totalEbayCost > 0 ? Math.round((fbmProfit / totalEbayCost) * 100) : 0;

  return { fbaProfit, fbmProfit, fbaRoi, fbmRoi, referralFee, fulfillmentFee };
}

// Decision logic
export function makeDecision(
  profit: number,
  roi: number,
  salesRank: number | null,
  salesDrops30: number | null,
  fbaCount: number,
  isAmazon: boolean
): { decision: 'BUY' | 'REVIEW' | 'REJECT'; reason: string; score: number } {
  // Knockout filters
  if (profit < 300) return { decision: 'REJECT', reason: 'Profit below $3', score: 0 };
  if (roi < 30) return { decision: 'REJECT', reason: 'ROI below 30%', score: 0 };
  if (salesRank && salesRank > 3000000) return { decision: 'REJECT', reason: 'Rank too high (>3M)', score: 0 };
  if (salesDrops30 !== null && salesDrops30 < 2) return { decision: 'REJECT', reason: 'No sales velocity', score: 0 };
  if (isAmazon) return { decision: 'REJECT', reason: 'Amazon is selling', score: 0 };

  // Calculate score
  let score = 50;

  // Profit bonus
  if (profit >= 1000) score += 20;
  else if (profit >= 500) score += 10;

  // ROI bonus
  if (roi >= 100) score += 15;
  else if (roi >= 50) score += 10;

  // Rank bonus
  if (salesRank) {
    if (salesRank < 100000) score += 15;
    else if (salesRank < 500000) score += 10;
    else if (salesRank < 1000000) score += 5;
  }

  // Velocity bonus
  if (salesDrops30 && salesDrops30 >= 10) score += 10;
  else if (salesDrops30 && salesDrops30 >= 5) score += 5;

  // Competition penalty
  if (fbaCount > 10) score -= 10;
  else if (fbaCount > 5) score -= 5;

  score = Math.min(100, Math.max(0, score));

  if (score >= 70) return { decision: 'BUY', reason: 'Strong opportunity', score };
  if (score >= 50) return { decision: 'REVIEW', reason: 'Needs review', score };
  return { decision: 'REJECT', reason: 'Below threshold', score };
}
