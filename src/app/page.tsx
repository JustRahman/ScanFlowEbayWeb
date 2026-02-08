'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

// Direct Supabase REST API — same approach as ScanFlow-ScapWeb
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const TABLE = 'ebay_books';
const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

type Seller = 'booksrun' | 'oneplanetbooks';
type DecisionFilter = 'all' | 'BUY' | 'REVIEW' | 'REJECT';
type PriceFilter = 'all' | '0-5' | '5-10' | '10-20' | '20+';
type FormatFilter = 'all' | 'Paperback' | 'Hardcover';
type WeightFilter = 'all' | '0-5' | '5-10' | '10-20' | '20+';

interface Book {
  id: number;
  isbn: string;
  title: string;
  price: number;
  condition: string;
  seller: string;
  category: string;
  ebay_item_id: string;
  ebay_url: string;
  image_url: string | null;
  shipping: number;
  scraped_at: string;
  decision: string | null;
  asin: string | null;
  amazon_price: number | null;
  sales_rank: number | null;
  sales_rank_drops_30: number | null;
  sales_rank_drops_90: number | null;
  fba_profit: number | null;
  fbm_profit: number | null;
  fba_roi: number | null;
  score: number | null;
  amazon_flag: string | null;
  book_type: string | null;
  weight_oz: number | null;
  evaluated_at: string | null;
  bought_at: string | null;
}

const SELLERS: { id: Seller; label: string }[] = [
  { id: 'booksrun', label: 'BooksRun' },
  { id: 'oneplanetbooks', label: 'OnePlanetBooks' },
];

