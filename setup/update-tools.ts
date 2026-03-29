import "dotenv/config";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBoxByName } from "./box-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const boxes = [
  { name: "claude", boxName: "botstreet-claude-v2" },
  { name: "gemini", boxName: "botstreet-gemini-v2" },
  { name: "openai", boxName: "botstreet-openai-v2" },
];

const target = process.argv[2];

const BOX_ROOT = "/workspace/home";
const DATA_DIR = `${BOX_ROOT}/data`;

async function getExistingBox(...candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const box = await getBoxByName(candidate);
      return { box, boxName: candidate };
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Box not found by name: ${candidates.join(", ")}`);
}

async function updateBox(name: string, preferredBoxName: string) {
  const fallbackBoxName = preferredBoxName.replace(/-v2$/, "");
  const { box, boxName } = await getExistingBox(preferredBoxName, fallbackBoxName);
  console.log(`Updating ${name} (${boxName})...`);

  await box.files.upload([
    {
      path: path.join(ROOT, "box/package.json"),
      destination: "/workspace/home/package.json",
    },
    {
      path: path.join(ROOT, "box/tsconfig.json"),
      destination: "/workspace/home/tsconfig.json",
    },
  ]);
  console.log(`  Uploaded package.json + tsconfig.json`);

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

  // Upload the canonical skill file plus the auto-loaded root config files:
  // - CLAUDE.md for Claude Code agents
  // - AGENTS.md for OpenAI Codex agents
  // - SKILL.md for Gemini (reads it directly via readFileSync)
  const skillPath = path.join(ROOT, "skill/SKILL.md");
  await box.files.upload([
    { path: skillPath, destination: "/workspace/home/skills/trade/SKILL.md" },
    { path: skillPath, destination: "/workspace/home/CLAUDE.md" },
    { path: skillPath, destination: "/workspace/home/AGENTS.md" },
    { path: skillPath, destination: "/workspace/home/SKILL.md" },
  ]);
  console.log(`  Uploaded skills/trade/SKILL.md + root config files`);

  // Patch portfolio.json to add missing fields
  try {
    const currentPath = `${DATA_DIR}/portfolio.json`;
    const portfolio = JSON.parse(await box.files.read(currentPath));
    let patched = false;
    if (!("last_run_date" in portfolio)) {
      portfolio.last_run_date = null;
      patched = true;
    }
    if (patched) {
      await box.files.write({
        path: currentPath,
        content: JSON.stringify(portfolio, null, 2),
      });
      console.log(`  Patched portfolio.json with missing fields`);
    }
  } catch {
    console.log(`  Warning: could not read/patch portfolio.json`);
  }

  console.log(`  Installing dependencies...`);
  const install = await box.exec.command("cd /workspace/home && npm install");
  console.log(`  npm install: ${install.status}`);

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
