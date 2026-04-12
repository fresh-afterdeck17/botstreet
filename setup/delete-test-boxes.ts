import "dotenv/config";
import { Box } from "@upstash/box";
import { getBoxByName, isBoxNotFoundError } from "./box-utils.js";

const TEST_BOXES = [
  "test-claude-v2",
  "test-gemini-v2",
  "test-openai-v2",
];

async function deleteTestBoxes() {
  console.log("=== BotStreet — Delete Test Boxes ===\n");

  for (const name of TEST_BOXES) {
    try {
      const box = await getBoxByName(name);

      // Clear schedules first
      const schedules = await box.schedule.list();
      for (const s of schedules) {
        await box.schedule.delete(s.id);
      }
      if (schedules.length > 0) {
        console.log(`  ${name}: cleared ${schedules.length} schedule(s)`);
      }

      await box.delete();
      console.log(`  ${name}: deleted`);
    } catch (err) {
      if (isBoxNotFoundError(err, name)) {
        console.log(`  ${name}: not found, skipping`);
      } else {
        throw err;
      }
    }
  }

  console.log("\nDone.");
}

export { deleteTestBoxes };

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  deleteTestBoxes().catch((err) => {
    console.error("Delete failed:", err);
    process.exit(1);
  });
}
