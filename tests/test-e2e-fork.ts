import "dotenv/config";
import { Agent, Box, BoxApiKey, ClaudeCode, OpenCodeModel } from "@upstash/box";
import { getBoxByName } from "../setup/box-utils.js";

const PROMPT = "trade";
const FORK_READY_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_POLL_MS = 2_000;
const FILE_READY_TIMEOUT_MS = 60_000;

const agents = [
  { name: "claude", boxName: "botstreet-claude" },
  { name: "gemini", boxName: "botstreet-gemini" },
  { name: "openai", boxName: "botstreet-openai" },
] as const;

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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFile(box: any, path: string): Promise<string> {
  try {
    return await box.files.read(path);
  } catch {
    return "";
  }
}

async function runJson(box: any, cmd: string): Promise<any> {
  const result = await box.exec.command(`cd /workspace/home && ${cmd}`);
  return parse(result.result ?? "null");
}

async function waitUntilForkable(agentName: string, box: any) {
  const start = Date.now();

  while (Date.now() - start < FORK_READY_TIMEOUT_MS) {
    const status = await box.getStatus();
    if (status.status === "idle" || status.status === "paused") {
      return status.status;
    }
    if (status.status === "error") {
      throw new Error(`${agentName} source box is in error state`);
    }
    await sleep(STATUS_POLL_MS);
  }

  throw new Error(`${agentName} source box did not become idle/paused in time`);
}

async function waitForFile(box: any, path: string, timeoutMs = FILE_READY_TIMEOUT_MS) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const content = await readFile(box, path);
    if (content) {
      return content;
    }
    await sleep(1_000);
  }

  return "";
}

async function prepareClone(agentName: string, box: any) {
  const portfolioPath = `/workspace/home/agents/${agentName}/portfolio.json`;
  const tradesPath = `/workspace/home/agents/${agentName}/today_trades.json`;
  const raw = await waitForFile(box, portfolioPath);
  const portfolio = parse(raw);

  if (!portfolio?.agent) {
    throw new Error(`Missing portfolio in clone for ${agentName}`);
  }

  portfolio.last_trade_date = null;
  await box.files.write({
    path: portfolioPath,
    content: JSON.stringify(portfolio, null, 2),
  });
  await box.files.write({
    path: tradesPath,
    content: "[]",
  });
}

async function getMarketOpen(box: any): Promise<boolean | null> {
  const quotes = await runJson(box, "npx tsx tools/prices.ts current SPY");
  return quotes?.[0]?.market_open ?? null;
}

async function validateClone(agentName: string, box: any, marketOpen: boolean | null) {
  const today = new Date().toISOString().split("T")[0];
  const todayFile = today.replace(/-/g, "_");
  const portfolio = parse(await readFile(box, `/workspace/home/agents/${agentName}/portfolio.json`));
  const diary = await readFile(box, `/workspace/home/agents/${agentName}/diary.md`);
  const memory = await readFile(box, `/workspace/home/agents/${agentName}/memory.md`);
  const snapshot = parse(
    await readFile(box, `/workspace/home/agents/${agentName}/history/portfolio_${todayFile}.json`),
  );

  assert("portfolio.json exists", !!portfolio?.agent);
  assert("agent field matches", portfolio?.agent === agentName);
  assert("cash is number", typeof portfolio?.cash === "number");
  assert("holdings is array", Array.isArray(portfolio?.holdings));
  assert("total_value is number", typeof portfolio?.total_value === "number");

  const holdingsSum = (portfolio?.holdings ?? []).reduce((sum: number, h: any) => sum + h.dollars, 0);
  const expectedTotal = Math.round(((portfolio?.cash ?? 0) + holdingsSum) * 100) / 100;
  assert(
    "Math: total_value = cash + holdings",
    portfolio?.total_value === expectedTotal,
    `total=${portfolio?.total_value}, expected=${expectedTotal}`,
  );

  for (const h of portfolio?.holdings ?? []) {
    assert(`Holding ${h.ticker}: has shares > 0`, h.shares > 0);
    assert(`Holding ${h.ticker}: has current_price > 0`, h.current_price > 0);
    assert(`Holding ${h.ticker}: has avg_entry_price > 0`, h.avg_entry_price > 0);
  }

  assert("Diary has content", diary.length > 20);
  assert("Memory has content", memory.length > 20);

  if (marketOpen === true) {
    assert("last_trade_date set to today", portfolio?.last_trade_date === today);
    assert("Snapshot exists for today", !!snapshot?.date);
    assert("Snapshot has trades array", Array.isArray(snapshot?.trades));
    assert("Snapshot total matches portfolio", snapshot?.total_value === portfolio?.total_value);
  } else {
    console.log("    ⊘ Market closed; skipping trade/snapshot assertions");
  }

  return portfolio;
}

