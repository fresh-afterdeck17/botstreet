import "dotenv/config";
import { Box } from "@upstash/box";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const boxes = [
  { name: "claude", id: process.env.BOX_CLAUDE_ID! },
  { name: "gemini", id: process.env.BOX_GEMINI_ID! },
  { name: "openai", id: process.env.BOX_OPENAI_ID! },
];

const target = process.argv[2];

async function updateBox(name: string, boxId: string) {
  console.log(`Updating ${name} (${boxId})...`);
  const box = await Box.get(boxId);

  // Upload all tool files
  const toolsDir = path.join(ROOT, "box/tools");
  const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));
  await box.files.upload(
    toolFiles.map((f) => ({
      path: path.join(toolsDir, f),
      destination: `/workspace/home/tools/${f}`,
    })),
  );
  console.log(`  Uploaded ${toolFiles.length} tool files`);

  // Upload SKILL.md to workspace root
  await box.files.upload([
    { path: path.join(ROOT, "skill/SKILL.md"), destination: "/workspace/home/SKILL.md" },
  ]);
  console.log(`  Uploaded SKILL.md`);

  // Upload custom agent script for Gemini
  if (name === "gemini") {
    await box.files.upload([
      { path: path.join(ROOT, "box/agent-gemini.ts"), destination: "/workspace/home/agent-gemini.ts" },
    ]);
    console.log(`  Uploaded agent-gemini.ts`);
  }

  // Patch portfolio.json to add last_trade_date if missing
  try {
    const portfolioRaw = await box.files.read(`/workspace/home/agents/${name}/portfolio.json`);
    const portfolio = JSON.parse(portfolioRaw);
    if (!("last_trade_date" in portfolio)) {
      portfolio.last_trade_date = null;
      await box.files.write({
        path: `/workspace/home/agents/${name}/portfolio.json`,
        content: JSON.stringify(portfolio, null, 2),
      });
      console.log(`  Patched portfolio.json with last_trade_date`);
    }
  } catch {
    console.log(`  Warning: could not read/patch portfolio.json`);
  }

  console.log(`  Done.\n`);
}

async function main() {
  const targets = target ? boxes.filter((b) => b.name === target) : boxes;
  if (targets.length === 0) {
    console.error(`Unknown agent: ${target}. Use: claude, gemini, openai`);
    process.exit(1);
  }
  for (const b of targets) {
    await updateBox(b.name, b.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
