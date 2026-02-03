'use client';

import { useState, useEffect } from 'react';
import { Search, Filter, ExternalLink, BookOpen, Store, Tag, Loader2, AlertCircle, ChevronDown, X, ChevronRight, Sparkles, TrendingUp, Database } from 'lucide-react';
import Image from 'next/image';
import { BookDetailModal } from '@/components/BookDetailModal';

interface Deal {
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
  // Optional Amazon data (for featured deals)
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

interface SearchResponse {
  total: number;
  deals: Deal[];
  categoryBreakdown?: Record<string, number>;
  fetched?: number;
  withIsbn?: number;
}

const SELLERS = [
  { id: 'oneplanetbooks', name: 'One Planet Books' },
];

const CONDITIONS = [
  { id: 'LIKE_NEW', name: 'Like New' },
];

const CATEGORIES = [
  { id: '2228', name: 'Textbooks & Education' },
  { id: '267', name: 'All Books' },
  { id: '182964', name: 'Engineering' },
  { id: '11769', name: 'Medicine & Health' },
  { id: '465', name: 'Science & Mathematics' },
  { id: '2256', name: 'Computers & Technology' },
  { id: '3270', name: 'Business & Economics' },
  { id: '11789', name: 'Law' },
];

// Categories to load progressively
const LOAD_CATEGORIES = [
  { id: '2228', name: 'Textbooks & Education', limit: 200 },
  { id: '182964', name: 'Engineering', limit: 200 },
  { id: '11769', name: 'Medicine & Health', limit: 200 },
  { id: '465', name: 'Science & Mathematics', limit: 200 },
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true); // Start with loading=true since we auto-load
  const [error, setError] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  // Progressive loading state
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState<Record<string, number>>({});
  const [allDeals, setAllDeals] = useState<Deal[]>([]);

  // Save stats
  const [saveStats, setSaveStats] = useState<{ saved: number; duplicates: number; noIsbn: number }>({ saved: 0, duplicates: 0, noIsbn: 0 });

  // Rate limit state
  const [rateLimited, setRateLimited] = useState(false);

  // Featured books (loaded on mount)
  const [featuredDeals, setFeaturedDeals] = useState<Deal[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSellers, setSelectedSellers] = useState<string[]>(['oneplanetbooks']);
  const [selectedConditions, setSelectedConditions] = useState<string[]>(['LIKE_NEW']);
  const [selectedCategory, setSelectedCategory] = useState<string>('267');
  const [minPrice, setMinPrice] = useState<number>(3);
  const [maxPrice, setMaxPrice] = useState<number>(25);

  // Bulk search
  const [bulkLoading, setBulkLoading] = useState(false);

