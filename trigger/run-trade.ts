import "dotenv/config";
import { getBoxByName } from "../setup/box-utils.js";

const PROMPT = "trade";
const TIMEOUT_MS = 10 * 60 * 1000;

const AGENTS = [
  { name: "claude", boxName: "botstreet-claude-v2" },
  { name: "gemini", boxName: "botstreet-gemini-v2" },
  { name: "openai", boxName: "botstreet-openai-v2" },
] as const;

async function triggerAgent(agent: (typeof AGENTS)[number]) {
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
  console.log("=== BotStreet — Manual Trigger ===\n");
  const results = [];

  for (const agent of AGENTS) {
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
