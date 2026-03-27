import "dotenv/config";
import { getBoxByName } from "./box-utils.js";

// 9:30 AM ET = 14:30 UTC, weekdays only
const CRON = "30 14 * * 1-5";

const agents = [
  { name: "claude", boxName: "botstreet-claude" },
  { name: "gemini", boxName: "botstreet-gemini" },
  { name: "openai", boxName: "botstreet-openai" },
];

async function setupSchedules() {
  console.log("=== BotStreet — Setup Box Schedules ===\n");

  for (const agent of agents) {
    const box = await getBoxByName(agent.boxName);

    // Clear existing schedules
    const existing = await box.schedule.list();
    for (const s of existing) {
      await box.schedule.delete(s.id);
    }
    if (existing.length > 0) {
      console.log(`  ${agent.name}: cleared ${existing.length} old schedule(s)`);
    }

    const schedule = await box.schedule.agent({
      cron: CRON,
      prompt: "trade",
    });
    console.log(`  ${agent.name}: scheduled agent (${schedule.id}) — ${CRON}`);
  }

  console.log("\nDone. All agents scheduled for 9:30 AM ET weekdays.");
}

export { setupSchedules };

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], "file://").href;

if (isMain) {
  setupSchedules().catch((err) => {
    console.error("Schedule setup failed:", err);
    process.exit(1);
  });
}
