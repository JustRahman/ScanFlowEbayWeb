import { NextRequest, NextResponse } from 'next/server';
import { searchEbayBooks, convertToDeal, getEbayItem, extractISBN, type BookCondition } from '@/services/ebayApi';

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] [API/search] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [API/search] ${message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query,
      sellers,
      conditions,
      minPrice,
      maxPrice,
      categoryId,
      limit = 20,
      fetchDetails = false
    } = body;

    log('REQUEST', { query, sellers, conditions, minPrice, maxPrice, categoryId, limit, fetchDetails });

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const results = await searchEbayBooks(query, {
      limit,
      minPrice,
      maxPrice,
      conditions: conditions as BookCondition[],
      sellers,
      categoryId,
    });

    // Convert to deals and optionally fetch full details for ISBN
    let deals = (results.itemSummaries || []).map(item => convertToDeal(item));

    const initialIsbnCount = deals.filter(d => d.isbn).length;
    log(`Initial ISBN count: ${initialIsbnCount}/${deals.length}`);

    // If fetchDetails is true, get full item details for ISBN extraction
    if (fetchDetails) {
      log(`Fetching details for ${Math.min(deals.length, 10)} items...`);
      let detailsFetched = 0;

      const dealsWithDetails = await Promise.all(
        deals.slice(0, 10).map(async (deal) => {
          if (!deal.isbn) {
            try {
              detailsFetched++;
              const fullItem = await getEbayItem(deal.ebayItemId);
              if (fullItem) {
                const isbn = extractISBN(fullItem);
                return { ...deal, isbn };
              }
            } catch (e) {
              log(`Error fetching item ${deal.ebayItemId}: ${e}`);
            }
          }
          return deal;
        })
      );
      deals = [...dealsWithDetails, ...deals.slice(10)];

      const finalIsbnCount = deals.filter(d => d.isbn).length;
      log(`Details fetched: ${detailsFetched}, ISBNs found: ${finalIsbnCount}/${deals.length}`);
    }

    log('RESPONSE', {
      total: results.total,
      dealsReturned: deals.length,
      withIsbn: deals.filter(d => d.isbn).length,
    });

    return NextResponse.json({
      total: results.total,
      deals,
    });
  } catch (error) {
    console.error('eBay search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}