export default function Home() {
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSeller, setActiveSeller] = useState<Seller>('booksrun');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('BUY');
  const [priceFilters, setPriceFilters] = useState<PriceFilter[]>(['all']);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [weightFilter, setWeightFilter] = useState<WeightFilter>('all');
  const [minProfit, setMinProfit] = useState('');
  const [minRoi, setMinRoi] = useState('');
  const [hasanFilter, setHasanFilter] = useState(true);

  // Store all books per seller for counts
  const [allBooksrun, setAllBooksrun] = useState<Book[]>([]);
  const [allOneplanet, setAllOneplanet] = useState<Book[]>([]);

  // ── Fetch ALL books for a seller with pagination (1000 per page) ──
  const fetchAllBooksForSeller = useCallback(async (seller: string): Promise<Book[]> => {
    const PAGE_SIZE = 1000;
    const allResults: Book[] = [];
    let offset = 0;

    try {
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc&seller=eq.${seller}`;
        const response = await fetch(url, {
          headers: { ...HEADERS, 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }
        });
        if (!response.ok) break;
        const page: Book[] = await response.json();
        allResults.push(...page);
        if (page.length < PAGE_SIZE) break; // last page
        offset += PAGE_SIZE;
      }
      return allResults;
    } catch (error) {
      console.error(`Error fetching ${seller}:`, error);
      return allResults; // return whatever we got so far
    }
  }, []);

  // ── Load both sellers on mount ──
  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const [br, op] = await Promise.all([
        fetchAllBooksForSeller('booksrun'),
        fetchAllBooksForSeller('oneplanetbooks'),
      ]);
      setAllBooksrun(br);
      setAllOneplanet(op);
      // Set active seller's books
      setAllBooks(br); // default is booksrun
      setLoading(false);
    }
    loadAll();
  }, [fetchAllBooksForSeller]);

  // ── Switch seller: use cached data ──
  useEffect(() => {
    setAllBooks(activeSeller === 'booksrun' ? allBooksrun : allOneplanet);
  }, [activeSeller, allBooksrun, allOneplanet]);

  // ── Seller counts (BUY count for each) ──
  const sellerCounts = useMemo(() => ({
    booksrun: allBooksrun.filter(b => b.decision === 'BUY').length,
    oneplanetbooks: allOneplanet.filter(b => b.decision === 'BUY').length,
  }), [allBooksrun, allOneplanet]);

  // ── Stats (computed from all books for active seller) ──
  const stats = useMemo(() => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return {
      total: allBooks.length,
      buy: allBooks.filter(b => b.decision === 'BUY').length,
      review: allBooks.filter(b => b.decision === 'REVIEW').length,
      reject: allBooks.filter(b => b.decision === 'REJECT').length,
      bought: allBooks.filter(b => b.decision === 'BOUGHT').length,
      today: allBooks.filter(b => b.bought_at && b.bought_at >= twentyFourHoursAgo).length,
    };
  }, [allBooks]);

  // ── Client-side filtering (decision + all other filters) ──
  const filteredBooks = useMemo(() => {
    return allBooks.filter(book => {
      // Decision filter (was server-side, now client-side)
      if (decisionFilter !== 'all' && book.decision !== decisionFilter) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!book.title.toLowerCase().includes(q) && !book.isbn.includes(q)) return false;
      }

      // Price filter (multi-select)
      const buyPrice = book.price / 100;
      if (!priceFilters.includes('all')) {
        let matchesPrice = false;
        if (priceFilters.includes('0-5') && buyPrice < 5) matchesPrice = true;
        if (priceFilters.includes('5-10') && buyPrice >= 5 && buyPrice < 10) matchesPrice = true;
        if (priceFilters.includes('10-20') && buyPrice >= 10 && buyPrice < 20) matchesPrice = true;
        if (priceFilters.includes('20+') && buyPrice >= 20) matchesPrice = true;
        if (!matchesPrice) return false;
      }

      // Format filter
      if (formatFilter !== 'all') {
        const bookFormat = book.book_type || '';
        if (formatFilter === 'Paperback' && !bookFormat.toLowerCase().includes('paper') && !bookFormat.toLowerCase().includes('soft')) return false;
        if (formatFilter === 'Hardcover' && !bookFormat.toLowerCase().includes('hard')) return false;
      }

      // Weight filter (oz → lbs)
      if (weightFilter !== 'all') {
        const weightLbs = book.weight_oz ? book.weight_oz / 16 : 0;
        if (weightFilter === '0-5' && !(weightLbs > 0 && weightLbs < 5)) return false;
        if (weightFilter === '5-10' && !(weightLbs >= 5 && weightLbs < 10)) return false;
        if (weightFilter === '10-20' && !(weightLbs >= 10 && weightLbs < 20)) return false;
        if (weightFilter === '20+' && !(weightLbs >= 20)) return false;
      }

      // Min profit
      if (minProfit) {
        const v = parseFloat(minProfit);
        if (!isNaN(v) && (book.fbm_profit == null || book.fbm_profit / 100 < v)) return false;
      }

      // ROI range (e.g. 7 means 7.0x-7.9x)
      if (minRoi) {
        const val = parseFloat(minRoi.replace(/x$/i, ''));
        if (!isNaN(val)) {
          const roi = book.amazon_price && book.price > 0 ? book.amazon_price / book.price : 0;
          if (roi < val || roi >= val + 1) return false;
        }
      }

      // Hasan Filter: 5x+ ROI AND $30+ Amazon price
      if (hasanFilter) {
        const roi = book.amazon_price && book.price > 0 ? book.amazon_price / book.price : 0;
        const amazonDollars = book.amazon_price ? book.amazon_price / 100 : 0;
        if (roi < 5 || amazonDollars < 30) return false;
      }

      return true;
    });
  }, [allBooks, decisionFilter, searchQuery, priceFilters, formatFilter, weightFilter, minProfit, minRoi, hasanFilter]);

  // ── Action handler (direct PATCH to Supabase) ──
  async function handleAction(bookId: number, action: 'BOUGHT' | 'REJECT', buttonElement: HTMLButtonElement) {
    const card = buttonElement.closest('.book-card') as HTMLElement;
    if (!card) return;

    const buttons = card.querySelectorAll<HTMLButtonElement>('.action-btn');
    buttons.forEach(btn => btn.disabled = true);
    buttonElement.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-5.07l-2.83 2.83M8.76 15.24l-2.83 2.83m11.31 0l-2.83-2.83M8.76 8.76L5.93 5.93"/></svg>';

    try {
      const updateData: Record<string, string> = { decision: action };
      if (action === 'BOUGHT') {
        updateData.bought_at = new Date().toISOString();
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${bookId}`, {
        method: 'PATCH',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) throw new Error('Failed to update');

      card.classList.add('removing');

      // Remove from both the active list and the cached seller list
      const removeBook = (books: Book[]) => books.filter(b => b.id !== bookId);
      setAllBooks(removeBook);
      if (activeSeller === 'booksrun') {
        setAllBooksrun(removeBook);
      } else {
        setAllOneplanet(removeBook);
      }
    } catch (error) {
      console.error('Error updating book:', error);
      buttons.forEach(btn => btn.disabled = false);
      buttonElement.innerHTML = action === 'BOUGHT'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      alert('Failed to update. Please try again.');
    }
  }

  const togglePriceFilter = (value: PriceFilter) => {
    setPriceFilters(prev => {
      if (value === 'all') return ['all'];
      const next = prev.filter(v => v !== 'all');
      if (next.includes(value)) {
        const result = next.filter(v => v !== value);
        return result.length === 0 ? ['all'] : result;
      }
      return [...next, value];
    });
  };

  const isNewBook = (book: Book) => {
    const scrapedAt = new Date(book.scraped_at);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return scrapedAt > twentyFourHoursAgo;
  };

  return (
    <>
      {/* Header */}
      <div className="header">
        <h1>{activeSeller === 'booksrun' ? 'BooksRun Deals' : 'OnePlanetBooks Deals'}</h1>
        <p>{activeSeller === 'booksrun' ? 'Books from BooksRun on eBay' : 'Books from OnePlanetBooks on eBay'}</p>

        <div className="source-toggle-container">
          <div className="source-toggle">
            {SELLERS.map(s => (
              <button
                key={s.id}
                className={`source-btn ${activeSeller === s.id ? 'active' : ''}`}
                onClick={() => setActiveSeller(s.id)}
              >
                {s.label}
                <span className="count">{sellerCounts[s.id] ?? '-'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: '#00cec9' }}>{stats.buy}</div>
            <div className="stat-label">BUY</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: '#fdcb6e' }}>{stats.review}</div>
            <div className="stat-label">REVIEW</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: '#e74c3c' }}>{stats.reject}</div>
            <div className="stat-label">REJECT</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: '#2ed573' }}>{stats.bought}</div>
            <div className="stat-label">BOUGHT</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: '#00b894' }}>{stats.today}</div>
            <div className="stat-label">TODAY</div>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="main-layout">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="filter-section">
            <input
              type="text"
              className="search-box"
              placeholder="Search title or ISBN..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-section">
            <div className="filter-title">Hasan Filter</div>
            <div className="filter-options">
              <div
                className={`filter-toggle ${hasanFilter ? 'active' : ''}`}
                onClick={() => setHasanFilter(!hasanFilter)}
              >
                <span className="checkbox" />
                <span className="label">5x+ ROI &amp; $30+ Amazon</span>
              </div>
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-title">Decision</div>
            <div className="filter-options">
              {(['all', 'BUY', 'REVIEW', 'REJECT'] as DecisionFilter[]).map(d => (
                <div
                  key={d}
                  className={`filter-toggle ${decisionFilter === d ? 'active' : ''}`}
                  onClick={() => setDecisionFilter(d)}
                >
                  <span className="checkbox" />
                  <span className="label">{d === 'all' ? 'All' : d}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-title">Buy Price</div>
            <div className="filter-options">
              {([
                { id: 'all' as PriceFilter, label: 'All Prices' },
                { id: '0-5' as PriceFilter, label: 'Under $5' },
                { id: '5-10' as PriceFilter, label: '$5 - $10' },
                { id: '10-20' as PriceFilter, label: '$10 - $20' },
                { id: '20+' as PriceFilter, label: '$20+' },
              ]).map(p => (
                <div
                  key={p.id}
                  className={`filter-toggle ${priceFilters.includes(p.id) ? 'active' : ''}`}
                  onClick={() => togglePriceFilter(p.id)}
                >
                  <span className="checkbox" />
                  <span className="label">{p.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-title">Format</div>
            <div className="filter-options">
              {([
                { id: 'all' as FormatFilter, label: 'All Formats' },
                { id: 'Paperback' as FormatFilter, label: 'Paperback' },
                { id: 'Hardcover' as FormatFilter, label: 'Hardcover' },
              ]).map(f => (
                <div
                  key={f.id}
                  className={`filter-toggle ${formatFilter === f.id ? 'active' : ''}`}
                  onClick={() => setFormatFilter(f.id)}
                >
                  <span className="checkbox" />
                  <span className="label">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-title">Weight (lbs)</div>
            <div className="filter-options">
              {([
                { id: 'all' as WeightFilter, label: 'All Weights' },
                { id: '0-5' as WeightFilter, label: 'Under 5 lbs' },
                { id: '5-10' as WeightFilter, label: '5 - 10 lbs' },
                { id: '10-20' as WeightFilter, label: '10 - 20 lbs' },
                { id: '20+' as WeightFilter, label: '20+ lbs' },
              ]).map(w => (
                <div
                  key={w.id}
                  className={`filter-toggle ${weightFilter === w.id ? 'active' : ''}`}
                  onClick={() => setWeightFilter(w.id)}
                >
                  <span className="checkbox" />
                  <span className="label">{w.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-title">Min Profit</div>
            <input
              type="number"
              className="search-box"
              placeholder="e.g. 20"
              value={minProfit}
              onChange={e => setMinProfit(e.target.value)}
            />
          </div>

          <div className="filter-section">
            <div className="filter-title">ROI Range</div>
            <input
              type="text"
              className="search-box"
              placeholder="e.g. 7 for 7.0x-7.9x"
              value={minRoi}
              onChange={e => setMinRoi(e.target.value)}
            />
          </div>
        </div>

        {/* Content */}
        <div className="content">
          <div className="results-count">
            {loading ? '' : `Showing ${filteredBooks.length} book${filteredBooks.length !== 1 ? 's' : ''}`}
          </div>

          {loading ? (
            <div className="loading">
              <div className="loading-spinner" />
              <p>Loading books...</p>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="no-results">
              <p>No books found matching your criteria.</p>
            </div>
          ) : (
            <div className="books-grid">
              {filteredBooks.map(book => {
                const buyPrice = book.price / 100;
                const amazonPrice = book.amazon_price ? book.amazon_price / 100 : null;
                const salesRank = book.sales_rank;
                const roi = amazonPrice && buyPrice > 0 ? amazonPrice / buyPrice : null;
                const soldPerMonth = book.sales_rank_drops_90 != null ? Math.round(book.sales_rank_drops_90 / 3) : null;
                const weightLbs = book.weight_oz ? (book.weight_oz / 16).toFixed(1) : null;
                const bookIsNew = isNewBook(book);

                return (
                  <div key={book.id} className="book-card">
                    <div className="book-card-content">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                        {book.decision ? (
                          <span className={`decision-badge ${book.decision}`}>{book.decision}</span>
                        ) : <span />}
                        {book.amazon_flag && (
                          <span className={`amazon-flag ${book.amazon_flag}`} title={
                            book.amazon_flag === 'green' ? 'Amazon out >50% of time' :
                            book.amazon_flag === 'yellow' ? 'Amazon out 20-50%' :
                            'Amazon in stock >80%'
                          }>
                            {book.amazon_flag === 'green' ? 'AMZ OUT' : book.amazon_flag === 'yellow' ? 'AMZ MID' : 'AMZ IN'}
                          </span>
                        )}
                      </div>

                      <h3 className="book-title">{book.title}</h3>

                      <div className="book-meta">
                        {bookIsNew && <span className="badge badge-new">NEW</span>}
                        <span className="badge badge-format">{book.book_type || 'Unknown'}</span>
                        <span className="badge badge-condition">{book.condition || 'Used'}</span>
                        <span className="badge badge-seller">{book.seller}</span>
                      </div>

                      <div className="price-card">
                        <div className="price-row">
                          <span className="price-label">Buy Price</span>
                          <span className="price-value buy">${buyPrice.toFixed(2)}</span>
                        </div>
                        {roi !== null && (
                          <div className="price-row">
                            <span className="price-label">Multiplier</span>
                            <span className="price-value profit" style={{ fontSize: '1.2rem', fontWeight: 700 }}>{roi.toFixed(1)}x</span>
                          </div>
                        )}
                        {amazonPrice !== null && (
                          <div className="price-row">
                            <span className="price-label">Amazon Price</span>
                            <span className="price-value">${amazonPrice.toFixed(2)}</span>
                          </div>
                        )}
                        {salesRank !== null && (
                          <div className="price-row">
                            <span className="price-label">Rank</span>
                            <span className="rank-badge">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                              {salesRank.toLocaleString()}
                            </span>
                          </div>
                        )}
                        <div className="price-row">
                          <span className="price-label">Sold/Month</span>
                          <span className={`price-value ${(soldPerMonth ?? 0) >= 3 ? 'profit' : (soldPerMonth ?? 0) >= 2 ? '' : 'loss'}`}>
                            {soldPerMonth ?? 0}
                          </span>
                        </div>
                        {weightLbs && (
                          <div className="price-row">
                            <span className="price-label">Weight</span>
                            <span className="price-value">{weightLbs} lbs</span>
                          </div>
                        )}
                      </div>

                      <div className="book-isbn">ISBN: {book.isbn}</div>

                      <div className="platform-buttons">
                        {book.asin ? (
                          <a href={`https://www.amazon.com/dp/${book.asin}`} target="_blank" rel="noopener noreferrer" className="platform-btn amazon">
                            <span className="platform-name">Buy Box</span>
                            <span className="platform-price">{amazonPrice ? `$${amazonPrice.toFixed(2)}` : 'View'}</span>
                          </a>
                        ) : (
                          <span className="platform-btn amazon disabled">
                            <span className="platform-name">Buy Box</span>
                            <span className="platform-price">N/A</span>
                          </span>
                        )}
                        <a href={book.ebay_url} target="_blank" rel="noopener noreferrer"
                          className={`platform-btn ${book.seller === 'booksrun' ? 'ebay' : 'oneplanet'}`}>
                          <span className="platform-name">{book.seller === 'booksrun' ? 'BR eBay' : 'OnePlanet'}</span>
                          <span className="platform-price">${buyPrice.toFixed(2)}</span>
                        </a>
                      </div>

                      <div className="action-buttons">
                        <button
                          className="action-btn remove"
                          onClick={(e) => handleAction(book.id, 'REJECT', e.currentTarget)}
                          title="Remove"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                        <button
                          className="action-btn bought"
                          onClick={(e) => handleAction(book.id, 'BOUGHT', e.currentTarget)}
                          title="Bought"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
