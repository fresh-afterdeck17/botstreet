import "dotenv/config";
import { Box } from "@upstash/box";

// 9:30 AM ET = 14:30 UTC, weekdays only
const CRON = "30 14 * * 1-5";

const agents = [
  { name: "claude", boxName: "botstreet-claude", custom: false },
  { name: "gemini", boxName: "botstreet-gemini", custom: true },
  { name: "openai", boxName: "botstreet-openai", custom: false },
];

async function main() {
  console.log("=== BotStreet — Setup Box Schedules ===\n");

  for (const agent of agents) {
    const box = await Box.getByName(agent.boxName);

    // Clear existing schedules
    const existing = await box.schedule.list();
    for (const s of existing) {
      await box.schedule.delete(s.id);
    }
    if (existing.length > 0) {
      console.log(`  ${agent.name}: cleared ${existing.length} old schedule(s)`);
    }

    if (agent.custom) {
      // Gemini: schedule shell command to run the custom agent script
      const schedule = await box.schedule.exec({
        cron: CRON,
        command: ["bash", "-c", "cd /workspace/home && export $(cat .env | xargs) && npx tsx agent-gemini.ts"],
      });
      console.log(`  ${agent.name}: scheduled exec (${schedule.id}) — ${CRON}`);
    } else {
      // Claude/Codex: schedule agent prompt
      const schedule = await box.schedule.agent({
        cron: CRON,
        prompt: "trade",
      });
      console.log(`  ${agent.name}: scheduled agent (${schedule.id}) — ${CRON}`);
    }
  }

  console.log("\nDone. All agents scheduled for 9:30 AM ET weekdays.");
}

main().catch((err) => {
  console.error("Schedule setup failed:", err);
  process.exit(1);
});