  // Progressive loading on mount
  useEffect(() => {
    async function loadProgressively() {
      setLoading(true);
      setError(null);
      setAllDeals([]);
      setCategoryBreakdown({});
      setSaveStats({ saved: 0, duplicates: 0, noIsbn: 0 });
      setRateLimited(false);

      for (const category of LOAD_CATEGORIES) {
        setLoadingCategory(category.name);

        try {
          const response = await fetch('/api/ebay/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: '',
              sellers: ['oneplanetbooks'],
              conditions: ['LIKE_NEW'],
              categoryId: category.id,
              minPrice: 3,
              maxPrice: 25,
              limit: category.limit,
              fetchDetails: true,
            }),
          });

          const data = await response.json();

          // Check for rate limit error
          if (response.status === 429 || (data.error && data.error.includes('Rate limit'))) {
            console.warn('eBay rate limited! Stopping fetch...');
            setRateLimited(true);
            setError('eBay rate limit reached. Showing partial results.');
            break; // Stop fetching more categories
          }

          if (response.ok && data.deals) {
            // Append new deals
            setAllDeals(prev => [...prev, ...data.deals]);

            // Update category breakdown
            setCategoryBreakdown(prev => ({
              ...prev,
              [category.name]: data.deals.length,
            }));

            // Update results for display
            setResults(prev => ({
              total: (prev?.total || 0) + (data.total || 0),
              deals: [...(prev?.deals || []), ...data.deals],
              categoryBreakdown: {
                ...(prev?.categoryBreakdown || {}),
                [category.name]: data.deals.length,
              },
            }));

            // Save books to database
            const booksToSave = data.deals
              .filter((deal: Deal) => deal.isbn)
              .map((deal: Deal) => ({
                isbn: deal.isbn,
                title: deal.ebayTitle,
                price: deal.ebayPrice,
                condition: deal.ebayCondition,
                seller: deal.ebaySeller,
                category: category.name,
                ebayItemId: deal.ebayItemId,
                ebayUrl: deal.ebayUrl,
                imageUrl: deal.ebayImage,
                shipping: deal.ebayShipping,
              }));

            if (booksToSave.length > 0) {
              try {
                const saveResponse = await fetch('/api/books/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ books: booksToSave }),
                });
                const saveData = await saveResponse.json();

                if (saveResponse.ok) {
                  setSaveStats(prev => ({
                    saved: prev.saved + (saveData.saved || 0),
                    duplicates: prev.duplicates + (saveData.duplicates || 0),
                    noIsbn: prev.noIsbn + (saveData.noIsbn || 0),
                  }));
                }
              } catch (saveErr) {
                console.error(`Failed to save ${category.name} books:`, saveErr);
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load ${category.name}:`, err);
          setError(`Failed to load ${category.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          break; // Stop on error
        }
      }

      setLoadingCategory(null);
      setLoading(false);
    }

    loadProgressively();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ebay/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          sellers: selectedSellers,
          conditions: selectedConditions,
          categoryId: selectedCategory,
          minPrice,
          maxPrice,
          limit: 200,
          fetchDetails: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Search failed');
      }

      const data: SearchResponse = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSearch = async () => {
    setBulkLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ebay/bulk-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim() || '',
          sellers: selectedSellers,
          conditions: selectedConditions,
          minPrice,
          maxPrice,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Bulk search failed');
      }

      const data: SearchResponse = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSeller = (id: string) => {
    setSelectedSellers(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleCondition = (id: string) => {
    setSelectedConditions(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-neutral-900 dark:text-white" strokeWidth={1.5} />
            <div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">ScanFlow</h1>
              <p className="text-sm text-neutral-500">Book Arbitrage Finder</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Search Form */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" strokeWidth={1.5} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for books..."
                className="w-full pl-12 pr-4 py-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white focus:border-transparent transition-shadow"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-3 border rounded-lg flex items-center gap-2 transition-colors ${
                showFilters
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 border-neutral-900 dark:border-white'
                  : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
              }`}
            >
              <Filter className="w-5 h-5" strokeWidth={1.5} />
              <span className="hidden sm:inline">Filters</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} strokeWidth={1.5} />
            </button>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-lg font-medium hover:bg-neutral-800 dark:hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Search className="w-5 h-5" strokeWidth={1.5} />
              )}
              <span className="hidden sm:inline">Search</span>
            </button>
            <button
              type="button"
              onClick={handleBulkSearch}
              disabled={bulkLoading}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              title="Search all categories: 2K Textbooks, 1K Engineering, 1K Medicine, 1K Science"
            >
              {bulkLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Sparkles className="w-5 h-5" strokeWidth={1.5} />
              )}
              <span className="hidden sm:inline">Bulk Search</span>
            </button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="mt-4 p-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
              <div className="grid md:grid-cols-4 gap-6">
                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                    Category
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sellers */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                    Sellers
                  </label>
                  <div className="space-y-2">
                    {SELLERS.map((seller) => (
                      <label
                        key={seller.id}
                        className="flex items-center gap-3 cursor-pointer group"
                      >
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            selectedSellers.includes(seller.id)
                              ? 'bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white'
                              : 'border-neutral-300 dark:border-neutral-600 group-hover:border-neutral-400 dark:group-hover:border-neutral-500'
                          }`}
                        >
                          {selectedSellers.includes(seller.id) && (
                            <svg className="w-3 h-3 text-white dark:text-neutral-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-neutral-600 dark:text-neutral-400">{seller.name}</span>
                        <input
                          type="checkbox"
                          checked={selectedSellers.includes(seller.id)}
                          onChange={() => toggleSeller(seller.id)}
                          className="sr-only"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Conditions */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                    Condition
                  </label>
                  <div className="space-y-2">
                    {CONDITIONS.map((condition) => (
                      <label
                        key={condition.id}
                        className="flex items-center gap-3 cursor-pointer group"
                      >
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            selectedConditions.includes(condition.id)
                              ? 'bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white'
                              : 'border-neutral-300 dark:border-neutral-600 group-hover:border-neutral-400 dark:group-hover:border-neutral-500'
                          }`}
                        >
                          {selectedConditions.includes(condition.id) && (
                            <svg className="w-3 h-3 text-white dark:text-neutral-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-neutral-600 dark:text-neutral-400">{condition.name}</span>
                        <input
                          type="checkbox"
                          checked={selectedConditions.includes(condition.id)}
                          onChange={() => toggleCondition(condition.id)}
                          className="sr-only"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                    Price: ${minPrice} - ${maxPrice}
                  </label>
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs text-neutral-400">Min: ${minPrice}</span>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        value={minPrice}
                        onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 1))}
                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-white"
                      />
                    </div>
                    <div>
                      <span className="text-xs text-neutral-400">Max: ${maxPrice}</span>
                      <input
                        type="range"
                        min={1}
                        max={50}
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 1))}
                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-neutral-400">
                    <span>$1</span>
                    <span>$50</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>

        {/* Error State */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-red-700 dark:text-red-300">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-5 h-5 text-red-400 hover:text-red-600" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Results */}
        {(results || loading) && (
          <div>
            <div className="flex flex-col gap-2 mb-6">
              <div className="flex items-center justify-between">
                <p className="text-neutral-600 dark:text-neutral-400">
                  {results ? (
                    <>
                      Found <span className="font-semibold text-neutral-900 dark:text-white">{results.deals.length.toLocaleString()}</span> books
                      {loadingCategory && <span className="text-amber-500 ml-2">(loading more...)</span>}
                    </>
                  ) : (
                    <span className="text-amber-500">Starting search...</span>
                  )}
                </p>
              </div>
              {/* Loading indicator */}
              {loadingCategory && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading {loadingCategory}...</span>
                </div>
              )}
              {/* Save stats */}
              {(saveStats.saved > 0 || saveStats.duplicates > 0) && (
                <div className="flex items-center gap-3 text-sm">
                  <Database className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {saveStats.saved} saved
                  </span>
                  {saveStats.duplicates > 0 && (
                    <span className="text-neutral-400">
                      ({saveStats.duplicates} duplicates)
                    </span>
                  )}
                </div>
              )}
              {/* Rate limit warning */}
              {rateLimited && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">Rate limited - showing partial results</span>
                </div>
              )}
              {results?.categoryBreakdown && Object.keys(results.categoryBreakdown).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(results.categoryBreakdown).map(([category, count]) => (
                    <span key={category} className="px-2 py-1 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded">
                      {category}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {!results || results.deals.length === 0 ? (
              loading ? (
                <div className="text-center py-16 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                  <Loader2 className="w-12 h-12 text-amber-500 mx-auto mb-4 animate-spin" strokeWidth={1.5} />
                  <p className="text-neutral-500">Loading books from {loadingCategory || 'eBay'}...</p>
                </div>
              ) : (
                <div className="text-center py-16 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                  <BookOpen className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" strokeWidth={1} />
                  <p className="text-neutral-500">No books found. Try a different search.</p>
                </div>
              )
            ) : (
              <div className="grid gap-4">
                {results.deals.map((deal) => (
                  <div
                    key={deal.ebayItemId}
                    onClick={() => setSelectedDeal(deal)}
                    className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 hover:border-neutral-400 dark:hover:border-neutral-600 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex gap-4">
                      {/* Image */}
                      <div className="w-20 h-28 flex-shrink-0 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                        {deal.ebayImage ? (
                          <Image
                            src={deal.ebayImage}
                            alt={deal.ebayTitle}
                            width={80}
                            height={112}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BookOpen className="w-8 h-8 text-neutral-300 dark:text-neutral-600" strokeWidth={1} />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-neutral-900 dark:text-white line-clamp-2 mb-2">
                          {deal.ebayTitle}
                        </h3>

                        <div className="flex flex-wrap gap-3 text-sm text-neutral-500 mb-3">
                          <div className="flex items-center gap-1.5">
                            <Store className="w-4 h-4" strokeWidth={1.5} />
                            <span>{deal.ebaySeller}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Tag className="w-4 h-4" strokeWidth={1.5} />
                            <span>{deal.ebayCondition}</span>
                          </div>
                          {deal.isbn && (
                            <div className="flex items-center gap-1.5 font-mono text-xs bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded">
                              ISBN: {deal.isbn}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-2xl font-semibold text-neutral-900 dark:text-white">
                            {formatPrice(deal.ebayPrice)}
                            {deal.ebayShipping > 0 && (
                              <span className="text-sm font-normal text-neutral-400 ml-2">
                                +{formatPrice(deal.ebayShipping)} shipping
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <a
                              href={deal.ebayUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors"
                            >
                              eBay
                              <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                            </a>
                            <div className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">
                              Details
                              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Loading more indicator at bottom */}
                {loadingCategory && (
                  <div className="flex items-center justify-center gap-3 py-8 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                    <Loader2 className="w-6 h-6 text-amber-500 animate-spin" strokeWidth={1.5} />
                    <p className="text-neutral-500">Loading {loadingCategory}...</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Featured Deals (shown when no search results) */}
        {!results && !loading && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="w-5 h-5 text-amber-500" strokeWidth={1.5} />
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Featured Deals</h2>
              <span className="text-sm text-neutral-400">Fresh finds from top sellers</span>
            </div>

            {featuredLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-neutral-400 animate-spin" />
                <span className="ml-3 text-neutral-500">Finding best deals...</span>
              </div>
            ) : featuredError ? (
              <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg mb-12">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" strokeWidth={1.5} />
                <div>
                  <p className="text-amber-700 dark:text-amber-300 font-medium">{featuredError}</p>
                  {featuredError.includes('rate limit') ? (
                    <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">API limit reached. Please wait a few minutes and refresh.</p>
                  ) : featuredError.includes('credentials') || featuredError.includes('authentication') ? (
                    <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">Please check API configuration.</p>
                  ) : (
                    <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">Please try again later.</p>
                  )}
                </div>
              </div>
            ) : featuredDeals.length > 0 ? (
              <div className="grid gap-4 mb-12">
                {featuredDeals.map((deal) => (
                  <div
                    key={deal.ebayItemId}
                    onClick={() => setSelectedDeal(deal)}
                    className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex gap-4">
                      {/* Image */}
                      <div className="w-20 h-28 flex-shrink-0 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                        {deal.ebayImage ? (
                          <Image
                            src={deal.ebayImage}
                            alt={deal.ebayTitle}
                            width={80}
                            height={112}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BookOpen className="w-8 h-8 text-neutral-300 dark:text-neutral-600" strokeWidth={1} />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="font-medium text-neutral-900 dark:text-white line-clamp-2">
                            {deal.ebayTitle}
                          </h3>
                          {deal.decision && (
                            <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded ${
                              deal.decision === 'BUY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                              deal.decision === 'REVIEW' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                            }`}>
                              {deal.decision}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-3 text-sm text-neutral-500 mb-3">
                          <div className="flex items-center gap-1.5">
                            <Store className="w-4 h-4" strokeWidth={1.5} />
                            <span>{deal.ebaySeller}</span>
                          </div>
                          {deal.fbaProfit !== undefined && deal.fbaProfit > 0 && (
                            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                              <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
                              <span>${(deal.fbaProfit / 100).toFixed(2)} profit</span>
                            </div>
                          )}
                          {deal.salesRankDrops30 !== undefined && deal.salesRankDrops30 !== null && (
                            <div className="text-blue-600 dark:text-blue-400 font-medium">
                              {deal.salesRankDrops30} sales/mo
                            </div>
                          )}
                          {deal.salesRank && (
                            <div className="text-neutral-400">
                              Rank #{deal.salesRank >= 1000000 ? `${(deal.salesRank / 1000000).toFixed(1)}M` : deal.salesRank >= 1000 ? `${Math.round(deal.salesRank / 1000)}K` : deal.salesRank}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-2xl font-semibold text-neutral-900 dark:text-white">
                              {formatPrice(deal.ebayPrice)}
                            </div>
                            {deal.buyBoxPrice && (
                              <div className="text-sm text-neutral-400">
                                → {formatPrice(deal.buyBoxPrice)} on Amazon
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-neutral-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                            Details
                            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-lg mb-12">
                <BookOpen className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" strokeWidth={1} />
                <p className="text-neutral-500">No featured deals available right now.</p>
              </div>
            )}

            <div className="text-center py-8 border-t border-neutral-200 dark:border-neutral-800">
              <p className="text-neutral-400 text-sm">
                Or search for specific books above
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Book Detail Modal */}
      {selectedDeal && (
        <BookDetailModal
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </main>
  );
}
