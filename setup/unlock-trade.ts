import "dotenv/config";
import { Box } from "@upstash/box";

const AGENTS = ["claude", "gemini", "openai"];

async function main() {
  for (const agent of AGENTS) {
    const box = await Box.getByName(`botstreet-${agent}`);
    const raw = await box.files.read(`/workspace/home/agents/${agent}/portfolio.json`);
    const portfolio = JSON.parse(raw);

    if (!portfolio.last_trade_date) {
      console.log(`${agent}: no last_trade_date, already unlocked`);
      continue;
    }

    const tradeDate = portfolio.last_trade_date;

    // Ensure today's snapshot exists in history before unlocking
    const snapshotFile = `portfolio_${tradeDate.replace(/-/g, "_")}.json`;
    const snapshotPath = `/workspace/home/agents/${agent}/history/${snapshotFile}`;
    try {
      await box.files.read(snapshotPath);
      console.log(`${agent}: snapshot ${snapshotFile} already exists`);
    } catch {
      // No snapshot yet — save current state as one
      const today_trades_raw = await box.files.read(`/workspace/home/agents/${agent}/today_trades.json`).catch(() => "[]");
      const snapshot = {
        date: tradeDate,
        day_number: portfolio.day_number,
        cash: portfolio.cash,
        holdings: portfolio.holdings,
        total_value: portfolio.total_value,
        all_time_return_pct: portfolio.all_time_return_pct,
        trades: JSON.parse(today_trades_raw),
      };
      await box.files.write({ path: snapshotPath, content: JSON.stringify(snapshot, null, 2) });
      console.log(`${agent}: saved snapshot ${snapshotFile}`);
    }

    // Clear today_trades and unlock
    await box.files.write({ path: `/workspace/home/agents/${agent}/today_trades.json`, content: "[]" });
    portfolio.last_trade_date = null;
    await box.files.write({
      path: `/workspace/home/agents/${agent}/portfolio.json`,
      content: JSON.stringify(portfolio, null, 2),
    });
    console.log(`${agent}: unlocked (was ${tradeDate})`);
  }
}

main().catch(console.error);
