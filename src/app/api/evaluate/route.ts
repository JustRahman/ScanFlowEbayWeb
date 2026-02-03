import { NextRequest, NextResponse } from 'next/server';
import { getPendingBooks, updateBookEvaluation, getStats } from '@/services/supabase';
import { getProductByIsbn, calculateFees, makeDecision } from '@/services/keepaApi';

// Evaluate pending books with Keepa API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { limit = 50, delayMs = 1200 } = body;

    console.log(`Starting evaluation of up to ${limit} pending books...`);

    // Get pending books
    const pendingBooks = await getPendingBooks(limit);

    if (pendingBooks.length === 0) {
      const stats = await getStats();
      return NextResponse.json({
        message: 'No pending books to evaluate',
        stats,
      });
    }

    console.log(`Found ${pendingBooks.length} pending books`);

    const results = {
      evaluated: 0,
      buy: 0,
      review: 0,
      reject: 0,
      errors: 0,
      notFound: 0,
    };

    // Process each book
    for (let i = 0; i < pendingBooks.length; i++) {
      const book = pendingBooks[i];
      console.log(`[${i + 1}/${pendingBooks.length}] Evaluating ISBN: ${book.isbn}`);

      try {
        // Fetch Keepa data
        const product = await getProductByIsbn(book.isbn);

        if (!product || !product.buyBoxPrice) {
          // Not found on Amazon or no buy box price
          await updateBookEvaluation(book.isbn, {
            decision: 'REJECT',
            score: 0,
          });
          results.notFound++;
          results.reject++;
          results.evaluated++;
          console.log(`  → REJECT (not found on Amazon)`);
          continue;
        }

        // Calculate fees and profit
        const fees = calculateFees(book.price, product.buyBoxPrice);

        // Make decision
        const decision = makeDecision(
          Math.max(fees.fbaProfit, fees.fbmProfit),
          Math.max(fees.fbaRoi, fees.fbmRoi),
          product.salesRank,
          product.salesRankDrops30,
          product.fbaOfferCount,
          product.isAmazon
        );

        // Update database
        await updateBookEvaluation(book.isbn, {
          decision: decision.decision,
          asin: product.asin,
          amazon_price: product.buyBoxPrice,
          sales_rank: product.salesRank || undefined,
          sales_rank_drops_30: product.salesRankDrops30 || undefined,
          sales_rank_drops_90: product.salesRankDrops90 || undefined,
          fba_profit: fees.fbaProfit,
          fbm_profit: fees.fbmProfit,
          fba_roi: fees.fbaRoi,
          score: decision.score,
        });

        results.evaluated++;
        if (decision.decision === 'BUY') results.buy++;
        else if (decision.decision === 'REVIEW') results.review++;
        else results.reject++;

        console.log(`  → ${decision.decision} (score: ${decision.score}, profit: $${(fees.fbaProfit / 100).toFixed(2)})`);

        // Delay to avoid rate limiting
        if (i < pendingBooks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`  → Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        results.errors++;

        // Mark as rejected if there's an error
        await updateBookEvaluation(book.isbn, {
          decision: 'REJECT',
          score: 0,
        });
        results.reject++;
        results.evaluated++;
      }
    }

    // Get updated stats
    const stats = await getStats();

    console.log(`Evaluation complete: ${results.evaluated} evaluated, ${results.buy} BUY, ${results.review} REVIEW, ${results.reject} REJECT`);

    return NextResponse.json({
      message: 'Evaluation complete',
      results,
      stats,
    });
  } catch (error) {
    console.error('Evaluate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Evaluation failed' },
      { status: 500 }
    );
  }
}

// GET: Get current stats
export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get stats' },
      { status: 500 }
    );
  }
}
