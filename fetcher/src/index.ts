import 'dotenv/config';
import { SELLERS, CATEGORIES } from './config.js';
import { searchListings } from './ebayApi.js';
import { getExistingISBNs, insertBooks } from './supabase.js';
import { evaluatePendingBooks } from './evaluate.js';

async function main() {
  console.log('=== ScanFlow Fetcher ===\n');

  // Step 1: Load existing ISBNs for dedup
  const existingISBNs = await getExistingISBNs();
  let totalNew = 0;
  let totalSkipped = 0;

  // Step 2: Scrape all sellers × categories
  for (const seller of SELLERS) {
    console.log(`\nSeller: ${seller}`);

    for (const cat of CATEGORIES) {
      try {
        const books = await searchListings(seller, cat.id);

        // Filter out books we already have
        const newBooks = books.filter(b => !existingISBNs.has(b.isbn));
        const skipped = books.length - newBooks.length;

        // Insert new books
        const result = await insertBooks(newBooks);

        // Add new ISBNs to the set for subsequent iterations
        for (const book of newBooks) {
          existingISBNs.add(book.isbn);
        }

        totalNew += result.saved;
        totalSkipped += skipped + result.duplicates;

        console.log(
          `  ${cat.name}: ${books.length} found, ${result.saved} new, ${skipped} already known, ${result.duplicates} dup, ${result.errors} errors`
        );
      } catch (error) {
        console.error(`  ${cat.name}: ERROR -`, error instanceof Error ? error.message : error);
      }
    }
  }

  console.log(`\nScraping complete: ${totalNew} new books inserted, ${totalSkipped} skipped`);

  // Step 3: Evaluate pending books via Keepa
  const evalResult = await evaluatePendingBooks();

  // Step 4: Summary
  console.log('\n=== Summary ===');
  console.log(`Scraped: ${totalNew} new, ${totalSkipped} skipped`);
  console.log(`Evaluated: ${evalResult.evaluated} total`);
  console.log(`  BUY: ${evalResult.buy}`);
  console.log(`  REVIEW: ${evalResult.review}`);
  console.log(`  REJECT: ${evalResult.reject}`);
  console.log(`  No Keepa data: ${evalResult.noData}`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
