import { NextRequest, NextResponse } from 'next/server';
import { searchAllCategories, convertToDeal, extractISBN, BOOK_CATEGORIES, type BookCondition } from '@/services/ebayApi';
import { saveBooks, getExistingISBNs, type EbayBook } from '@/services/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query = '',
      minPrice = 3,
      maxPrice = 20,
      conditions = ['VERY_GOOD'],
      sellers = ['booksrun'],
      saveToDb = true,
    } = body;

    console.log('Starting bulk search across all categories...');
    console.log('Categories:', BOOK_CATEGORIES.map(c => `${c.name}: ${c.limit}`).join(', '));

    // Get existing ISBNs to avoid duplicates
    let existingISBNs = new Set<string>();
    if (saveToDb) {
      console.log('Loading existing ISBNs from database...');
      existingISBNs = await getExistingISBNs();
      console.log(`Found ${existingISBNs.size} existing ISBNs in database`);
    }

    const results = await searchAllCategories(query, {
      minPrice,
      maxPrice,
      conditions: conditions as BookCondition[],
      sellers,
    });

    // Convert to deals and filter for ISBN
    const deals = results.items.map(item => {
      const deal = convertToDeal(item);
      if (!deal.isbn) {
        deal.isbn = extractISBN(item);
      }
      return deal;
    });

    // Filter: only items with ISBN and not already in DB
    const newDeals = deals.filter(d => d.isbn && !existingISBNs.has(d.isbn));
    const duplicateCount = deals.filter(d => d.isbn && existingISBNs.has(d.isbn)).length;

    console.log(`Bulk search: ${deals.length} total, ${newDeals.length} new, ${duplicateCount} duplicates`);

    // Save to database if enabled
    let saveResult = { saved: 0, duplicates: 0, errors: 0 };
    if (saveToDb && newDeals.length > 0) {
      console.log(`Saving ${newDeals.length} new books to database...`);

      // Find category for each book (based on which search returned it)
      const booksToSave: Omit<EbayBook, 'id'>[] = newDeals.map(deal => ({
        isbn: deal.isbn!,
        title: deal.ebayTitle,
        price: deal.ebayPrice,
        condition: deal.ebayCondition,
        seller: deal.ebaySeller,
        category: 'Textbook', // Default, could be improved by tracking source category
        ebay_item_id: deal.ebayItemId,
        ebay_url: deal.ebayUrl,
        image_url: deal.ebayImage,
        shipping: deal.ebayShipping,
        scraped_at: new Date().toISOString(),
        // Evaluation fields (null until evaluated)
        decision: null,
        asin: null,
        amazon_price: null,
        sales_rank: null,
        sales_rank_drops_30: null,
        sales_rank_drops_90: null,
        fba_profit: null,
        fbm_profit: null,
        fba_roi: null,
        score: null,
        evaluated_at: null,
      }));

      saveResult = await saveBooks(booksToSave);
      console.log(`Save result: ${saveResult.saved} saved, ${saveResult.duplicates} duplicates, ${saveResult.errors} errors`);
    }

    return NextResponse.json({
      total: results.total,
      fetched: deals.length,
      withIsbn: deals.filter(d => d.isbn).length,
      newBooks: newDeals.length,
      alreadyInDb: duplicateCount,
      saved: saveResult.saved,
      saveErrors: saveResult.errors,
      categoryBreakdown: results.categoryBreakdown,
      deals: newDeals, // Return only new deals to UI
    });
  } catch (error) {
    console.error('Bulk search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bulk search failed' },
      { status: 500 }
    );
  }
}
