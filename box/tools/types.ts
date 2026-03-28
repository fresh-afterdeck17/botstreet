// ── Path constants ──

export const AGENTS_DIR = process.env.AGENTS_DIR ?? "/workspace/home/agents";

export function portfolioPath(agent: string): string {
  return `${AGENTS_DIR}/${agent}/portfolio.json`;
}

export function historyDir(agent: string): string {
  return `${AGENTS_DIR}/${agent}/history`;
}

export function todayTradesPath(agent: string): string {
  return `${AGENTS_DIR}/${agent}/today_trades.json`;
}

// ── Rounding ──

export function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

// ── Yahoo Finance chart API helper ──

export interface YahooChartMeta {
  symbol: string;
  shortName?: string;
  longName?: string;
  instrumentType: string;
  regularMarketPrice: number;
  regularMarketTime: number;
  currency: string;
}

export async function fetchChart(
  ticker: string,
  range = "1d",
  interval = "1d",
): Promise<{ meta: YahooChartMeta; timestamps: number[]; quotes: any } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });

  if (!res.ok) return null;

  const data = (await res.json()) as any;
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  return {
    meta: result.meta as YahooChartMeta,
    timestamps: result.timestamp ?? [],
    quotes: result.indicators?.quote?.[0] ?? {},
  };
}

// ── Data schemas ──

export interface Holding {
  ticker: string;
  name: string;
  dollars: number;
  shares: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl_pct: number;
}

export interface LastAction {
  summary: string;
  timestamp: string;
}

export interface Portfolio {
  agent: string;
  updated_at: string;
  starting_balance: number;
  cash: number;
  holdings: Holding[];
  total_value: number;
  all_time_return_pct: number;
  day_number: number;
  start_date: string;
  last_action: LastAction | null;
  last_trade_date: string | null;
  last_run_date: string | null;
}

export interface TradeRecord {
  action: "buy" | "sell";
  ticker: string;
  amount: number;
  price: number;
  shares: number;
  reason?: string;
}

export interface HistorySnapshot {
  date: string;
  day_number: number;
  total_value: number;
  cash: number;
  all_time_return_pct: number;
  holdings: {
    ticker: string;
    name: string;
    dollars: number;
    shares: number;
    current_price: number;
  }[];
  trades: TradeRecord[];
}

export interface ValidationResult {
  valid: boolean;
  ticker: string;
  type?: "stock" | "etf" | "metals" | "bond" | "crypto" | "option" | "future" | "unknown";
  name?: string;
  reason?: string;
}

export interface PriceQuote {
  ticker: string;
  price: number;
  name: string;
  timestamp: string;
  market_open?: boolean;
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeResult {
  success: boolean;
  action?: "buy" | "sell";
  ticker?: string;
  amount?: number;
  price?: number;
  shares?: number;
  cash_remaining?: number;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
