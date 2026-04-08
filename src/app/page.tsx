'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Direct Supabase REST API — same approach as ScanFlow-ScapWeb
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const TABLE = process.env.NEXT_PUBLIC_TURKISH === 'ZUBEYR' ? 'ebay_books_zubeyr' : 'ebay_books';
const BF_TABLE = 'bookfinder_deals';
const AM_TABLE = 'amazon_books';
const CB_TABLE = 'christianbook_books';
const EN_TABLE = 'ebay_books_new';
const KP_TABLE = 'keepa_books';


const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

type Seller = 'booksrun' | 'oneplanetbooks' | 'thriftbooks.store' | 'betterworldbooks' | 'greenworldbooks' | 'greatbookprices1' | 'betterworldbookswest' | 'zuber' | 'baystatebooks' | 'Awesomebooksusa' | 'goodwillswpa' | 'goodwillbks';
type ActiveSource = Seller | 'bookfinder' | 'amazon' | 'christianbook' | 'ebay_new' | 'keepa';
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
  quantity: number | null;
  display: number;
  displayed: number;
  displayed_at: string | null;
  seller_url: string | null;
  amazon_url: string | null;
  best_offer_price: number | null;
  best_offer_seller: string | null;
  // BooksFinder fields
  url?: string;
  edition?: string;
  pounds?: number;
  source_scraped_at?: string;
  _source?: 'ebay' | 'bookfinder' | 'amazon' | 'christianbook' | 'ebay_new' | 'keepa';
  source_url?: string;
}

const SELLERS: { id: Seller; label: string }[] = [
  { id: 'booksrun', label: 'BooksRun' },
  { id: 'oneplanetbooks', label: 'OnePlanetBooks' },
  { id: 'thriftbooks.store', label: 'ThriftBooks' },

  { id: 'betterworldbooks', label: 'BWB' },
  { id: 'greenworldbooks', label: 'GreenWorld' },
  { id: 'greatbookprices1', label: 'GreatBookPrices' },
  { id: 'betterworldbookswest', label: 'BWB West' },
  { id: 'zuber', label: 'Zuber' },
  { id: 'baystatebooks', label: 'BayState' },
  { id: 'Awesomebooksusa', label: 'AwesomeBooks' },
  { id: 'goodwillswpa', label: 'GoodWill SWPA' },
  { id: 'goodwillbks', label: 'GoodWill BKS' },
];

function getMarketplace(url: string): string {
  if (url.includes('ebay.com')) return 'eBay';
  if (url.includes('alibris.com')) return 'Alibris';
  if (url.includes('booksrun.com')) return 'BooksRun';
  if (url.includes('abebooks.com')) return 'AbeBooks';
  if (url.includes('thriftbooks.com')) return 'ThriftBooks';
  if (url.includes('betterworldbooks.com')) return 'BWB';
  if (url.includes('textbookrush.com')) return 'TxtbkRush';
  return 'Store';
}

function numericItemId(id: string): string {
  return id.includes('|') ? id.split('|')[1] : id;
}

const PASSWORD_CLIENT = process.env.NEXT_PUBLIC_PASSWORD || '131313';
const PASSWORD_GHOST = '456456';