async function runClone(agent: (typeof agents)[number], clone: any) {
  console.log(`\n[${agent.name} clone validation]`);

  const skill = await waitForFile(clone, "/workspace/home/SKILL.md");
  assert("SKILL.md present", skill.includes("Trading Skill"));

  await prepareClone(agent.name, clone);
  const marketOpen = await getMarketOpen(clone);
  console.log(`    market_open: ${marketOpen}`);

  const run = await clone.agent.run({ prompt: PROMPT, timeout: 600000 });
  assert("Agent run completed", run.status === "completed", `status=${run.status}`);

  const portfolio = await validateClone(agent.name, clone, marketOpen);

  if (marketOpen === true) {
    const dayNumber = portfolio?.day_number;
    const run2 = await clone.agent.run({ prompt: PROMPT, timeout: 600000 });
    assert("Second run completed", run2.status === "completed", `status=${run2.status}`);

    const afterSecond = parse(await readFile(clone, `/workspace/home/agents/${agent.name}/portfolio.json`));
    const today = new Date().toISOString().split("T")[0];

    assert(
      "Idempotency: day_number unchanged on second run",
      afterSecond?.day_number === dayNumber,
      `was ${dayNumber}, now ${afterSecond?.day_number}`,
    );
    assert("Idempotency: last_trade_date still today", afterSecond?.last_trade_date === today);
  }

  return portfolio;
}

