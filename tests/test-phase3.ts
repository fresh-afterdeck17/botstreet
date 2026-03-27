import "dotenv/config";
import { getBoxByName } from "../setup/box-utils.js";

const PROMPT = "trade";

const agents = [
  { name: "claude", boxName: "botstreet-claude" },
  { name: "gemini", boxName: "botstreet-gemini" },
  { name: "openai", boxName: "botstreet-openai" },
];

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`    ✓ ${name}`);
    passed++;
  } else {
    console.log(`    ✗ ${name}${detail ? ` — ${detail}` : ""}`);
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

async function validateAgent(name: string, box: any) {
  const today = new Date().toISOString().split("T")[0];
  const todayFile = today.replace(/-/g, "_");

  const portfolio = parse(await readFile(box, `/workspace/home/agents/${name}/portfolio.json`));
  const diary = await readFile(box, `/workspace/home/agents/${name}/diary.md`);
  const memory = await readFile(box, `/workspace/home/agents/${name}/memory.md`);
  const snapshotPath = `/workspace/home/agents/${name}/history/portfolio_${todayFile}.json`;
  const snapshot = parse(await readFile(box, snapshotPath));

  // Schema conformance
  assert("portfolio.json exists", !!portfolio?.agent);
  assert("agent field matches", portfolio?.agent === name);
  assert("cash is number", typeof portfolio?.cash === "number");
  assert("holdings is array", Array.isArray(portfolio?.holdings));
  assert("total_value is number", typeof portfolio?.total_value === "number");
  assert("starting_balance = 100000", portfolio?.starting_balance === 100000);
  assert("day_number > 0", portfolio?.day_number > 0);
  assert("last_trade_date set", portfolio?.last_trade_date === today);

  // Portfolio math
  const holdingsSum = (portfolio?.holdings ?? []).reduce((s: number, h: any) => s + h.dollars, 0);
  const expectedTotal = Math.round((portfolio?.cash + holdingsSum) * 100) / 100;
  assert("Math: total_value = cash + holdings", portfolio?.total_value === expectedTotal,
    `total=${portfolio?.total_value}, expected=${expectedTotal}`);

  // Holdings integrity
  for (const h of portfolio?.holdings ?? []) {
    assert(`Holding ${h.ticker}: has shares > 0`, h.shares > 0);
    assert(`Holding ${h.ticker}: has current_price > 0`, h.current_price > 0);
    assert(`Holding ${h.ticker}: has avg_entry_price > 0`, h.avg_entry_price > 0);
  }

  // Trade execution (tool-based, not raw edit)
  assert("last_action exists", !!portfolio?.last_action?.timestamp);
  if (portfolio?.last_action?.timestamp) {
    const actionAge = (Date.now() - new Date(portfolio.last_action.timestamp).getTime()) / (1000 * 60);
    assert("last_action is recent (< 30 min)", actionAge < 30);
  }

  // Diary
  assert("Diary has content", diary.length > 50);
  assert("Diary has today's date", diary.includes(today));
  const sections = ["Market Overview", "Research", "Decisions", "Portfolio"].filter((s) => diary.includes(s));
  assert("Diary has required sections", sections.length >= 3, `found: ${sections.join(", ")}`);

  // Memory
  assert("Memory has content", memory.length > 30);

  // Snapshot
  assert("Snapshot exists", !!snapshot?.date);
  assert("Snapshot has trades", Array.isArray(snapshot?.trades) && snapshot.trades.length > 0,
    `trades: ${snapshot?.trades?.length ?? 0}`);
  assert("Snapshot total matches portfolio", snapshot?.total_value === portfolio?.total_value);

  return portfolio;
}

async function main() {
  console.log("=== BotStreet Phase 3 Tests — Multi-Agent ===\n");

  // ── Pre-flight ──
  console.log("[Pre-flight]");
  const boxes: Record<string, any> = {};
  for (const agent of agents) {
    const box = await getBoxByName(agent.boxName);
    boxes[agent.name] = box;

    const skill = await readFile(box, "/workspace/home/SKILL.md");
    assert(`${agent.name} box reachable + SKILL.md present`, skill.includes("Trading Skill"));
  }

  // ── Parallel execution ──
  console.log("\n[Parallel execution — sending 'trade' to all 3 agents]");
  const startTime = Date.now();

  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      console.log(`  Starting ${agent.name}...`);
      const box = boxes[agent.name];

      const run = await box.agent.run({ prompt: PROMPT, timeout: 600000 });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  ${agent.name} done (${elapsed}s, status: ${run.status}, cost: $${run.cost?.totalUsd ?? "?"})`);
      return { name: agent.name, status: run.status, cost: run.cost?.totalUsd };
    }),
  );

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n  All agents finished in ${totalElapsed}s\n`);

  // Check all completed
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      assert(`${result.value.name} completed successfully`, result.value.status === "completed");
    } else {
      assert(`${agents[i].name} completed`, false, `rejected: ${result.reason}`);
    }
  }

  // ── Per-agent validation ──
  const portfolios: Record<string, any> = {};
  for (const agent of agents) {
    console.log(`\n[${agent.name} validation]`);
    portfolios[agent.name] = await validateAgent(agent.name, boxes[agent.name]);
  }

  // ── Cross-agent checks ──
  console.log("\n[Cross-agent checks]");

  // No cross-contamination
  for (const agent of agents) {
    const box = boxes[agent.name];
    const otherAgents = agents.filter((a) => a.name !== agent.name);
    for (const other of otherAgents) {
      const cross = await readFile(box, `/workspace/home/agents/${other.name}/portfolio.json`);
      assert(`${agent.name} box has no ${other.name} files`, cross === "");
    }
  }

  // All started at $100K
  for (const agent of agents) {
    assert(`${agent.name} starting_balance = 100000`, portfolios[agent.name]?.starting_balance === 100000);
  }

  // Diary independence (different content)
  const diaries: Record<string, string> = {};
  for (const agent of agents) {
    diaries[agent.name] = await readFile(boxes[agent.name], `/workspace/home/agents/${agent.name}/diary.md`);
  }
  const diaryLengths = Object.values(diaries).map((d) => d.length);
  const allSameLength = diaryLengths.every((l) => l === diaryLengths[0]);
  assert("Diaries are independent (not identical)", !allSameLength || diaryLengths[0] < 100,
    `lengths: ${agents.map((a) => `${a.name}=${diaries[a.name].length}`).join(", ")}`);

  // Price consistency (same day, similar prices for same tickers)
  const allTickers = new Set<string>();
  for (const p of Object.values(portfolios)) {
    for (const h of p?.holdings ?? []) allTickers.add(h.ticker);
  }
  if (allTickers.size > 0) {
    const sharedTickers: string[] = [];
    for (const ticker of allTickers) {
      const holders = agents.filter((a) => portfolios[a.name]?.holdings?.some((h: any) => h.ticker === ticker));
      if (holders.length > 1) sharedTickers.push(ticker);
    }
    if (sharedTickers.length > 0) {
      for (const ticker of sharedTickers) {
        const prices = agents
          .map((a) => portfolios[a.name]?.holdings?.find((h: any) => h.ticker === ticker)?.current_price)
          .filter(Boolean);
        if (prices.length >= 2) {
          const maxDiff = Math.max(...prices) - Math.min(...prices);
          const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
          const diffPct = (maxDiff / avgPrice) * 100;
          assert(`${ticker} price consistent across agents (<1%)`, diffPct < 1, `diff: ${diffPct.toFixed(2)}%`);
        }
      }
    } else {
      console.log("    ⊘ No shared tickers to compare prices");
    }
  }

  // ── Summary ──
  console.log("\n[Portfolio Summary]");
  for (const agent of agents) {
    const p = portfolios[agent.name];
    const holdingStr = (p?.holdings ?? []).map((h: any) => `${h.ticker}($${h.dollars})`).join(", ");
    console.log(`  ${agent.name}: $${p?.total_value} | cash: $${p?.cash} | ${holdingStr}`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
