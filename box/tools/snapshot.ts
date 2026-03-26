import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { readPortfolio, writePortfolio } from "./portfolio.js";
import { historyDir, todayTradesPath } from "./types.js";
import type { HistorySnapshot, TradeRecord } from "./types.js";

function readTodayTrades(agent: string): TradeRecord[] {
  try {
    const raw = readFileSync(todayTradesPath(agent), "utf-8");
    return JSON.parse(raw) as TradeRecord[];
  } catch {
    return [];
  }
}

async function saveSnapshot(agent: string): Promise<{ success: boolean; path: string; overwritten: boolean }> {
  const portfolio = readPortfolio(agent);
  const trades = readTodayTrades(agent);

  const today = new Date().toISOString().split("T")[0];
  const dateForFile = today.replace(/-/g, "_");

  const snapshot: HistorySnapshot = {
    date: today,
    day_number: portfolio.day_number,
    total_value: portfolio.total_value,
    cash: portfolio.cash,
    all_time_return_pct: portfolio.all_time_return_pct,
    holdings: portfolio.holdings.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      dollars: h.dollars,
      shares: h.shares,
      current_price: h.current_price,
    })),
    trades,
  };

  const dir = historyDir(agent);
  mkdirSync(dir, { recursive: true });

  const snapshotPath = `${dir}/portfolio_${dateForFile}.json`;
  const alreadyExists = existsSync(snapshotPath);

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  // Clear today's trades
  writeFileSync(todayTradesPath(agent), "[]");

  // Only increment day_number and set last_trade_date on first run of the day
  if (!alreadyExists) {
    portfolio.day_number += 1;
  }
  portfolio.last_trade_date = today;
  writePortfolio(agent, portfolio);

  return { success: true, path: snapshotPath, overwritten: alreadyExists };
}

// ── CLI entry point ──

const args = process.argv.slice(2);
const subcommand = args[0];
const agent = args[1];

if (subcommand !== "save" || !agent) {
  console.log(JSON.stringify({ error: "usage: snapshot.ts save <agent>" }));
  process.exit(1);
}

try {
  const result = await saveSnapshot(agent);
  console.log(JSON.stringify(result, null, 2));
} catch (e: any) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}
