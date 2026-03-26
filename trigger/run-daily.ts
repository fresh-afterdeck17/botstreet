import "dotenv/config";
import { Box } from "@upstash/box";

const PROMPT = "Read SKILL.md and follow its instructions. The command is: trade";

const agents = [
  { name: "claude", boxId: process.env.BOX_CLAUDE_ID!, customAgent: false },
  { name: "gemini", boxId: process.env.BOX_GEMINI_ID!, customAgent: true },
  { name: "openai", boxId: process.env.BOX_OPENAI_ID!, customAgent: false },
];

async function runAgent(agent: typeof agents[number]) {
  const box = await Box.get(agent.boxId);

  if (agent.customAgent) {
    // Gemini: run custom agent script via shell
    const run = await box.exec.command("cd /workspace/home && export $(cat .env | xargs) && npx tsx agent-gemini.ts");
    return { name: agent.name, status: run.status, result: run.result };
  } else {
    // Claude/Codex: use built-in agent
    const run = await box.agent.run({ prompt: PROMPT, timeout: 600000 });
    return { name: agent.name, status: run.status, cost: run.cost?.totalUsd };
  }
}

async function runDaily() {
  const timestamp = new Date().toISOString();
  console.log(`=== BotStreet — ${timestamp} ===\n`);

  const results = await Promise.allSettled(agents.map(runAgent));

  console.log("\n=== Results ===\n");
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      console.log(`✓ ${result.value.name}: ${result.value.status}`);
    } else {
      console.error(`✗ ${agents[i].name}: ${result.reason}`);
    }
  }
}

runDaily().catch((err) => {
  console.error("Trigger failed:", err);
  process.exit(1);
});
