import "dotenv/config";
import { getBoxByName } from "../setup/box-utils.js";

const PROMPT = "trade";
const TIMEOUT_MS = 15 * 60 * 1000;

const PROD_AGENTS = [
  { name: "claude", boxName: "botstreet-claude-v2" },
  { name: "gemini", boxName: "botstreet-gemini-v2" },
  { name: "openai", boxName: "botstreet-openai-v2" },
] as const;

const TEST_AGENTS = [
  { name: "claude", boxName: "test-claude-v2" },
  { name: "gemini", boxName: "test-gemini-v2" },
  { name: "openai", boxName: "test-openai-v2" },
] as const;

type AgentEntry = { name: string; boxName: string };

async function triggerAgent(agent: AgentEntry) {
  const box = await getBoxByName(agent.boxName);
  const run = await box.agent.run({ prompt: PROMPT, timeout: TIMEOUT_MS });

  return {
    agent: agent.name,
    boxName: agent.boxName,
    status: run.status,
    costUsd: run.cost?.totalUsd ?? null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const useTest = args.includes("--test");
  const positional = args.filter((a) => a !== "--test");
  const filter = positional[0]?.replace(/^--/, "").toLowerCase();

  const AGENTS = useTest ? TEST_AGENTS : PROD_AGENTS;
  const targets = filter
    ? AGENTS.filter((a) => a.name === filter)
    : [...AGENTS];

  if (targets.length === 0) {
    console.error(`Unknown agent: ${filter}`);
    console.error(`Available: ${AGENTS.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }

  const label = useTest ? "Test Trigger" : "Manual Trigger";
  console.log(`=== BotStreet — ${label} ===\n`);
  const results = [];

  for (const agent of targets) {
    console.log(`Triggering ${agent.name} (${agent.boxName})...`);
    const result = await triggerAgent(agent);
    results.push(result);
    console.log(`  ${agent.name}: ${result.status}`);
  }

  console.log("\n=== Results ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
