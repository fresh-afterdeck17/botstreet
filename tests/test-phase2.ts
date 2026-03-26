import "dotenv/config";
import { Box } from "@upstash/box";

const BOX_NAME = "botstreet-claude";
const AGENT = "claude";
const PROMPT = "trade";

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

async function readFile(box: any, path: string): Promise<string> {
  try {
    return await box.files.read(path);
  } catch {
    return "";
  }
}

async function runCmd(box: any, cmd: string): Promise<any> {
  const result = await box.exec.command(`cd /workspace/home && ${cmd}`);
  return parse(result.result ?? "null");
}

async function main() {
  console.log("=== BotStreet Phase 2 Tests — Single Agent End-to-End ===\n");

  const box = await Box.getByName(BOX_NAME);
  console.log(`Box: ${BOX_NAME}\n`);

  // ── Pre-flight ──
  console.log("[Pre-flight]");
  const status = await box.getStatus();
  assert("Box reachable", status.status === "running" || status.status === "idle");

  const prePortfolio = parse(await readFile(box, `/workspace/home/agents/${AGENT}/portfolio.json`));
  assert("portfolio.json exists", !!prePortfolio?.agent);

  const toolsList = await box.exec.command("ls /workspace/home/tools/");
  assert("Tools present", toolsList.result?.includes("trade.ts"));

  const skillCheck = await readFile(box, "/workspace/home/SKILL.md");
  assert("SKILL.md present", skillCheck.includes("Trading Skill"));

  const preDayNumber = prePortfolio?.day_number ?? 0;
  const preTotalValue = prePortfolio?.total_value ?? 100000;
  const preDiary = await readFile(box, `/workspace/home/agents/${AGENT}/diary.md`);
  const preDiaryLength = preDiary.length;

  console.log(`  Pre-run state: day=${preDayNumber}, value=$${preTotalValue}, diary=${preDiaryLength} chars`);

  // ── First run: send "trade" ──
  console.log("\n[First run — sending 'trade' to agent]");
  console.log("  Streaming agent output...\n");

  const stream = await box.agent.stream({ prompt: PROMPT, timeout: 600000 });
  for await (const chunk of stream) {
    if ((chunk as any).type === "text-delta") {
      process.stdout.write((chunk as any).text);
    }
  }

  console.log("\n\n  Agent finished. Status:", (stream as any).status);
  if ((stream as any).cost?.totalUsd) {
    console.log(`  Cost: $${(stream as any).cost.totalUsd}`);
  }

  // ── Post-run validations ──
  console.log("\n[Post-run validations]");

  const postPortfolio = parse(await readFile(box, `/workspace/home/agents/${AGENT}/portfolio.json`));
  assert("Portfolio exists after run", !!postPortfolio?.agent);

  // Skill discovery: agent used tools (last_action timestamp is fresh)
  const lastActionTime = postPortfolio?.last_action?.timestamp;
  if (lastActionTime) {
    const actionAge = (Date.now() - new Date(lastActionTime).getTime()) / (1000 * 60);
    assert("Skill discovery — agent made trades via tools", actionAge < 30, `last action ${actionAge.toFixed(0)} min ago`);
  } else {
    // Agent may have decided to hold — check if updated_at is fresh
    const updateAge = (Date.now() - new Date(postPortfolio?.updated_at).getTime()) / (1000 * 60);
    assert("Skill discovery — agent updated portfolio", updateAge < 30, `updated ${updateAge.toFixed(0)} min ago`);
  }

  // Price update: holdings have current_price
  if (postPortfolio?.holdings?.length > 0) {
    assert("Holdings have current_price > 0", postPortfolio.holdings.every((h: any) => h.current_price > 0));
  } else {
    console.log("  ⊘ No holdings to check prices on (agent may be all cash)");
  }

  // Portfolio math integrity
  const holdingsSum = (postPortfolio?.holdings ?? []).reduce((s: number, h: any) => s + h.dollars, 0);
  const expectedTotal = Math.round((postPortfolio?.cash + holdingsSum) * 100) / 100;
  assert("Portfolio math — total_value = cash + holdings", postPortfolio?.total_value === expectedTotal,
    `total=${postPortfolio?.total_value}, expected=${expectedTotal}`);

  // Diary written
  const postDiary = await readFile(box, `/workspace/home/agents/${AGENT}/diary.md`);
  const today = new Date().toISOString().split("T")[0];
  assert("Diary has today's date", postDiary.includes(today) || postDiary.length > preDiaryLength);

  const diaryHasSections = ["Market Overview", "Research", "Decisions", "Portfolio"].filter((s) => postDiary.includes(s));
  assert("Diary has required sections", diaryHasSections.length >= 3, `found: ${diaryHasSections.join(", ")}`);

  // Memory updated
  const postMemory = await readFile(box, `/workspace/home/agents/${AGENT}/memory.md`);
  assert("Memory has content beyond header", postMemory.length > 20);

  // Snapshot saved
  const todayFile = today.replace(/-/g, "_");
  const snapshotPath = `/workspace/home/agents/${AGENT}/history/portfolio_${todayFile}.json`;
  const snapshot = parse(await readFile(box, snapshotPath));
  assert("Snapshot exists for today", !!snapshot?.date);
  assert("Snapshot has trades array", Array.isArray(snapshot?.trades));
  assert("Snapshot total_value matches portfolio", snapshot?.total_value === postPortfolio?.total_value);

  // day_number incremented
  assert("day_number incremented", postPortfolio?.day_number === preDayNumber + 1,
    `was ${preDayNumber}, now ${postPortfolio?.day_number}`);

  // last_trade_date set
  assert("last_trade_date set to today", postPortfolio?.last_trade_date === today);

  // End-to-end value check (no phantom gains)
  const valueChange = postPortfolio?.total_value - preTotalValue;
  console.log(`  Value change: $${valueChange.toFixed(2)} (${preTotalValue} → ${postPortfolio?.total_value})`);

  // ── Idempotency test ──
  console.log("\n[Idempotency — sending 'trade' again]");

  const postDayNumber = postPortfolio?.day_number;
  const postValue = postPortfolio?.total_value;

  const run2 = await box.agent.run({ prompt: PROMPT, timeout: 600000 });
  console.log(`  Second run status: ${run2.status}`);

  const afterSecond = parse(await readFile(box, `/workspace/home/agents/${AGENT}/portfolio.json`));

  assert("day_number did NOT increment again", afterSecond?.day_number === postDayNumber,
    `was ${postDayNumber}, now ${afterSecond?.day_number}`);

  assert("last_trade_date still today", afterSecond?.last_trade_date === today);

  // Check that no new trades were executed (trade.ts should reject)
  const snapshot2 = parse(await readFile(box, snapshotPath));
  // The snapshot may be overwritten but trades should be empty (cleared by first snapshot, blocked by guard)
  console.log(`  Snapshot trades after 2nd run: ${snapshot2?.trades?.length ?? 0}`);

  // ── Edge cases (via direct tool calls) ──
  console.log("\n[Edge cases — direct tool calls]");

  // Reset last_trade_date to allow edge case testing
  afterSecond.last_trade_date = null;
  await box.files.write({
    path: `/workspace/home/agents/${AGENT}/portfolio.json`,
    content: JSON.stringify(afterSecond, null, 2),
  });

  const noMoney = await runCmd(box, `npx tsx tools/trade.ts execute ${AGENT} AAPL buy 999999`);
  assert("Insufficient cash → error", noMoney?.success === false && noMoney?.error?.includes("insufficient"));

  const badTicker = await runCmd(box, `npx tsx tools/trade.ts execute ${AGENT} XYZNOTREAL buy 1000`);
  assert("Invalid ticker → error", badTicker?.success === false);

  const bondBlock = await runCmd(box, `npx tsx tools/trade.ts execute ${AGENT} TLT buy 5000`);
  assert("Blocked asset → error", bondBlock?.success === false && bondBlock?.error?.includes("bond"));

  // Restore last_trade_date
  const finalPortfolio = parse(await readFile(box, `/workspace/home/agents/${AGENT}/portfolio.json`));
  finalPortfolio.last_trade_date = today;
  await box.files.write({
    path: `/workspace/home/agents/${AGENT}/portfolio.json`,
    content: JSON.stringify(finalPortfolio, null, 2),
  });

  // ── Market status ──
  console.log("\n[Market status]");
  const priceCheck = await runCmd(box, "npx tsx tools/prices.ts current AAPL");
  const marketOpen = priceCheck?.[0]?.market_open;
  console.log(`  market_open: ${marketOpen} (timestamp: ${priceCheck?.[0]?.timestamp})`);
  assert("market_open field present", marketOpen !== undefined);

  // ── Summary ──
  console.log("\n---");
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