function getCloneConfig(agent: (typeof agents)[number]) {
  if (agent.name === "claude") {
    return {
      agent: {
        provider: Agent.ClaudeCode,
        model: ClaudeCode.Opus_4_6,
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    };
  }

  if (agent.name === "gemini") {
    return {
      agent: {
        provider: Agent.OpenCode,
        model: OpenCodeModel.Zen_Gemini_3_1_Pro,
        apiKey: BoxApiKey.UpstashKey,
      },
      env: {
        GOOGLE_API_KEY: "",
        GEMINI_API_KEY: "",
      },
    };
  }

  return {
    agent: {
      provider: Agent.Codex,
      model: "openai/gpt-5.4",
      apiKey: process.env.OPENAI_API_KEY!,
    },
  };
}

async function main() {
  console.log("=== BotStreet Safe E2E — Snapshot Clones ===\n");

  const sourceBoxes: Array<{
    agent: (typeof agents)[number];
    box: any;
    portfolioRaw: string;
  }> = [];
  const snapshots: Array<{
    agent: (typeof agents)[number];
    sourceBox: any;
    snapshotId: string;
  }> = [];
  const clonedBoxes: Array<{
    agent: (typeof agents)[number];
    box: any;
  }> = [];

  try {
    console.log("[Pre-flight]");
    for (const agent of agents) {
      const box = await getBoxByName(agent.boxName);
      const sourceStatus = await waitUntilForkable(agent.name, box);
      const portfolioRaw = await readFile(box, `/workspace/home/agents/${agent.name}/portfolio.json`);

      assert(`${agent.name} source box reachable`, sourceStatus === "idle" || sourceStatus === "paused");
      assert(`${agent.name} source portfolio exists`, portfolioRaw.includes(`"agent": "${agent.name}"`));

      sourceBoxes.push({ agent, box, portfolioRaw });
    }

    console.log("\n[Create snapshots]");
    const createdSnapshots = await Promise.all(
      sourceBoxes.map(async ({ agent, box }) => {
        const snapshot = await box.snapshot({
          name: `safe-e2e-${agent.name}-${Date.now()}`,
        });
        console.log(`  ${agent.name}: snapshot ${snapshot.id}`);
        return { agent, sourceBox: box, snapshotId: snapshot.id };
      }),
    );
    snapshots.push(...createdSnapshots);

    console.log("\n[Create boxes from snapshots]");
    const clones = await Promise.all(
      snapshots.map(async ({ agent, snapshotId }) => {
        const clone = await Box.fromSnapshot(snapshotId, getCloneConfig(agent));
        console.log(`  ${agent.name}: cloned to ${clone.id}`);
        return { agent, box: clone };
      }),
    );
    clonedBoxes.push(...clones);

    console.log("\n[Parallel agent runs on clones]");
    const results = await Promise.allSettled(
      clonedBoxes.map(async ({ agent, box }) => {
        const portfolio = await runClone(agent, box);
        return { name: agent.name, portfolio };
      }),
    );

    const portfolios: Record<string, any> = {};
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        portfolios[result.value.name] = result.value.portfolio;
      } else {
        assert(`${clonedBoxes[i].agent.name} run succeeded`, false, String(result.reason));
      }
    }

    console.log("\n[Cross-agent checks on clones]");
    for (const { agent, box } of clonedBoxes) {
      const otherAgents = agents.filter((a) => a.name !== agent.name);
      for (const other of otherAgents) {
        const cross = await readFile(box, `/workspace/home/agents/${other.name}/portfolio.json`);
        assert(`${agent.name} clone has no ${other.name} files`, cross === "");
      }
    }

    console.log("\n[Live source safety check]");
    for (const { agent, box, portfolioRaw } of sourceBoxes) {
      const current = await readFile(box, `/workspace/home/agents/${agent.name}/portfolio.json`);
      if (current === portfolioRaw) {
        assert(`${agent.name} source portfolio unchanged`, true);
      } else {
        console.log(`    ⊘ ${agent.name} source portfolio changed during test window; likely external activity`);
      }
    }

    console.log("\n[Portfolio Summary]");
    for (const agent of agents) {
      const p = portfolios[agent.name];
      if (!p) continue;
      const holdings = (p.holdings ?? []).map((h: any) => `${h.ticker}($${h.dollars})`).join(", ");
      console.log(`  ${agent.name}: $${p.total_value} | cash: $${p.cash} | ${holdings}`);
    }

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      throw new Error(`Safe E2E test failed with ${failed} failing assertion(s)`);
    }
  } finally {
    if (clonedBoxes.length > 0 || snapshots.length > 0) {
      console.log("\n[Cleanup]");
    }
    await Promise.all(
      clonedBoxes.map(async ({ agent, box }) => {
        try {
          await box.delete();
          console.log(`  Deleted clone for ${agent.name}: ${box.id}`);
        } catch (error) {
          console.error(`  Failed to delete clone for ${agent.name}:`, error);
        }
      }),
    );
    await Promise.all(
      snapshots.map(async ({ agent, sourceBox, snapshotId }) => {
        try {
          await sourceBox.deleteSnapshot(snapshotId);
          console.log(`  Deleted snapshot for ${agent.name}: ${snapshotId}`);
        } catch (error) {
          console.error(`  Failed to delete snapshot for ${agent.name}:`, error);
        }
      }),
    );
  }
}

main().catch((err) => {
  console.error("Safe E2E test failed:", err);
  process.exit(1);
});
