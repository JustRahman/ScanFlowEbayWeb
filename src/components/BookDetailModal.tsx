'use client';

import { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  BarChart3,
  Users,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  BookOpen,
  ShoppingCart,
} from 'lucide-react';
import Image from 'next/image';

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
}

interface KeepaProduct {
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
}

interface Analysis {
  fbaProfit: number;
  fbmProfit: number;
  fbaRoi: number;
  fbmRoi: number;
  referralFee: number;
  fulfillmentFee: number;
  decision: 'BUY' | 'REVIEW' | 'REJECT';
  reason: string;
  score: number;
  sellPrice: number;
}

interface BookDetailModalProps {
  deal: Deal;
  onClose: () => void;
}

export function BookDetailModal({ deal, onClose }: BookDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<KeepaProduct | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!deal.isbn) {
      setError('No ISBN available for this book');
      setLoading(false);
      return;
    }

    async function fetchAmazonData() {
      try {
        const response = await fetch('/api/keepa/product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isbn: deal.isbn,
            ebayPrice: deal.ebayPrice,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to fetch Amazon data');
        }

        const data = await response.json();
        setProduct(data.product);
        setAnalysis(data.analysis);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchAmazonData();
  }, [deal.isbn, deal.ebayPrice]);

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatRank = (rank: number) => {
    if (rank >= 1000000) return `${(rank / 1000000).toFixed(1)}M`;
    if (rank >= 1000) return `${Math.round(rank / 1000)}K`;
    return rank.toString();
  };

  const getDecisionColor = (decision: string) => {
    switch (decision) {
      case 'BUY': return 'bg-emerald-500';
      case 'REVIEW': return 'bg-amber-500';
      case 'REJECT': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getDecisionIcon = (decision: string) => {
    switch (decision) {
      case 'BUY': return <CheckCircle className="w-6 h-6" />;
      case 'REVIEW': return <AlertTriangle className="w-6 h-6" />;
      case 'REJECT': return <XCircle className="w-6 h-6" />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Book Details</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Book Info Header */}
          <div className="flex gap-6 mb-8">
            <div className="w-32 h-44 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
              {(product?.imageUrl || deal.ebayImage) ? (
                <Image
                  src={product?.imageUrl || deal.ebayImage || ''}
                  alt={deal.ebayTitle}
                  width={128}
                  height={176}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="w-12 h-12 text-gray-300" strokeWidth={1} />
                </div>
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2">
                {product?.title || deal.ebayTitle}
              </h3>
              {deal.isbn && (
                <p className="text-base text-gray-500 font-mono mb-2">ISBN: {deal.isbn}</p>
              )}
              {product?.asin && (
                <p className="text-base text-gray-500 font-mono mb-3">ASIN: {product.asin}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <a
                  href={deal.ebayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors border border-blue-200"
                >
                  <ShoppingCart className="w-4 h-4" />
                  eBay
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {product?.asin && (
                  <a
                    href={`https://www.amazon.com/dp/${product.asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors border border-amber-200"
                  >
                    <Package className="w-4 h-4" />
                    Amazon
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 text-blue-400 animate-spin mb-4" />
              <p className="text-gray-500 text-lg">Fetching Amazon data...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertTriangle className="w-14 h-14 text-amber-500 mb-4" />
              <p className="text-gray-600 text-lg mb-2">{error}</p>
              <p className="text-base text-gray-400">Amazon data unavailable for this book.</p>
            </div>
          ) : (
            <>
              {/* Decision Banner */}
              {analysis && (
                <div className={`${getDecisionColor(analysis.decision)} text-white rounded-lg p-5 mb-6`}>
                  <div className="flex items-center gap-3">
                    {getDecisionIcon(analysis.decision)}
                    <div>
                      <div className="font-bold text-xl">{analysis.decision}</div>
                      <div className="text-white/90 text-base">{analysis.reason}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-3xl font-bold">{analysis.score}</div>
                      <div className="text-white/80 text-sm">Score</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Price Comparison */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                {/* eBay Card */}
                <div className="bg-gray-50 rounded-lg p-5 border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" />
                    eBay (Buy Price)
                  </h4>
                  <div className="text-3xl font-bold text-gray-900 mb-2">
                    {formatPrice(deal.ebayPrice)}
                  </div>
                  <div className="text-base text-gray-500 space-y-1">
                    <div>Seller: {deal.ebaySeller}</div>
                    <div>Condition: {deal.ebayCondition}</div>
                    {deal.ebaySellerRating && <div>Rating: {deal.ebaySellerRating}%</div>}
                  </div>
                </div>

                {/* Amazon Card */}
                <div className="bg-gray-50 rounded-lg p-5 border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Amazon (Sell Price)
                  </h4>
                  <div className="text-3xl font-bold text-gray-900 mb-2">
                    {product?.buyBoxPrice ? formatPrice(product.buyBoxPrice) : 'N/A'}
                  </div>
                  <div className="text-base text-gray-500 space-y-1">
                    {product?.newFbaPrice && <div>New FBA: {formatPrice(product.newFbaPrice)}</div>}
                    {product?.usedPrice && <div>Used: {formatPrice(product.usedPrice)}</div>}
                    {product?.isAmazon && <div className="text-amber-600 font-semibold">Warning: Amazon is selling</div>}
                  </div>
                </div>
              </div>

              {/* Profit Analysis */}
              {analysis && (
                <div className="bg-gray-50 rounded-lg p-5 mb-6 border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-500 mb-4 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Profit Analysis
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-400 mb-1">FBA Profit</div>
                      <div className={`text-2xl font-bold ${analysis.fbaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatPrice(analysis.fbaProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">FBA ROI</div>
                      <div className={`text-2xl font-bold ${analysis.fbaRoi >= 30 ? 'text-emerald-600' : 'text-gray-600'}`}>
                        {analysis.fbaRoi}%
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">FBM Profit</div>
                      <div className={`text-2xl font-bold ${analysis.fbmProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatPrice(analysis.fbmProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">FBM ROI</div>
                      <div className={`text-2xl font-bold ${analysis.fbmRoi >= 30 ? 'text-emerald-600' : 'text-gray-600'}`}>
                        {analysis.fbmRoi}%
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-400">
                    <div className="flex justify-between">
                      <span>Referral Fee (15%)</span>
                      <span>{formatPrice(analysis.referralFee)}</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span>FBA Fulfillment</span>
                      <span>{formatPrice(analysis.fulfillmentFee)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sales Metrics */}
              {product && (
                <div className="grid md:grid-cols-3 gap-4 mb-6">
                  {/* Rank */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4" />
                      Sales Rank
                    </h4>
                    <div className="text-2xl font-bold text-gray-900">
                      #{product.salesRank ? formatRank(product.salesRank) : 'N/A'}
                    </div>
                    {product.salesRank90DayAvg && (
                      <div className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                        90d avg: #{formatRank(product.salesRank90DayAvg)}
                        {product.salesRank && product.salesRank < product.salesRank90DayAvg ? (
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                        ) : product.salesRank && product.salesRank > product.salesRank90DayAvg ? (
                          <TrendingDown className="w-4 h-4 text-red-500" />
                        ) : (
                          <Minus className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sales Velocity */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      Sales Velocity
                    </h4>
                    <div className="text-2xl font-bold text-gray-900">
                      {product.salesRankDrops30 ?? product.daysWithSales30}/mo
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {product.daysWithSales90} days with sales (90d)
                    </div>
                  </div>

                  {/* Competition */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      Competition
                    </h4>
                    <div className="text-2xl font-bold text-gray-900">
                      {product.fbaOfferCount} FBA
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {product.newOfferCount} new, {product.usedOfferCount} used
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Info */}
              {product && (
                <div className="bg-gray-50 rounded-lg p-5 border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-400 mb-3">Additional Information</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-base">
                    {product.category && (
                      <div>
                        <div className="text-gray-400 text-sm">Category</div>
                        <div className="text-gray-900 font-medium">{product.category}</div>
                      </div>
                    )}
                    {product.rating && (
                      <div>
                        <div className="text-gray-400 text-sm">Rating</div>
                        <div className="text-gray-900 font-medium">
                          {(product.rating / 10).toFixed(1)} ({product.reviewCount} reviews)
                        </div>
                      </div>
                    )}
                    {product.avgPrice90 && (
                      <div>
                        <div className="text-gray-400 text-sm">Avg Price (90d)</div>
                        <div className="text-gray-900 font-medium">{formatPrice(product.avgPrice90)}</div>
                      </div>
                    )}
                    {product.outOfStockPercentage90 !== null && product.outOfStockPercentage90 >= 0 && (
                      <div>
                        <div className="text-gray-400 text-sm">Out of Stock (90d)</div>
                        <div className="text-gray-900 font-medium">{Math.round(product.outOfStockPercentage90)}%</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
