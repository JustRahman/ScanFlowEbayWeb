import { NextRequest, NextResponse } from 'next/server';
import { supabase, EBAY_BOOKS_TABLE } from '@/services/supabase';

interface BookToSave {
  isbn: string;
  title: string;
  price: number;
  condition: string;
  seller: string;
  category: string;
  ebayItemId: string;
  ebayUrl: string;
  imageUrl: string | null;
  shipping: number;
}

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] [API/save] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [API/save] ${message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { books } = body as { books: BookToSave[] };

    if (!books || !Array.isArray(books)) {
      return NextResponse.json({ error: 'Books array is required' }, { status: 400 });
    }

    log(`Saving ${books.length} books to database...`);

    let saved = 0;
    let duplicates = 0;
    let errors = 0;
    let noIsbn = 0;

    for (const book of books) {
      // Skip books without ISBN
      if (!book.isbn) {
        noIsbn++;
        continue;
      }

      const dbBook = {
        isbn: book.isbn,
        title: book.title.substring(0, 500),
        price: book.price,
        condition: book.condition,
        seller: book.seller || 'oneplanetbooks',
        category: book.category,
        ebay_item_id: book.ebayItemId,
        ebay_url: book.ebayUrl,
        image_url: book.imageUrl,
        shipping: book.shipping || 0,
        scraped_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(EBAY_BOOKS_TABLE)
        .insert(dbBook);

      if (error) {
        if (error.code === '23505') {
          // Duplicate ISBN
          duplicates++;
        } else {
          log(`Insert error for ${book.isbn}: ${error.message}`);
          errors++;
        }
      } else {
        saved++;
      }
    }

    log(`Save complete`, { saved, duplicates, noIsbn, errors });

    return NextResponse.json({
      success: true,
      saved,
      duplicates,
      noIsbn,
      errors,
      total: books.length,
    });
  } catch (error) {
    console.error('Save books error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Save failed' },
      { status: 500 }
    );
  }
}
