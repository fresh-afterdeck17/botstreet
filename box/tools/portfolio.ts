import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getCurrentPrices } from "./prices.js";
import { round, portfolioPath } from "./types.js";
import type { Portfolio } from "./types.js";

// ── Exported functions ──

export function readPortfolio(agent: string): Portfolio {
  const path = portfolioPath(agent);
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Portfolio;
}

export function writePortfolio(agent: string, portfolio: Portfolio): void {
  const path = portfolioPath(agent);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(portfolio, null, 2));
}

export async function updatePortfolioPrices(agent: string): Promise<Portfolio> {
  const portfolio = readPortfolio(agent);

  if (portfolio.holdings.length === 0) {
    portfolio.updated_at = new Date().toISOString();
    writePortfolio(agent, portfolio);
    return portfolio;
  }

  const tickers = portfolio.holdings.map((h) => h.ticker);
  const prices = await getCurrentPrices(tickers);
  const priceMap = new Map(prices.map((p) => [p.ticker, p.price]));

  for (const holding of portfolio.holdings) {
    const freshPrice = priceMap.get(holding.ticker);
    if (freshPrice && freshPrice > 0) {
      holding.current_price = round(freshPrice, 2);
      holding.dollars = round(holding.shares * holding.current_price, 2);
      holding.unrealized_pnl_pct = round(
        ((holding.current_price - holding.avg_entry_price) / holding.avg_entry_price) * 100,
        2,
      );
    }
  }

  portfolio.total_value = round(
    portfolio.cash + portfolio.holdings.reduce((sum, h) => sum + h.dollars, 0),
    2,
  );
  portfolio.all_time_return_pct = round(
    ((portfolio.total_value - portfolio.starting_balance) / portfolio.starting_balance) * 100,
    2,
  );
  portfolio.updated_at = new Date().toISOString();
  portfolio.last_run_date = new Date().toISOString().split("T")[0];

  writePortfolio(agent, portfolio);
  return portfolio;
}

// ── CLI entry point ──

if (process.argv[1]?.endsWith("portfolio.ts")) {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const agent = args[1];

  if (!subcommand || !agent) {
    console.log(JSON.stringify({ error: "usage: portfolio.ts <get|update_prices> <agent>" }));
    process.exit(1);
  }

  try {
    if (subcommand === "get") {
      const portfolio = readPortfolio(agent);
      console.log(JSON.stringify(portfolio, null, 2));
    } else if (subcommand === "update_prices") {
      const portfolio = await updatePortfolioPrices(agent);
      console.log(JSON.stringify(portfolio, null, 2));
    } else {
      console.log(JSON.stringify({ error: "unknown subcommand. use: get | update_prices" }));
      process.exit(1);
    }
  } catch (e: any) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
