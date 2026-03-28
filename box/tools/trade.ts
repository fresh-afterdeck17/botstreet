import { readFileSync, writeFileSync } from "fs";
import { validateTicker } from "./validator.js";
import { getCurrentPrice } from "./prices.js";
import { readPortfolio, writePortfolio } from "./portfolio.js";
import { round, todayTradesPath } from "./types.js";
import type { TradeResult, TradeRecord } from "./types.js";

function readTodayTrades(agent: string): TradeRecord[] {
  try {
    const raw = readFileSync(todayTradesPath(agent), "utf-8");
    return JSON.parse(raw) as TradeRecord[];
  } catch {
    return [];
  }
}

function appendTrade(agent: string, trade: TradeRecord): void {
  const trades = readTodayTrades(agent);
  trades.push(trade);
  writeFileSync(todayTradesPath(agent), JSON.stringify(trades, null, 2));
}

async function executeTrade(
  agent: string,
  ticker: string,
  action: "buy" | "sell",
  amount: number,
  reason?: string,
): Promise<TradeResult> {
  // Check if already traded today (snapshot sets last_trade_date)
  const today = new Date().toISOString().split("T")[0];
  const portfolioCheck = readPortfolio(agent);
  if (portfolioCheck.last_trade_date === today) {
    return { success: false, error: `already traded today (${today}). Run snapshot resets this for the next trading day.` };
  }

  // Validate amount
  if (amount <= 0) {
    return { success: false, error: "amount must be positive" };
  }

  // Validate ticker
  const validation = await validateTicker(ticker);
  if (!validation.valid) {
    return { success: false, error: validation.reason ?? `invalid ticker: ${ticker}` };
  }
  ticker = validation.ticker;

  // Get current price
  let price: number;
  try {
    const quote = await getCurrentPrice(ticker);
    price = quote.price;
  } catch (e: any) {
    return { success: false, error: `failed to get price: ${e.message}` };
  }

  // Read portfolio
  const portfolio = readPortfolio(agent);
  const existingIndex = portfolio.holdings.findIndex((h) => h.ticker === ticker);
  const existing = existingIndex >= 0 ? portfolio.holdings[existingIndex] : null;

  if (action === "buy") {
    // Check sufficient cash
    if (amount > portfolio.cash) {
      return { success: false, error: `insufficient cash: have $${portfolio.cash}, need $${amount}` };
    }

    // Check position size limit (50% of total_value after trade)
    const existingDollars = existing?.dollars ?? 0;
    const newPositionDollars = existingDollars + amount;
    if (newPositionDollars > 0.5 * portfolio.total_value) {
      return {
        success: false,
        error: `position too large: $${newPositionDollars} would exceed 50% of portfolio ($${round(portfolio.total_value * 0.5, 2)})`,
      };
    }

    const sharesBought = round(amount / price, 4);

    if (existing) {
      // Buy into existing position — recalculate avg_entry_price
      const newTotalShares = round(existing.shares + sharesBought, 4);
      const newAvgEntry = round(
        (existing.shares * existing.avg_entry_price + sharesBought * price) / newTotalShares,
        2,
      );
      existing.shares = newTotalShares;
      existing.avg_entry_price = newAvgEntry;
      existing.current_price = round(price, 2);
      existing.dollars = round(existing.shares * existing.current_price, 2);
      existing.unrealized_pnl_pct = round(
        ((existing.current_price - existing.avg_entry_price) / existing.avg_entry_price) * 100,
        2,
      );
    } else {
      // New position
      portfolio.holdings.push({
        ticker,
        name: validation.name ?? ticker,
        dollars: round(sharesBought * price, 2),
        shares: sharesBought,
        avg_entry_price: round(price, 2),
        current_price: round(price, 2),
        unrealized_pnl_pct: 0,
      });
    }

    portfolio.cash = round(portfolio.cash - amount, 2);

    // Record trade
    appendTrade(agent, { action: "buy", ticker, amount, price: round(price, 2), shares: sharesBought, reason });

    // Recalculate totals
    portfolio.total_value = round(
      portfolio.cash + portfolio.holdings.reduce((sum, h) => sum + h.dollars, 0),
      2,
    );
    portfolio.all_time_return_pct = round(
      ((portfolio.total_value - portfolio.starting_balance) / portfolio.starting_balance) * 100,
      2,
    );
    portfolio.updated_at = new Date().toISOString();
    portfolio.last_action = {
      summary: `Bought $${amount} of ${ticker} at $${round(price, 2)}${reason ? `. ${reason}` : ""}`,
      timestamp: new Date().toISOString(),
    };
    portfolio.last_trade_date = today;

    writePortfolio(agent, portfolio);

    return {
      success: true,
      action: "buy",
      ticker,
      amount,
      price: round(price, 2),
      shares: sharesBought,
      cash_remaining: portfolio.cash,
    };
  } else {
    // SELL
    if (!existing) {
      return { success: false, error: `no position in ${ticker} to sell` };
    }

    // Check sell amount against current holding value
    const currentValue = round(existing.shares * price, 2);
    if (amount > currentValue) {
      return { success: false, error: `sell amount $${amount} exceeds position value $${currentValue}` };
    }

    const sharesSold = round(amount / price, 4);

    if (sharesSold >= existing.shares) {
      // Sell entire position
      portfolio.holdings.splice(existingIndex, 1);
    } else {
      // Partial sell — avg_entry_price stays the same
      existing.shares = round(existing.shares - sharesSold, 4);
      existing.current_price = round(price, 2);
      existing.dollars = round(existing.shares * existing.current_price, 2);
      existing.unrealized_pnl_pct = round(
        ((existing.current_price - existing.avg_entry_price) / existing.avg_entry_price) * 100,
        2,
      );
    }

    portfolio.cash = round(portfolio.cash + amount, 2);

    // Record trade
    appendTrade(agent, { action: "sell", ticker, amount, price: round(price, 2), shares: sharesSold, reason });

    // Recalculate totals
    portfolio.total_value = round(
      portfolio.cash + portfolio.holdings.reduce((sum, h) => sum + h.dollars, 0),
      2,
    );
    portfolio.all_time_return_pct = round(
      ((portfolio.total_value - portfolio.starting_balance) / portfolio.starting_balance) * 100,
      2,
    );
    portfolio.updated_at = new Date().toISOString();
    portfolio.last_action = {
      summary: `Sold $${amount} of ${ticker} at $${round(price, 2)}${reason ? `. ${reason}` : ""}`,
      timestamp: new Date().toISOString(),
    };
    portfolio.last_trade_date = today;

    writePortfolio(agent, portfolio);

    return {
      success: true,
      action: "sell",
      ticker,
      amount,
      price: round(price, 2),
      shares: sharesSold,
      cash_remaining: portfolio.cash,
    };
  }
}

// ── CLI entry point ──

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand !== "execute" || args.length < 5) {
  console.log(JSON.stringify({ error: "usage: trade.ts execute <agent> <TICKER> <buy|sell> <amount> [reason...]" }));
  process.exit(1);
}

const agent = args[1];
const ticker = args[2];
const action = args[3] as "buy" | "sell";
const amount = parseFloat(args[4]);
const reason = args.slice(5).join(" ") || undefined;

if (action !== "buy" && action !== "sell") {
  console.log(JSON.stringify({ error: "action must be 'buy' or 'sell'" }));
  process.exit(1);
}

if (isNaN(amount)) {
  console.log(JSON.stringify({ error: "amount must be a number" }));
  process.exit(1);
}

try {
  const result = await executeTrade(agent, ticker, action, amount, reason);
  console.log(JSON.stringify(result, null, 2));
} catch (e: any) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}
