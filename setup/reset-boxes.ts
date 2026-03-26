import "dotenv/config";
import { Box } from "@upstash/box";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

const oldBoxIds = [
  { name: "claude", id: process.env.BOX_CLAUDE_ID },
  { name: "gemini", id: process.env.BOX_GEMINI_ID },
  { name: "openai", id: process.env.BOX_OPENAI_ID },
];

async function main() {
  console.log("=== BotStreet — Reset Boxes ===\n");

  // Delete old boxes
  for (const { name, id } of oldBoxIds) {
    if (id) {
      try {
        const box = await Box.get(id);
        await box.delete();
        console.log(`Deleted ${name} box (${id})`);
      } catch {
        console.log(`Could not delete ${name} box (${id}) — may already be gone`);
      }
    }
  }

  console.log("\nRunning full setup...\n");

  // Import and run init-boxes
  await import("./init-boxes.js");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