export default function Home() {
  const [authed, setAuthed] = useState(() => {
    if (typeof window !== 'undefined') {
      // Invalidate old sessions that don't have the version flag
      if (sessionStorage.getItem('scanflow_auth') === '1' && sessionStorage.getItem('scanflow_v') !== '2') {
        sessionStorage.removeItem('scanflow_auth');
        sessionStorage.removeItem('scanflow_ghost');
        return false;
      }
      return sessionStorage.getItem('scanflow_auth') === '1';
    }
    return false;
  });
  const [isGhost, setIsGhost] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('scanflow_ghost') === '1';
    return false;
  });
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);

  const [loading, setLoading] = useState(true);
  const [activeSeller, setActiveSeller] = useState<ActiveSource>('booksrun');
  const clickedIsbns = useRef<Set<string>>(new Set());
  const lastClickedBook = useRef<{ id: number; isbn: string; seller: string; _source?: string } | null>(null);
  const [buyModalBook, setBuyModalBook] = useState<{ id: number; isbn: string; seller: string; _source?: string } | null>(null);
  const [buyQuantity, setBuyQuantity] = useState('1');
  const [notifySent, setNotifySent] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('BUY');
  const [priceFilters, setPriceFilters] = useState<PriceFilter[]>(['all']);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [weightFilter, setWeightFilter] = useState<WeightFilter>('all');
  const [minProfit, setMinProfit] = useState('');
  const [minRoi, setMinRoi] = useState('');
  const [hasanFilter, setHasanFilter] = useState(true);
  const [cheapOpen, setCheapOpen] = useState(true);
  const [expensiveOpen, setExpensiveOpen] = useState(true);

  // Store all books per seller for counts
  const [allBooksrun, setAllBooksrun] = useState<Book[]>([]);
  const [allOneplanet, setAllOneplanet] = useState<Book[]>([]);
  const [allThriftbooks, setAllThriftbooks] = useState<Book[]>([]);

  const [allBwb, setAllBwb] = useState<Book[]>([]);
  const [allGreenworld, setAllGreenworld] = useState<Book[]>([]);
  const [allGreatbook, setAllGreatbook] = useState<Book[]>([]);
  const [allBwbWest, setAllBwbWest] = useState<Book[]>([]);
  const [allZuber, setAllZuber] = useState<Book[]>([]);
  const [allBaystate, setAllBaystate] = useState<Book[]>([]);
  const [allAwesome, setAllAwesome] = useState<Book[]>([]);
  const [allGoodwill, setAllGoodwill] = useState<Book[]>([]);
  const [allGoodwillBks, setAllGoodwillBks] = useState<Book[]>([]);
  const [allBookfinder, setAllBookfinder] = useState<Book[]>([]);
  const [allAmazon, setAllAmazon] = useState<Book[]>([]);
  const [allChristianbook, setAllChristianbook] = useState<Book[]>([]);
  const [allEbayNew, setAllEbayNew] = useState<Book[]>([]);
  const [allKeepa, setAllKeepa] = useState<Book[]>([]);
  const [unseenIds, setUnseenIds] = useState<Set<string>>(new Set());
  const [zubeyrBoughtCount, setZubeyrBoughtCount] = useState<number | null>(null);

  // ── Stats counts (lightweight, no full rows) ──
  const [statCounts, setStatCounts] = useState<Record<ActiveSource, { total: number; buy: number; review: number; reject: number; bought: number; today: number }>>({
    booksrun: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    oneplanetbooks: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    'thriftbooks.store': { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    betterworldbooks: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    greenworldbooks: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    greatbookprices1: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    betterworldbookswest: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    zuber: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    baystatebooks: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    Awesomebooksusa: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    goodwillswpa: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    goodwillbks: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    bookfinder: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    amazon: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    christianbook: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    ebay_new: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
    keepa: { total: 0, buy: 0, review: 0, reject: 0, bought: 0, today: 0 },
  });

  // ── Fetch all BUY + REVIEW books for a seller (real-time, no rotation) ──
  const fetchBooksForSeller = useCallback(async (seller: string): Promise<Book[]> => {
    try {
      const idFilter = process.env.NEXT_PUBLIC_TURKISH === 'HASAN' ? '&id=gte.18658' : '';
      const fetches: Promise<Response>[] = [
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc,id.desc&seller=eq.${encodeURIComponent(seller)}&decision=eq.BUY${idFilter}`, {
          headers: HEADERS
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc,id.desc&seller=eq.${encodeURIComponent(seller)}&decision=eq.REVIEW${idFilter}`, {
          headers: HEADERS
        }),
      ];
      // For greatbookprices1, also fetch REJECT books
      if (seller === 'greatbookprices1') {
        fetches.push(
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc,id.desc&seller=eq.${encodeURIComponent(seller)}&decision=eq.REJECT${idFilter}`, {
            headers: HEADERS
          })
        );
      }
      const responses = await Promise.all(fetches);
      const buy: Book[] = responses[0].ok ? await responses[0].json() : [];
      const review: Book[] = responses[1].ok ? await responses[1].json() : [];
      const reject: Book[] = responses[2]?.ok ? await responses[2].json() : [];
      return [...buy, ...review, ...reject];
    } catch (error) {
      console.error(`Error fetching ${seller}:`, error);
      return [];
    }
  }, []);

  // ── Fetch BooksFinder books (bookfinder_deals table, prices in dollars → convert to cents) ──
  const fetchBookfinderBooks = useCallback(async (): Promise<Book[]> => {
    try {
      const [buyRes, reviewRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=*&order=source_scraped_at.desc&decision=eq.BUY`, {
          headers: HEADERS
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=*&order=source_scraped_at.desc&decision=eq.REVIEW`, {
          headers: HEADERS
        }),
      ]);
      const buy = buyRes.ok ? await buyRes.json() : [];
      const review = reviewRes.ok ? await reviewRes.json() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [...buy, ...review].map((b: any) => ({
        ...b,
        price: Math.round((b.price || 0) * 100),
        amazon_price: b.amazon_price ? Math.round(b.amazon_price * 100) : null,
        fbm_profit: b.fbm_profit ? Math.round(b.fbm_profit * 100) : null,
        book_type: b.edition || null,
        weight_oz: b.pounds ? b.pounds * 16 : null,
        ebay_url: b.url || '',
        ebay_item_id: '',
        shipping: 0,
        category: '',
        _source: 'bookfinder' as const,
      }));
    } catch (error) {
      console.error('Error fetching bookfinder:', error);
      return [];
    }
  }, []);

  // ── Fetch Amazon books (amazon_books table, no displayed column, fetch all BUY+REVIEW) ──
  const fetchAmazonBooks = useCallback(async (): Promise<Book[]> => {
    try {
      const [buyRes, reviewRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=*&order=created_at.desc&decision=eq.BUY`, {
          headers: HEADERS
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=*&order=created_at.desc&decision=eq.REVIEW`, {
          headers: HEADERS
        }),
      ]);
      const buy = buyRes.ok ? await buyRes.json() : [];
      const review = reviewRes.ok ? await reviewRes.json() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [...buy, ...review].map((b: any) => ({
        ...b,
        price: Math.round((b.buy_price || 0) * 100),
        amazon_price: b.amazon_price ? Math.round(b.amazon_price * 100) : null,
        sales_rank_drops_30: b.drops_30 ?? null,
        sales_rank_drops_90: b.drops_90 ?? null,
        ebay_url: '',
        ebay_item_id: '',
        shipping: 0,
        category: b.category || '',
        book_type: null,
        weight_oz: null,
        condition: null,
        seller: 'Amazon',
        displayed: 1,
        _source: 'amazon' as const,
      }));
    } catch (error) {
      console.error('Error fetching amazon:', error);
      return [];
    }
  }, []);

  // ── Fetch ChristianBook books (prices in cents, no displayed column, fetch all BUY+REVIEW) ──
  const fetchChristianbookBooks = useCallback(async (): Promise<Book[]> => {
    try {
      const [buyRes, reviewRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=*&order=scraped_at.desc&decision=eq.BUY`, {
          headers: HEADERS
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=*&order=scraped_at.desc&decision=eq.REVIEW`, {
          headers: HEADERS
        }),
      ]);
      const buy = buyRes.ok ? await buyRes.json() : [];
      const review = reviewRes.ok ? await reviewRes.json() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [...buy, ...review].map((b: any) => ({
        ...b,
        ebay_url: '',
        ebay_item_id: '',
        shipping: 0,
        category: '',
        book_type: null,
        weight_oz: null,
        condition: 'New',
        seller: 'ChristianBook',
        displayed: 1,
        source_url: b.source_url || null,
        _source: 'christianbook' as const,
      }));
    } catch (error) {
      console.error('Error fetching christianbook:', error);
      return [];
    }
  }, []);

  // ── Fetch eBay New books — books from ebay_books where condition is 'New' ──
  const fetchEbayNewBooks = useCallback(async (): Promise<Book[]> => {
    try {
      const [buyRes, reviewRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc&condition=eq.Brand%20New&decision=eq.BUY`, {
          headers: HEADERS
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=scraped_at.desc&condition=eq.Brand%20New&decision=eq.REVIEW`, {
          headers: HEADERS
        }),
      ]);
      const buy = buyRes.ok ? await buyRes.json() : [];
      const review = reviewRes.ok ? await reviewRes.json() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [...buy, ...review].map((b: any) => ({
        ...b,
        _source: 'ebay_new' as const,
      }));
    } catch (error) {
      console.error('Error fetching ebay_new:', error);
      return [];
    }
  }, []);

  // ── Fetch Keepa books (Used - Like New BUY only) ──
  const fetchKeepaBooks = useCallback(async (): Promise<Book[]> => {
    try {
      const likeNewRes = await fetch(`${SUPABASE_URL}/rest/v1/${KP_TABLE}?select=*&decision=eq.BUY&buy_box_condition=eq.Used%20-%20Like%20New&order=new_180_avg.desc&limit=50`, { headers: HEADERS });
      const likeNewData = likeNewRes.ok ? await likeNewRes.json() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return likeNewData.map((b: any, i: number) => ({
        id: 950000 + i,
        isbn: b.asin,
        title: `[${b.buy_box_seller?.split(' (')[0] ?? 'Keepa'}] ${b.asin}`,
        price: Math.round((b.buy_price ?? 0) * 100),
        amazon_price: Math.round((b.new_180_avg ?? 0) * 100),
        condition: b.buy_box_condition ?? '',
        seller: b.buy_box_seller ?? '',
        category: '',
        ebay_item_id: '',
        ebay_url: b.amazon_url ?? '',
        image_url: b.image_url ?? null,
        shipping: 0,
        scraped_at: b.evaluated_at ?? '',
        decision: b.decision ?? 'BUY',
        asin: b.asin,
        sales_rank: b.sales_rank_current ?? null,
        sales_rank_drops_90: b.drops_90 ?? null,
        fba_profit: null,
        fbm_profit: null,
        amazon_flag: null,
        book_type: null,
        weight_oz: null,
        seller_url: null,
        amazon_url: b.amazon_url ?? null,
        best_offer_price: null,
        best_offer_seller: null,
        evaluated_at: b.evaluated_at ?? null,
        bought_at: b.bought_at ?? null,
        quantity: 1,
        display: 1,
        displayed: 0,
        displayed_at: null,
        sales_rank_drops_30: null,
        fba_roi: null,
        score: null,
        _source: 'keepa' as const,
      }));
    } catch (error) {
      console.error('Error fetching keepa:', error);
      return [];
    }
  }, []);

  // ── Fetch stat counts per seller (single lightweight query) ──
  const fetchStatCounts = useCallback(async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sellers: Seller[] = ['booksrun', 'oneplanetbooks', 'thriftbooks.store', 'betterworldbooks', 'greenworldbooks', 'greatbookprices1', 'betterworldbookswest', 'zuber', 'baystatebooks', 'Awesomebooksusa', 'goodwillswpa', 'goodwillbks'];
      const results = await Promise.all(sellers.map(async (seller) => {
        const [totalRes, buyRes, reviewRes, rejectRes, boughtRes, todayRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}&decision=eq.REVIEW`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}&decision=eq.REJECT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}&decision=eq.BOUGHT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
          fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&seller=eq.${encodeURIComponent(seller)}&bought_at=gte.${twentyFourHoursAgo}`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        ]);
        const parseCount = (res: Response) => {
          const range = res.headers.get('content-range');
          return range ? parseInt(range.split('/')[1]) || 0 : 0;
        };
        return { seller, total: parseCount(totalRes), buy: parseCount(buyRes), review: parseCount(reviewRes), reject: parseCount(rejectRes), bought: parseCount(boughtRes), today: parseCount(todayRes) };
      }));
      const counts = {} as typeof statCounts;
      for (const r of results) counts[r.seller as ActiveSource] = r;
      // Fetch bookfinder stats
      const [bfTotalRes, bfBuyRes, bfReviewRes, bfRejectRes, bfBoughtRes, bfTodayRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id&decision=eq.REVIEW`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id&decision=eq.REJECT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id&decision=eq.BOUGHT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${BF_TABLE}?select=id&bought_at=gte.${twentyFourHoursAgo}`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      const bfParseCount = (res: Response) => {
        const range = res.headers.get('content-range');
        return range ? parseInt(range.split('/')[1]) || 0 : 0;
      };
      counts.bookfinder = {
        total: bfParseCount(bfTotalRes), buy: bfParseCount(bfBuyRes), review: bfParseCount(bfReviewRes),
        reject: bfParseCount(bfRejectRes), bought: bfParseCount(bfBoughtRes), today: bfParseCount(bfTodayRes),
      };
      // Fetch amazon stats
      const [amTotalRes, amBuyRes, amReviewRes, amRejectRes, amBoughtRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=id`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=id&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=id&decision=eq.REVIEW`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=id&decision=eq.REJECT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${AM_TABLE}?select=id&decision=eq.BOUGHT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      counts.amazon = {
        total: bfParseCount(amTotalRes), buy: bfParseCount(amBuyRes), review: bfParseCount(amReviewRes),
        reject: bfParseCount(amRejectRes), bought: bfParseCount(amBoughtRes), today: 0,
      };
      // Fetch christianbook stats
      const [cbTotalRes, cbBuyRes, cbReviewRes, cbRejectRes, cbBoughtRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=id`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=id&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=id&decision=eq.REVIEW`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=id&decision=eq.REJECT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${CB_TABLE}?select=id&decision=eq.BOUGHT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      counts.christianbook = {
        total: bfParseCount(cbTotalRes), buy: bfParseCount(cbBuyRes), review: bfParseCount(cbReviewRes),
        reject: bfParseCount(cbRejectRes), bought: bfParseCount(cbBoughtRes), today: 0,
      };
      // Fetch ebay_new stats (Brand New condition books from ebay_books)
      const [enTotalRes, enBuyRes, enReviewRes, enRejectRes, enBoughtRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&condition=eq.Brand%20New`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&condition=eq.Brand%20New&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&condition=eq.Brand%20New&decision=eq.REVIEW`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&condition=eq.Brand%20New&decision=eq.REJECT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&condition=eq.Brand%20New&decision=eq.BOUGHT`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      counts.ebay_new = {
        total: bfParseCount(enTotalRes), buy: bfParseCount(enBuyRes), review: bfParseCount(enReviewRes),
        reject: bfParseCount(enRejectRes), bought: bfParseCount(enBoughtRes), today: 0,
      };
      // Fetch keepa stats
      const [kpTotalRes, kpBuyRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${KP_TABLE}?select=asin`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${SUPABASE_URL}/rest/v1/${KP_TABLE}?select=asin&decision=eq.BUY`, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      counts.keepa = {
        total: bfParseCount(kpTotalRes), buy: bfParseCount(kpBuyRes), review: 0, reject: 0, bought: 0, today: 0,
      };
      setStatCounts(counts);
    } catch (error) {
      console.error('Error fetching stat counts:', error);
    }
  }, []);

  // ── Load on mount ──
  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const [booksrun, oneplanet, thriftbooks, bwb, greenworld, greatbook, bwbwest, zuber, baystate, awesome, goodwill, goodwillbks, keepaBooks, bookfinder, amazonBooks, cbBooks, ebayNewBooks] = await Promise.all([
        fetchBooksForSeller('booksrun'),
        fetchBooksForSeller('oneplanetbooks'),
        fetchBooksForSeller('thriftbooks.store'),
        fetchBooksForSeller('betterworldbooks'),
        fetchBooksForSeller('greenworldbooks'),
        fetchBooksForSeller('greatbookprices1'),
        fetchBooksForSeller('betterworldbookswest'),
        fetchBooksForSeller('zuber'),
        fetchBooksForSeller('baystatebooks'),
        fetchBooksForSeller('Awesomebooksusa'),
        fetchBooksForSeller('goodwillswpa'),
        fetchBooksForSeller('goodwillbks'),
        fetchKeepaBooks(),
        fetchBookfinderBooks(),
        fetchAmazonBooks(),
        fetchChristianbookBooks(),
        fetchEbayNewBooks(),
      ]);
      setAllBooksrun(booksrun);
      setAllOneplanet(oneplanet);
      setAllThriftbooks(thriftbooks);
      setAllBwb(bwb);
      setAllGreenworld(greenworld);
      setAllGreatbook(greatbook);
      setAllBwbWest(bwbwest);
      setAllZuber(zuber);
      setAllBaystate(baystate);
      setAllAwesome(awesome);
      setAllGoodwill(goodwill);
      setAllGoodwillBks(goodwillbks);
      setAllKeepa(keepaBooks);
      setAllBookfinder(bookfinder);
      setAllAmazon(amazonBooks);
      setAllChristianbook(cbBooks);
      setAllEbayNew(ebayNewBooks);

      // ── Track unseen books via localStorage (client only, ghost skips) ──
      const ghostMode = sessionStorage.getItem('scanflow_ghost') === '1';
      if (!ghostMode) {
        const allLoaded = [
          ...booksrun.map(b => `ebay:${b.id}`),
          ...oneplanet.map(b => `ebay:${b.id}`),
          ...thriftbooks.map(b => `ebay:${b.id}`),
          ...bwb.map(b => `ebay:${b.id}`),
          ...greenworld.map(b => `ebay:${b.id}`),
          ...greatbook.map(b => `ebay:${b.id}`),
          ...bwbwest.map(b => `ebay:${b.id}`),
          ...zuber.map(b => `ebay:${b.id}`),
          ...baystate.map(b => `ebay:${b.id}`),
          ...awesome.map(b => `ebay:${b.id}`),
          ...goodwill.map(b => `ebay:${b.id}`),
          ...goodwillbks.map(b => `ebay:${b.id}`),
          ...bookfinder.map(b => `bf:${b.id}`),
          ...amazonBooks.map(b => `am:${b.id}`),
          ...cbBooks.map(b => `cb:${b.id}`),
          ...ebayNewBooks.map(b => `en:${b.id}`),
        ];
        const stored = localStorage.getItem('scanflow_seen');
        const seenSet = stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
        const unseen = new Set<string>();
        for (const key of allLoaded) {
          if (!seenSet.has(key)) unseen.add(key);
        }
        setUnseenIds(unseen);
        // Save current IDs as seen for next visit
        localStorage.setItem('scanflow_seen', JSON.stringify(allLoaded));
      }

      // ── Fetch Zubeyr bought count ──
      if (process.env.NEXT_PUBLIC_TURKISH === 'ZUBEYR') {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/ebay_books_zubeyr?select=id&decision=eq.BOUGHT`, {
            headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
          });
          const countHeader = res.headers.get('Content-Range');
          const total = countHeader ? parseInt(countHeader.split('/')[1]) : 0;
          setZubeyrBoughtCount(total);
        } catch { /* ignore */ }
      }

      setLoading(false);
    }
    loadAll();
    fetchStatCounts();
  }, [fetchBooksForSeller, fetchBookfinderBooks, fetchAmazonBooks, fetchChristianbookBooks, fetchEbayNewBooks, fetchKeepaBooks, fetchStatCounts]);

  // ── "Did you buy?" modal on tab return ──
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && lastClickedBook.current) {
        setBuyModalBook(lastClickedBook.current);
        lastClickedBook.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── Handle "Yes, I bought it" from modal ──
  const handleBuyConfirm = async () => {
    if (!buyModalBook) return;
    try {
      const table = buyModalBook._source === 'keepa' ? KP_TABLE : buyModalBook._source === 'bookfinder' ? BF_TABLE : buyModalBook._source === 'amazon' ? AM_TABLE : buyModalBook._source === 'christianbook' ? CB_TABLE : TABLE;
      const patchKey = buyModalBook._source === 'keepa' ? `asin=eq.${buyModalBook.isbn}` : `id=eq.${buyModalBook.id}`;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${patchKey}`, {
        method: 'PATCH',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(buyModalBook._source === 'amazon' || buyModalBook._source === 'christianbook' ? { decision: 'BOUGHT', quantity: parseInt(buyQuantity) || 1 } : { decision: 'BOUGHT', bought_at: new Date().toISOString(), quantity: parseInt(buyQuantity) || 1 }),

      });
      if (response.ok) {
        const removeBook = (books: Book[]) => books.filter(b => b.id !== buyModalBook.id);
        const setterMap: Record<ActiveSource, typeof setAllBooksrun> = {
          booksrun: setAllBooksrun,
          oneplanetbooks: setAllOneplanet,
          'thriftbooks.store': setAllThriftbooks,
          betterworldbooks: setAllBwb,
          greenworldbooks: setAllGreenworld,
          greatbookprices1: setAllGreatbook,
          betterworldbookswest: setAllBwbWest,
          zuber: setAllZuber,
          baystatebooks: setAllBaystate,
          Awesomebooksusa: setAllAwesome,
          goodwillswpa: setAllGoodwill,
          goodwillbks: setAllGoodwillBks,
          bookfinder: setAllBookfinder,
          amazon: setAllAmazon,
          christianbook: setAllChristianbook,
          ebay_new: setAllEbayNew,
          keepa: setAllKeepa,
        };
        const source: ActiveSource = buyModalBook._source === 'keepa' ? 'keepa' : buyModalBook._source === 'bookfinder' ? 'bookfinder' : buyModalBook._source === 'amazon' ? 'amazon' : buyModalBook._source === 'christianbook' ? 'christianbook' : buyModalBook._source === 'ebay_new' ? 'ebay_new' : (buyModalBook.seller as Seller);
        if (setterMap[source]) setterMap[source](removeBook);
        setStatCounts(prev => ({
          ...prev,
          [source]: {
            ...prev[source],
            bought: prev[source].bought + 1,
            today: prev[source].today + 1,
            buy: Math.max(0, prev[source].buy - 1),
          },
        }));
      }
    } catch (error) {
      console.error('Error marking as bought:', error);
    }
    setBuyModalBook(null);
    setBuyQuantity('1');
  };

  // ── Active seller's books (derived, no extra state) ──
  const allBooks = useMemo(() => {
    const map: Record<ActiveSource, Book[]> = {
      booksrun: allBooksrun,
      oneplanetbooks: allOneplanet,
      'thriftbooks.store': allThriftbooks,
      betterworldbooks: allBwb,
      greenworldbooks: allGreenworld,
      greatbookprices1: allGreatbook,
      betterworldbookswest: allBwbWest,
      zuber: allZuber,
      baystatebooks: allBaystate,
      Awesomebooksusa: allAwesome,
      goodwillswpa: allGoodwill,
      goodwillbks: allGoodwillBks,
      bookfinder: allBookfinder,
      amazon: allAmazon,
      christianbook: allChristianbook,
      ebay_new: allEbayNew,
      keepa: allKeepa,
    };
    return map[activeSeller];
  }, [activeSeller, allBooksrun, allOneplanet, allThriftbooks, allBwb, allGreenworld, allGreatbook, allBwbWest, allZuber, allBaystate, allAwesome, allGoodwill, allGoodwillBks, allBookfinder, allAmazon, allChristianbook, allEbayNew, allKeepa]);

  // ── Seller counts (BUY count for each) ──
  const sellerCounts = useMemo(() => ({
    booksrun: statCounts.booksrun.buy,
    oneplanetbooks: statCounts.oneplanetbooks.buy,
    'thriftbooks.store': statCounts['thriftbooks.store'].buy,
    betterworldbooks: statCounts.betterworldbooks.buy,
    greenworldbooks: statCounts.greenworldbooks.buy,
    greatbookprices1: statCounts.greatbookprices1.buy,
    betterworldbookswest: statCounts.betterworldbookswest.buy,
    zuber: statCounts.zuber.buy,
    baystatebooks: statCounts.baystatebooks.buy,
    Awesomebooksusa: statCounts.Awesomebooksusa.buy,
    goodwillswpa: statCounts.goodwillswpa.buy,
    goodwillbks: statCounts.goodwillbks.buy,
    bookfinder: statCounts.bookfinder.buy,
    amazon: statCounts.amazon.buy,
    christianbook: statCounts.christianbook.buy,
    ebay_new: statCounts.ebay_new.buy,
    keepa: statCounts.keepa.buy,
  }), [statCounts]);

  // ── Stats (from count queries, not full rows) ──
  const stats = useMemo(() => statCounts[activeSeller], [statCounts, activeSeller]);

  // ── Client-side filtering (decision + all other filters) ──
  const filteredBooks = useMemo(() => {
    return allBooks.filter(book => {
      // Decision filter (was server-side, now client-side)
      if (decisionFilter !== 'all' && book.decision !== decisionFilter) return false;

      // ChristianBook: min $20 Amazon price
      if (activeSeller === 'christianbook' && (book.amazon_price == null || book.amazon_price < 2000)) return false;

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

      // Hasan Filter: 5x+ ROI OR $30+ Amazon price (disabled for ZUBEYR)
      if (hasanFilter && process.env.NEXT_PUBLIC_TURKISH !== 'ZUBEYR') {
        const roi = book.amazon_price && book.price > 0 ? book.amazon_price / book.price : 0;
        const amazonDollars = book.amazon_price ? book.amazon_price / 100 : 0;
        if (roi < 5 && amazonDollars < 30) return false;
      }

      return true;
    });
  }, [allBooks, decisionFilter, searchQuery, priceFilters, formatFilter, weightFilter, minProfit, minRoi, hasanFilter]);

  const cheapBooks = useMemo(() => filteredBooks.filter(b => b.price / 100 < 20), [filteredBooks]);
  const expensiveBooks = useMemo(() => filteredBooks.filter(b => b.price / 100 >= 20), [filteredBooks]);

  // ── Action handler (direct PATCH to Supabase) ──
  async function handleAction(bookId: number, action: 'BOUGHT' | 'REJECT', buttonElement: HTMLButtonElement) {
    const card = buttonElement.closest('.book-card') as HTMLElement;
    if (!card) return;

    const buttons = card.querySelectorAll<HTMLButtonElement>('.action-btn');
    buttons.forEach(btn => btn.disabled = true);
    buttonElement.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-5.07l-2.83 2.83M8.76 15.24l-2.83 2.83m11.31 0l-2.83-2.83M8.76 8.76L5.93 5.93"/></svg>';

    try {
      const updateData: Record<string, string> = { decision: action };
      if (action === 'BOUGHT' && activeSeller !== 'amazon' && activeSeller !== 'christianbook') {
        updateData.bought_at = new Date().toISOString();
      }

      const table = activeSeller === 'keepa' ? KP_TABLE : activeSeller === 'bookfinder' ? BF_TABLE : activeSeller === 'amazon' ? AM_TABLE : activeSeller === 'christianbook' ? CB_TABLE : TABLE;
      const keepaBook = activeSeller === 'keepa' ? allKeepa.find(b => b.id === bookId) : null;
      const patchKey = activeSeller === 'keepa' ? `asin=eq.${keepaBook?.isbn}` : `id=eq.${bookId}`;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${patchKey}`, {
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

      const removeBook = (books: Book[]) => books.filter(b => b.id !== bookId);
      const setterMap: Record<ActiveSource, typeof setAllBooksrun> = {
        booksrun: setAllBooksrun,
        oneplanetbooks: setAllOneplanet,
        'thriftbooks.store': setAllThriftbooks,
        betterworldbooks: setAllBwb,
        greenworldbooks: setAllGreenworld,
        greatbookprices1: setAllGreatbook,
        betterworldbookswest: setAllBwbWest,
        zuber: setAllZuber,
        baystatebooks: setAllBaystate,
        Awesomebooksusa: setAllAwesome,
        goodwillswpa: setAllGoodwill,
        goodwillbks: setAllGoodwillBks,
        bookfinder: setAllBookfinder,
        amazon: setAllAmazon,
        christianbook: setAllChristianbook,
        ebay_new: setAllEbayNew,
        keepa: setAllKeepa,
      };
      setterMap[activeSeller](removeBook);
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
    const dateStr = book.evaluated_at || book.displayed_at;
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return date > twentyFourHoursAgo;
  };

  const recordClick = (bookId: number, isbn: string, seller: string, source?: string) => {
    lastClickedBook.current = { id: bookId, isbn, seller, _source: source };
    const key = source === 'bookfinder' ? `bf:${isbn}` : `${isbn}:${seller}`;
    if (clickedIsbns.current.has(key)) return;
    clickedIsbns.current.add(key);
    if (source === 'amazon' || source === 'christianbook' || source === 'ebay_new' || source === 'keepa') {
      return;
    }
    if (source === 'bookfinder') {
      fetch(`${SUPABASE_URL}/rest/v1/button_clicks_bf`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify({ isbn }),
      }).catch(() => {});
    } else {
      fetch(`${SUPABASE_URL}/rest/v1/book_clicks`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify({ isbn, seller }),
      }).catch(() => {});
    }
  };

  const renderBookCard = (book: Book) => {
    const buyPrice = book.price / 100;
    const amazonPrice = book.amazon_price ? book.amazon_price / 100 : null;
    const bestOfferPrice = book.best_offer_price ? book.best_offer_price / 100 : null;
    const hasSiteLink = book.seller_url && (book.seller === 'booksrun' || book.seller === 'betterworldbooks') && process.env.NEXT_PUBLIC_TURKISH !== 'ZUBEYR';
    const salesRank = book.sales_rank;
    const roi = amazonPrice && buyPrice > 0 ? amazonPrice / buyPrice : null;
    const soldPerMonth = book.sales_rank_drops_90 != null ? Math.round(book.sales_rank_drops_90 / 3) : null;
    const weightLbs = book.weight_oz ? (book.weight_oz / 16).toFixed(1) : null;
    const bookIsNew = isNewBook(book);
    const sourcePrefix = book._source === 'bookfinder' ? 'bf' : book._source === 'amazon' ? 'am' : book._source === 'christianbook' ? 'cb' : book._source === 'ebay_new' ? 'en' : book._source === 'keepa' ? 'kp' : 'ebay';
    const isUnseen = unseenIds.has(`${sourcePrefix}:${book.id}`);

    return (
      <div key={book.id} className={`book-card${isUnseen ? ' unseen' : ''}${process.env.NEXT_PUBLIC_TURKISH === 'ZUBEYR' ? ' zubeyr-large' : ''}`}>
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

          <div className="book-meta">
            {bookIsNew && <span className="badge badge-new">NEW</span>}
            {book._source === 'bookfinder' && <span className="badge badge-source">BF</span>}
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

          <div className="platform-buttons">
            {book.asin ? (
              <a href={`https://www.amazon.com/dp/${book.asin}`} target="_blank" rel="noopener noreferrer" className="platform-btn amazon" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                <span className="platform-name">Buy Box</span>
                <span className="platform-price">{amazonPrice ? `$${amazonPrice.toFixed(2)}` : 'View'}</span>
              </a>
            ) : (
              <span className="platform-btn amazon disabled">
                <span className="platform-name">Buy Box</span>
                <span className="platform-price">N/A</span>
              </span>
            )}
            {book._source === 'amazon' ? null : book._source === 'ebay_new' ? (
              book.ebay_url ? (
                <a href={book.ebay_url} target="_blank" rel="noopener noreferrer" className="platform-btn ebay" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                  <span className="platform-name">eBay New</span>
                  <span className="platform-price">${buyPrice.toFixed(2)}</span>
                </a>
              ) : null
            ) : book._source === 'christianbook' ? (
              book.source_url ? (
                <a href={book.source_url} target="_blank" rel="noopener noreferrer" className="platform-btn website" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                  <span className="platform-name">ChristianBook</span>
                  <span className="platform-price">${buyPrice.toFixed(2)}</span>
                </a>
              ) : null
            ) : book._source === 'bookfinder' ? (
              book.url ? (
                <a href={book.url} target="_blank" rel="noopener noreferrer" className="platform-btn ebay" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                  <span className="platform-name">{getMarketplace(book.url)}</span>
                  <span className="platform-price">${buyPrice.toFixed(2)}</span>
                </a>
              ) : null
            ) : book._source === 'keepa' ? (
              book.ebay_url ? (
                <a href={book.ebay_url} target="_blank" rel="noopener noreferrer" className="platform-btn amazon" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                  <span className="platform-name">Amazon</span>
                  <span className="platform-price">${buyPrice.toFixed(2)}</span>
                </a>
              ) : null
            ) : (
              <>
                <a href={book.ebay_url.includes('|') ? `https://www.ebay.com/itm/${numericItemId(book.ebay_item_id)}` : book.ebay_url} target="_blank" rel="noopener noreferrer"
                  className={`platform-btn ${book.seller === 'thriftbooks.store' ? 'thriftbooks' : book.seller === 'oneplanetbooks' ? 'oneplanet' : 'ebay'}`}
                  onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                  <span className="platform-name">{{booksrun: 'BR eBay', 'thriftbooks.store': 'ThriftBooks', oneplanetbooks: 'OnePlanet', betterworldbooks: 'BWB', greenworldbooks: 'GreenWorld', greatbookprices1: 'GBP eBay', betterworldbookswest: 'BWB West', zuber: 'Zuber', baystatebooks: 'BayState', Awesomebooksusa: 'AwesomeBooks', goodwillswpa: 'GoodWill SWPA', goodwillbks: 'GoodWill BKS'}[book.seller] || book.seller}</span>
                  <span className="platform-price">${buyPrice.toFixed(2)}</span>
                </a>
                {hasSiteLink && (
                  <a href={book.seller_url!} target="_blank" rel="noopener noreferrer" className="platform-btn website" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                    <span className="platform-name">{book.seller === 'booksrun' ? 'BooksRun' : 'BWB'} Site</span>
                    <span className="platform-price">View</span>
                  </a>
                )}
                {book.amazon_url && process.env.NEXT_PUBLIC_TURKISH !== 'ZUBEYR' && (
                  <a href={book.amazon_url} target="_blank" rel="noopener noreferrer" className="platform-btn amazon-seller" onClick={() => recordClick(book.id, book.isbn, book.seller, book._source)}>
                    <span className="platform-name">{book.best_offer_seller || 'Amazon Seller'}</span>
                    <span className="platform-price">{bestOfferPrice ? `$${bestOfferPrice.toFixed(2)}` : 'View'}</span>
                  </a>
                )}
              </>
            )}
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
  };

  if (!authed) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}>
        <div style={{
          background: '#fff', borderRadius: '1rem', padding: '2.5rem 2rem',
          width: '360px', textAlign: 'center', boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
        }}>
          <h1 style={{ fontSize: '1.75rem', color: '#333', marginBottom: '0.5rem' }}>ScanFlow</h1>
          <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Enter password to continue</p>
          <form onSubmit={e => {
            e.preventDefault();
            if (pw === PASSWORD_CLIENT || pw === PASSWORD_GHOST) {
              sessionStorage.setItem('scanflow_auth', '1');
              sessionStorage.setItem('scanflow_v', '2');
              if (pw === PASSWORD_GHOST) {
                sessionStorage.setItem('scanflow_ghost', '1');
                setIsGhost(true);
              } else {
                sessionStorage.removeItem('scanflow_ghost');
                setIsGhost(false);
              }
              setAuthed(true);
            } else {
              setPwError(true);
              setPw('');
            }
          }}>
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setPwError(false); }}
              placeholder="Password"
              autoFocus
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: '0.5rem',
                border: `1px solid ${pwError ? '#e74c3c' : '#ddd'}`, fontSize: '1rem',
                outline: 'none', marginBottom: '0.75rem', boxSizing: 'border-box',
              }}
            />
            {pwError && <p style={{ color: '#e74c3c', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Wrong password</p>}
            <button type="submit" style={{
              width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: 'none',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
            }}>Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Zubeyr bought counter */}
      {process.env.NEXT_PUBLIC_TURKISH === 'ZUBEYR' && (
        <div style={{ padding: '10px 20px', textAlign: 'center' }}>
          Total Bought: {zubeyrBoughtCount ?? '...'} books
        </div>
      )}
      {/* Header */}
      <div className="header">
        <h1>{activeSeller === 'bookfinder' ? 'BooksFinder' : activeSeller === 'amazon' ? 'Amazon' : activeSeller === 'christianbook' ? 'ChristianBook' : activeSeller === 'ebay_new' ? 'eBay New' : activeSeller === 'keepa' ? 'Keepa' : (SELLERS.find(s => s.id === activeSeller)?.label ?? activeSeller)} Deals</h1>
        <p>{activeSeller === 'bookfinder' ? 'Books from BooksFinder' : activeSeller === 'amazon' ? 'Books from Amazon' : activeSeller === 'christianbook' ? 'Books from ChristianBook.com' : activeSeller === 'ebay_new' ? 'New books from eBay' : activeSeller === 'keepa' ? 'Top BUY books from Keepa' : `Books from ${SELLERS.find(s => s.id === activeSeller)?.label ?? activeSeller} on eBay`}</p>

        <div className="source-toggle-container">
          <div className="source-toggle-group">
            <div className="source-toggle-label">eBay Sellers</div>
            <div className="source-toggle">
              {SELLERS.map(s => (
                <button
                  key={s.id}
                  className={`source-btn ${activeSeller === s.id ? 'active' : ''}`}
                  onClick={() => { setActiveSeller(s.id); setHasanFilter(true); }}
                >
                  {s.label}
                  <span className="count">{sellerCounts[s.id] ?? '-'}</span>
                </button>
              ))}
              <button
                key="ebay_new"
                className={`source-btn ${activeSeller === 'ebay_new' ? 'active' : ''}`}
                onClick={() => { setActiveSeller('ebay_new'); setHasanFilter(false); }}
              >
                eBay New
                <span className="count">{sellerCounts.ebay_new ?? '-'}</span>
              </button>
            </div>
          </div>
          {process.env.NEXT_PUBLIC_TURKISH !== 'ZUBEYR' && (
          <div className="source-toggle-group">
            <div className="source-toggle-label">Other Sources</div>
            <div className="source-toggle">
              <button
                key="bookfinder"
                className={`source-btn ${activeSeller === 'bookfinder' ? 'active' : ''}`}
                onClick={() => { setActiveSeller('bookfinder'); setHasanFilter(true); }}
              >
                BooksFinder
                <span className="count">{sellerCounts.bookfinder ?? '-'}</span>
              </button>
              <button
                key="christianbook"
                className={`source-btn ${activeSeller === 'christianbook' ? 'active' : ''}`}
                onClick={() => { setActiveSeller('christianbook'); setHasanFilter(false); }}
              >
                ChristianBook
                <span className="count">{sellerCounts.christianbook ?? '-'}</span>
              </button>
              <button
                key="keepa"
                className={`source-btn ${activeSeller === 'keepa' ? 'active' : ''}`}
                onClick={() => { setActiveSeller('keepa'); setHasanFilter(false); }}
              >
                Keepa
                <span className="count">{sellerCounts.keepa ?? '-'}</span>
              </button>
            </div>
          </div>
          )}
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
        </div>

        <button
          disabled={notifySent}
          onClick={async () => {
            setNotifySent(true);
            const seller = activeSeller === 'bookfinder' ? 'BooksFinder' : activeSeller === 'amazon' ? 'Amazon' : activeSeller === 'christianbook' ? 'ChristianBook' : activeSeller === 'ebay_new' ? 'eBay New' : activeSeller === 'keepa' ? 'Keepa' : (SELLERS.find(s => s.id === activeSeller)?.label ?? activeSeller);
            await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ seller }),
            }).catch(() => {});
          }}
          style={{
            marginTop: '1rem', padding: '0.6rem 1.5rem', borderRadius: '50px',
            border: 'none', background: notifySent ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.25)',
            color: '#fff', cursor: notifySent ? 'default' : 'pointer', fontSize: '0.9rem',
            fontWeight: 500, transition: 'background 0.15s',
            opacity: notifySent ? 0.6 : 1,
          }}
        >
          {notifySent ? 'Notified!' : 'Notify — Ready for new books'}
        </button>
      </div>

      {/* "Did you buy?" Modal */}
      {buyModalBook && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => { setBuyModalBook(null); setBuyQuantity('1'); }}>
          <div style={{
            background: '#fff', borderRadius: '1rem', padding: '2.5rem 2rem',
            minWidth: '360px', maxWidth: '420px',
            textAlign: 'center', boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
            animation: 'modalIn 0.2s ease-out',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.75rem', color: '#333' }}>Did you buy this book?</div>
            <div style={{
              display: 'inline-block', background: '#f0f0f5', borderRadius: '0.5rem',
              padding: '0.4rem 1rem', color: '#555', fontSize: '0.95rem', marginBottom: '1.25rem',
              fontFamily: 'monospace', letterSpacing: '0.5px',
            }}>
              ISBN: {buyModalBook.isbn}
            </div>
            <div style={{ marginBottom: '0.5rem', textAlign: 'left' }}>
              <label style={{ fontSize: '0.85rem', color: '#666', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
                Quantity
              </label>
              <input
                type="number"
                min="1"
                value={buyQuantity}
                onChange={e => setBuyQuantity(e.target.value)}
                style={{
                  width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem',
                  border: '1px solid #ddd', fontSize: '1rem', outline: 'none',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '1.5rem', textAlign: 'left', lineHeight: 1.5 }}>
              Abi, bu bir ISBN numarasına ait kitaptan kaç kopya satın aldığını gösteriyor (örneğin, 9785838538394 numaralı kitaptan 5 kopya aldın).
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={() => { setBuyModalBook(null); setBuyQuantity('1'); }}
                style={{
                  padding: '0.75rem 2rem', borderRadius: '0.5rem',
                  border: '1px solid #ddd', background: '#f5f5f5',
                  color: '#333', cursor: 'pointer', fontSize: '1rem',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#eee')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f5f5f5')}
              >No</button>
              <button
                onClick={handleBuyConfirm}
                style={{
                  padding: '0.75rem 2rem', borderRadius: '0.5rem', border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#fff', cursor: 'pointer', fontSize: '1rem', fontWeight: 600,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >Yes, I bought it</button>
            </div>
          </div>
        </div>
      )}

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

          {process.env.NEXT_PUBLIC_TURKISH !== 'ZUBEYR' && (
          <div className="filter-section">
            <div className="filter-title">Hasan Filter</div>
            <div className="filter-options">
              <div
                className={`filter-toggle ${hasanFilter ? 'active' : ''}`}
                onClick={() => setHasanFilter(!hasanFilter)}
              >
                <span className="checkbox" />
                <span className="label">5x+ ROI or $30+ Amazon</span>
              </div>
            </div>
          </div>
          )}

          <div className="filter-section">
            <div className="filter-title">Decision</div>
            <div className="filter-options">
              {(process.env.NEXT_PUBLIC_TURKISH === 'ZUBEYR' ? ['all', 'BUY', 'REVIEW', 'REJECT'] as DecisionFilter[] : ['all', 'BUY', 'REJECT'] as DecisionFilter[]).map(d => (
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
            <>
              {cheapBooks.length > 0 && (
                <div className="price-section">
                  <button className="section-toggle" onClick={() => setCheapOpen(!cheapOpen)}>
                    <span className="section-arrow">{cheapOpen ? '\u25BC' : '\u25B6'}</span>
                    <span className="section-title">Under $20</span>
                    <span className="section-count">{cheapBooks.length}</span>
                  </button>
                  {cheapOpen && (
                    <div className="books-grid" key={`${activeSeller}-cheap`}>
                      {cheapBooks.map(book => renderBookCard(book))}
                    </div>
                  )}
                </div>
              )}
              {expensiveBooks.length > 0 && (
                <div className="price-section">
                  <button className="section-toggle" onClick={() => setExpensiveOpen(!expensiveOpen)}>
                    <span className="section-arrow">{expensiveOpen ? '\u25BC' : '\u25B6'}</span>
                    <span className="section-title">$20+</span>
                    <span className="section-count">{expensiveBooks.length}</span>
                  </button>
                  {expensiveOpen && (
                    <div className="books-grid" key={`${activeSeller}-expensive`}>
                      {expensiveBooks.map(book => renderBookCard(book))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </>
  );
}
