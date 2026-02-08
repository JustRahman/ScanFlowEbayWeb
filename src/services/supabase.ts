import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Client-side Supabase client (uses NEXT_PUBLIC_ env vars)
let clientSupabase: ReturnType<typeof createClient> | null = null;

export function getClientSupabase() {
  if (clientSupabase) return clientSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  clientSupabase = createClient(url, key);
  return clientSupabase;
}

// Database types
export interface EbayBook {
  id?: number;
  isbn: string;
  title: string;
  price: number;          // eBay price in cents
  condition: string;
  seller: string;
  category: string;
  ebay_item_id: string;
  ebay_url: string;
  image_url: string | null;
  shipping: number;       // shipping cost in cents
  scraped_at: string;

  // Amazon/Keepa data (filled after evaluation)
  decision: 'BUY' | 'REVIEW' | 'REJECT' | 'BOUGHT' | null;
  asin: string | null;
  amazon_price: number | null;      // in cents
  sales_rank: number | null;
  sales_rank_drops_30: number | null;
  sales_rank_drops_90: number | null;
  fba_profit: number | null;        // in cents
  fbm_profit: number | null;        // in cents
  fba_roi: number | null;           // percentage
  score: number | null;
  book_type: string | null;         // 'Paperback', 'Hardcover', etc.
  weight_oz: number | null;         // weight in ounces
  evaluated_at: string | null;

  // Action tracking
  bought_at: string | null;
}

// Table name
export const EBAY_BOOKS_TABLE = 'ebay_books';

// Mark a book with an action (BOUGHT or REJECT)
export async function markBookAction(
  id: number,
  action: 'BOUGHT' | 'REJECT'
): Promise<boolean> {
  const updates: Record<string, unknown> = { decision: action };
  if (action === 'BOUGHT') {
    updates.bought_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from(EBAY_BOOKS_TABLE)
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error(`Action error for book ${id}:`, error.message);
    return false;
  }

  return true;
}

// Save books to database (batch insert)
export async function saveBooks(books: Omit<EbayBook, 'id'>[]): Promise<{ saved: number; duplicates: number; errors: number }> {
  let saved = 0;
  let duplicates = 0;
  let errors = 0;

  for (const book of books) {
    const { error } = await supabase
      .from(EBAY_BOOKS_TABLE)
      .insert(book);

    if (error) {
      if (error.code === '23505') {
        // Duplicate ISBN
        duplicates++;
      } else {
        console.error(`Insert error for ${book.isbn}:`, error.message);
        errors++;
      }
    } else {
      saved++;
    }
  }

  return { saved, duplicates, errors };
}

// Get pending books (not yet evaluated)
export async function getPendingBooks(limit: number = 100): Promise<EbayBook[]> {
  const { data, error } = await supabase
    .from(EBAY_BOOKS_TABLE)
    .select('*')
    .is('decision', null)
    .order('scraped_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Error fetching pending books:', error.message);
    return [];
  }

  return data || [];
}

// Update book with evaluation data
export async function updateBookEvaluation(isbn: string, evaluation: {
  decision: 'BUY' | 'REVIEW' | 'REJECT';
  asin?: string;
  amazon_price?: number;
  sales_rank?: number;
  sales_rank_drops_30?: number;
  sales_rank_drops_90?: number;
  fba_profit?: number;
  fbm_profit?: number;
  fba_roi?: number;
  score?: number;
}): Promise<boolean> {
  const { error } = await supabase
    .from(EBAY_BOOKS_TABLE)
    .update({
      ...evaluation,
      evaluated_at: new Date().toISOString(),
    })
    .eq('isbn', isbn);

  if (error) {
    console.error(`Update error for ${isbn}:`, error.message);
    return false;
  }

  return true;
}

// Get all evaluated books
export async function getEvaluatedBooks(decision?: 'BUY' | 'REVIEW' | 'REJECT', limit: number = 100): Promise<EbayBook[]> {
  let query = supabase
    .from(EBAY_BOOKS_TABLE)
    .select('*')
    .not('decision', 'is', null)
    .order('score', { ascending: false })
    .limit(limit);

  if (decision) {
    query = query.eq('decision', decision);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching evaluated books:', error.message);
    return [];
  }

  return data || [];
}

// Get existing ISBNs to avoid duplicates
export async function getExistingISBNs(): Promise<Set<string>> {
  const isbns = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(EBAY_BOOKS_TABLE)
      .select('isbn')
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error loading existing ISBNs:', error.message);
      break;
    }

    if (!data || data.length === 0) break;

    data.forEach(row => isbns.add(row.isbn));
    from += pageSize;

    if (data.length < pageSize) break;
  }

  return isbns;
}

// Get stats
export async function getStats(): Promise<{
  total: number;
  pending: number;
  evaluated: number;
  buyCount: number;
  reviewCount: number;
  rejectCount: number;
}> {
  const [totalRes, pendingRes, buyRes, reviewRes, rejectRes] = await Promise.all([
    supabase.from(EBAY_BOOKS_TABLE).select('*', { count: 'exact', head: true }),
    supabase.from(EBAY_BOOKS_TABLE).select('*', { count: 'exact', head: true }).is('decision', null),
    supabase.from(EBAY_BOOKS_TABLE).select('*', { count: 'exact', head: true }).eq('decision', 'BUY'),
    supabase.from(EBAY_BOOKS_TABLE).select('*', { count: 'exact', head: true }).eq('decision', 'REVIEW'),
    supabase.from(EBAY_BOOKS_TABLE).select('*', { count: 'exact', head: true }).eq('decision', 'REJECT'),
  ]);

  return {
    total: totalRes.count || 0,
    pending: pendingRes.count || 0,
    evaluated: (totalRes.count || 0) - (pendingRes.count || 0),
    buyCount: buyRes.count || 0,
    reviewCount: reviewRes.count || 0,
    rejectCount: rejectRes.count || 0,
  };
}
