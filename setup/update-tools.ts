import "dotenv/config";
import { Box } from "@upstash/box";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBoxByName } from "./box-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const boxes = [
  { name: "claude", boxName: "botstreet-claude" },
  { name: "gemini", boxName: "botstreet-gemini" },
  { name: "openai", boxName: "botstreet-openai" },
];

const target = process.argv[2];

async function updateBox(name: string, boxName: string) {
  console.log(`Updating ${name} (${boxName})...`);
  const box = await getBoxByName(boxName);

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

  // Upload SKILL.md as the auto-loaded config file for each agent type:
  // - CLAUDE.md for Claude Code agents
  // - AGENTS.md for OpenAI Codex agents
  // - SKILL.md for Gemini (reads it directly via readFileSync)
  const skillPath = path.join(ROOT, "skill/SKILL.md");
  await box.files.upload([
    { path: skillPath, destination: "/workspace/home/CLAUDE.md" },
    { path: skillPath, destination: "/workspace/home/AGENTS.md" },
    { path: skillPath, destination: "/workspace/home/SKILL.md" },
  ]);
  console.log(`  Uploaded CLAUDE.md + AGENTS.md + SKILL.md`);

  // Patch portfolio.json to add missing fields
  try {
    const portfolioRaw = await box.files.read(`/workspace/home/agents/${name}/portfolio.json`);
    const portfolio = JSON.parse(portfolioRaw);
    let patched = false;
    if (!("last_trade_date" in portfolio)) {
      portfolio.last_trade_date = null;
      patched = true;
    }
    if (!("last_run_date" in portfolio)) {
      portfolio.last_run_date = null;
      patched = true;
    }
    if (patched) {
      await box.files.write({
        path: `/workspace/home/agents/${name}/portfolio.json`,
        content: JSON.stringify(portfolio, null, 2),
      });
      console.log(`  Patched portfolio.json with missing fields`);
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
    await updateBox(b.name, b.boxName);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
