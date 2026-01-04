import { NextResponse } from 'next/server';
import { searchEbayBooks, getEbayItem, extractISBN, convertToDeal, FEATURED_SELLERS } from '@/services/ebayApi';
import { getProductByIsbn, calculateFees, makeDecision } from '@/services/keepaApi';

interface FeaturedDeal {
  ebayItemId: string;
  ebayTitle: string;
  ebayPrice: number;
  ebayUrl: string;
  ebayCondition: string;
  ebaySeller: string;
  ebaySellerRating: number | null;
  ebayImage: string | null;
  ebayShipping: number;
  isbn: string | null;
  // Amazon data
  asin?: string;
  buyBoxPrice?: number;
  salesRank?: number | null;
  salesRankDrops30?: number | null;
  fbaProfit?: number;
  fbmProfit?: number;
  fbaRoi?: number;
  decision?: 'BUY' | 'REVIEW' | 'REJECT';
  score?: number;
}

export async function GET() {
  try {
    // Search eBay with featured filters
    // Use a generic query to get a variety of books
    const searchQueries = ['textbook', 'novel', 'guide'];
    const randomQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];

    const results = await searchEbayBooks(randomQuery, {
      limit: 200,
      maxPrice: 15,
      conditions: ['LIKE_NEW'],
      sellers: FEATURED_SELLERS,
      maxListingAgeDays: 20,
    });

    if (!results.itemSummaries || results.itemSummaries.length === 0) {
      return NextResponse.json({ deals: [], message: 'No books found' });
    }

    // Convert to deals and try to get ISBNs
    const dealsWithIsbn: FeaturedDeal[] = [];

    // Process up to 20 items to find books with ISBNs
    for (const item of results.itemSummaries.slice(0, 20)) {
      let isbn = extractISBN(item);

      // If no ISBN in search result, try fetching full details
      if (!isbn) {
        try {
          const fullItem = await getEbayItem(item.itemId);
          if (fullItem) {
            isbn = extractISBN(fullItem);
          }
        } catch (e) {
          // Skip if we can't fetch details
        }
      }

      if (isbn) {
        const deal = convertToDeal({ ...item, isbn: isbn ? [isbn] : undefined });
        dealsWithIsbn.push({ ...deal, isbn });

        // Stop once we have enough candidates
        if (dealsWithIsbn.length >= 10) break;
      }
    }

    if (dealsWithIsbn.length === 0) {
      // Fallback: return first 3 without ISBN
      const fallbackDeals = results.itemSummaries.slice(0, 3).map(item => convertToDeal(item));
      return NextResponse.json({ deals: fallbackDeals, message: 'No books with ISBN found' });
    }

    // Get Amazon data for books with ISBNs and score them
    const scoredDeals: FeaturedDeal[] = [];

    for (const deal of dealsWithIsbn.slice(0, 6)) {
      if (!deal.isbn) continue;

      try {
        const product = await getProductByIsbn(deal.isbn);

        if (product && product.buyBoxPrice) {
          const fees = calculateFees(deal.ebayPrice, product.buyBoxPrice);
          const decision = makeDecision(
            Math.max(fees.fbaProfit, fees.fbmProfit),
            Math.max(fees.fbaRoi, fees.fbmRoi),
            product.salesRank,
            product.salesRankDrops30,
            product.fbaOfferCount,
            product.isAmazon
          );

          scoredDeals.push({
            ...deal,
            asin: product.asin,
            buyBoxPrice: product.buyBoxPrice,
            salesRank: product.salesRank,
            salesRankDrops30: product.salesRankDrops30,
            fbaProfit: fees.fbaProfit,
            fbmProfit: fees.fbmProfit,
            fbaRoi: fees.fbaRoi,
            decision: decision.decision,
            score: decision.score,
          });
        }
      } catch (e) {
        console.error('Error fetching Amazon data:', e);
      }

      // Stop if we have enough scored deals
      if (scoredDeals.length >= 3) break;
    }

    // Sort by score (highest first) and return top 3
    scoredDeals.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topDeals = scoredDeals.slice(0, 3);

    // If we don't have 3 scored deals, fill with unscored ones
    if (topDeals.length < 3) {
      const remaining = dealsWithIsbn
        .filter(d => !topDeals.find(td => td.ebayItemId === d.ebayItemId))
        .slice(0, 3 - topDeals.length);
      topDeals.push(...remaining);
    }

    return NextResponse.json({
      deals: topDeals,
      total: results.total,
    });
  } catch (error) {
    console.error('Featured books error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch featured books', deals: [] },
      { status: 500 }
    );
  }
}
