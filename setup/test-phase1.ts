import "dotenv/config";
import { Box } from "@upstash/box";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function parse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function run(box: Box, cmd: string): Promise<any> {
  const result = await box.exec.command(`cd /workspace/home && ${cmd}`);
  return parse(result.result ?? "null");
}

async function main() {
  console.log("=== BotStreet Phase 1 Tests ===\n");

  // ── Setup ──
  console.log("Setting up test box...");
  const box = await Box.create({ runtime: "node" });
  console.log(`Box: ${box.id}\n`);

  // Upload files
  await box.files.upload([
    { path: path.join(ROOT, "box/package.json"), destination: "/workspace/home/package.json" },
    { path: path.join(ROOT, "box/tsconfig.json"), destination: "/workspace/home/tsconfig.json" },
  ]);
  const toolsDir = path.join(ROOT, "box/tools");
  const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));
  await box.files.upload(
    toolFiles.map((f) => ({
      path: path.join(toolsDir, f),
      destination: `/workspace/home/tools/${f}`,
    })),
  );
  await box.exec.command("cd /workspace/home && npm install");

  // Write initial portfolio for test agent
  const initialPortfolio = {
    agent: "test",
    updated_at: new Date().toISOString(),
    starting_balance: 100000,
    cash: 100000,
    holdings: [],
    total_value: 100000,
    all_time_return_pct: 0,
    day_number: 0,
    start_date: new Date().toISOString().split("T")[0],
    last_action: null,
    last_trade_date: null,
  };
  await box.files.write({
    path: "/workspace/home/agents/test/portfolio.json",
    content: JSON.stringify(initialPortfolio, null, 2),
  });
  await box.files.write({ path: "/workspace/home/agents/test/today_trades.json", content: "[]" });
  await box.files.write({ path: "/workspace/home/agents/test/history/.gitkeep", content: "" });

  if (process.env.BRAVE_API_KEY) {
    await box.files.write({
      path: "/workspace/home/.env",
      content: `BRAVE_API_KEY=${process.env.BRAVE_API_KEY}\n`,
    });
  }

  console.log("Setup complete.\n");

  // ── 1. Box SDK connection ──
  console.log("[Box SDK]");
  const status = await box.getStatus();
  assert("Box is reachable", status.status === "running" || status.status === "idle");

  // ── 2. File upload/download ──
  console.log("\n[File I/O]");
  await box.files.write({ path: "/workspace/home/test-upload.txt", content: "hello botstreet" });
  const readBack = await box.files.read("/workspace/home/test-upload.txt");
  assert("File upload/download roundtrip", readBack.trim() === "hello botstreet");

  // ── 3. get_current_prices ──
  console.log("\n[get_current_prices]");
  const prices = await run(box, "npx tsx tools/prices.ts current AAPL MSFT");
  assert("Returns array", Array.isArray(prices));
  assert("AAPL price > 0", prices?.[0]?.price > 0, `price=${prices?.[0]?.price}`);
  assert("MSFT price > 0", prices?.[1]?.price > 0, `price=${prices?.[1]?.price}`);
  assert("Includes timestamp", !!prices?.[0]?.timestamp);

  // ── 4. get_current_prices — invalid ticker ──
  const badPrice = await run(box, "npx tsx tools/prices.ts current XYZNOTREAL");
  assert("Invalid ticker returns price=0, no crash", badPrice?.[0]?.price === 0);

  // ── 5. get_historical_prices ──
  console.log("\n[get_historical_prices]");
  const hist = await run(box, "npx tsx tools/prices.ts historical NVDA 30");
  assert("Returns array", Array.isArray(hist));
  assert("Has ~20+ data points", hist?.length >= 15, `got ${hist?.length}`);
  const point = hist?.[0];
  assert("Has OHLCV fields", !!(point?.date && point?.open && point?.high && point?.low && point?.close !== undefined && point?.volume !== undefined));

  // ── 6. validate_ticker ──
  console.log("\n[validate_ticker]");
  const vStock = await run(box, "npx tsx tools/validator.ts AAPL");
  assert("AAPL → stock, valid", vStock?.valid === true && vStock?.type === "stock");

  const vEtf = await run(box, "npx tsx tools/validator.ts SPY");
  assert("SPY → etf, valid", vEtf?.valid === true && vEtf?.type === "etf");

  const vMetals = await run(box, "npx tsx tools/validator.ts GLD");
  assert("GLD → metals, valid", vMetals?.valid === true && vMetals?.type === "metals");

  const vBond = await run(box, "npx tsx tools/validator.ts TLT");
  assert("TLT → bond, blocked", vBond?.valid === false && vBond?.type === "bond");

  const vNonsense = await run(box, "npx tsx tools/validator.ts ZZZZZZ");
  assert("ZZZZZZ → not found", vNonsense?.valid === false);

  // ── 7. get_portfolio — initial state ──
  console.log("\n[get_portfolio]");
  const initP = await run(box, "npx tsx tools/portfolio.ts get test");
  assert("Cash = 100000", initP?.cash === 100000);
  assert("Holdings empty", initP?.holdings?.length === 0);
  assert("Total value = 100000", initP?.total_value === 100000);

  // ── 8. execute_trade — buy ──
  console.log("\n[execute_trade — buy]");
  const buyResult = await run(box, "npx tsx tools/trade.ts execute test AAPL buy 10000");
  assert("Buy succeeds", buyResult?.success === true);
  assert("Shares > 0", buyResult?.shares > 0);
  assert("Cash remaining = 90000", buyResult?.cash_remaining === 90000);

  const afterBuy = await run(box, "npx tsx tools/portfolio.ts get test");
  assert("AAPL in holdings", afterBuy?.holdings?.[0]?.ticker === "AAPL");
  assert("Cash = 90000", afterBuy?.cash === 90000);
  const expectedShares = afterBuy?.holdings?.[0]?.shares;

  // ── 9. execute_trade — sell ──
  console.log("\n[execute_trade — sell]");
  const sellResult = await run(box, "npx tsx tools/trade.ts execute test AAPL sell 5000");
  assert("Sell succeeds", sellResult?.success === true);
  assert("Cash remaining = 95000", sellResult?.cash_remaining === 95000);

  // ── 10. execute_trade — insufficient cash ──
  console.log("\n[execute_trade — error cases]");
  const noMoney = await run(box, "npx tsx tools/trade.ts execute test MSFT buy 200000");
  assert("Insufficient cash → error", noMoney?.success === false && noMoney?.error?.includes("insufficient"));

  // ── 11. execute_trade — sell more than held ──
  const overSell = await run(box, "npx tsx tools/trade.ts execute test AAPL sell 50000");
  assert("Sell > held → error", overSell?.success === false && overSell?.error?.includes("exceeds"));

  // ── 12. execute_trade — position limit ──
  const posLimit = await run(box, "npx tsx tools/trade.ts execute test NVDA buy 60000");
  assert("Position > 50% → error", posLimit?.success === false && posLimit?.error?.includes("position"));

  // ── 13. execute_trade — blocked asset ──
  const blocked = await run(box, "npx tsx tools/trade.ts execute test TLT buy 5000");
  assert("Bond ETF → error", blocked?.success === false && blocked?.error?.includes("bond"));

  // ── 14. update_portfolio_prices ──
  console.log("\n[update_portfolio_prices]");
  const updated = await run(box, "npx tsx tools/portfolio.ts update_prices test");
  assert("Returns portfolio", !!updated?.agent);
  assert("Holdings have current_price", updated?.holdings?.[0]?.current_price > 0);
  assert("total_value recalculated", updated?.total_value > 0);

  // ── 15. save_snapshot ──
  console.log("\n[save_snapshot]");
  const snap = await run(box, "npx tsx tools/snapshot.ts save test");
  assert("Snapshot succeeds", snap?.success === true);
  assert("Snapshot path exists", snap?.path?.includes("portfolio_"));

  // Read snapshot back
  const snapContent = await box.files.read(snap.path);
  const snapData = parse(snapContent);
  assert("Snapshot has trades array", Array.isArray(snapData?.trades));
  assert("Snapshot trades count >= 2", snapData?.trades?.length >= 2);
  assert("Snapshot has holdings", Array.isArray(snapData?.holdings));

  // Verify day_number incremented
  const afterSnap = await run(box, "npx tsx tools/portfolio.ts get test");
  assert("day_number incremented to 1", afterSnap?.day_number === 1);

  // ── 16. Math accuracy ──
  console.log("\n[Math accuracy]");
  // Reset portfolio for clean math test
  await box.files.write({
    path: "/workspace/home/agents/test/portfolio.json",
    content: JSON.stringify({ ...initialPortfolio, updated_at: new Date().toISOString() }, null, 2),
  });
  await box.files.write({ path: "/workspace/home/agents/test/today_trades.json", content: "[]" });

  const mathBuy = await run(box, "npx tsx tools/trade.ts execute test AAPL buy 25000");
  assert("Buy $25K succeeds", mathBuy?.success === true);
  const mathPortfolio = await run(box, "npx tsx tools/portfolio.ts get test");
  assert("Cash = 75000", mathPortfolio?.cash === 75000);
  const holding = mathPortfolio?.holdings?.[0];
  assert("Shares = 25000/price (4 decimals)", holding?.shares > 0);
  const expectedDollars = Math.round(holding?.shares * holding?.current_price * 100) / 100;
  assert("Dollars = shares * price (2 decimals)", holding?.dollars === expectedDollars, `${holding?.dollars} vs ${expectedDollars}`);

  // Sell partial
  const mathSell = await run(box, "npx tsx tools/trade.ts execute test AAPL sell 10000");
  assert("Partial sell succeeds", mathSell?.success === true);
  const afterSell = await run(box, "npx tsx tools/portfolio.ts get test");
  assert("Cash = 85000", afterSell?.cash === 85000);
  const remainingHolding = afterSell?.holdings?.[0];
  assert("avg_entry_price unchanged after sell", remainingHolding?.avg_entry_price === holding?.avg_entry_price);
  assert("Shares decreased", remainingHolding?.shares < holding?.shares);

  // ── 17. web_search ──
  console.log("\n[web_search]");
  if (process.env.BRAVE_API_KEY && process.env.BRAVE_API_KEY !== "BSAxxxxxxxxxxxxxxxx") {
    const searchCmd = await box.exec.command(
      `cd /workspace/home && source .env 2>/dev/null; export BRAVE_API_KEY=${process.env.BRAVE_API_KEY} && npx tsx tools/search.ts "stock market news today"`,
    );
    const search = parse(searchCmd.result ?? "null");
    assert("Returns array", Array.isArray(search));
    assert("Has results with title+url", search?.length > 0 && !!search?.[0]?.title && !!search?.[0]?.url);
  } else {
    console.log("  ⊘ Skipped (BRAVE_API_KEY not configured)");
  }

  // ── Cleanup ──
  console.log("\n---");
  await box.delete();
  console.log(`\nBox deleted.`);
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
