import "dotenv/config";
import { getBoxByName } from "./box-utils.js";

const BOX_ROOT = "/workspace/home";
const DATA_DIR = `${BOX_ROOT}/data`;
const LEGACY_AGENTS_DIR = `${BOX_ROOT}/agents`;

const AGENTS = [
  { name: "claude", boxName: "botstreet-claude-v2" },
  { name: "gemini", boxName: "botstreet-gemini-v2" },
  { name: "openai", boxName: "botstreet-openai-v2" },
] as const;

async function readFile(box: any, path: string): Promise<string | null> {
  try {
    return await box.files.read(path);
  } catch {
    return null;
  }
}

async function writeIfMissing(box: any, path: string, content: string): Promise<boolean> {
  const existing = await readFile(box, path);
  if (existing !== null) {
    return false;
  }

  await box.files.write({ path, content });
  return true;
}

async function findSourceBase(box: any, agent: string): Promise<string | null> {
  const candidates = [
    DATA_DIR,
    `${DATA_DIR}/${agent}`,
    `${LEGACY_AGENTS_DIR}/${agent}`,
  ];

  for (const base of candidates) {
    if (await readFile(box, `${base}/portfolio.json`)) {
      return base;
    }
  }

  return null;
}

async function migrateAgent(box: any, agent: string) {
  const sourceBase = await findSourceBase(box, agent);
  const flatBase = DATA_DIR;

  if (!sourceBase) {
    console.log(`  ${agent}: no source portfolio found, skipping\n`);
    return;
  }

  let copiedFiles = 0;
  const files = ["portfolio.json", "diary.md", "memory.md", "today_trades.json"] as const;

  for (const file of files) {
    const content = await readFile(box, `${sourceBase}/${file}`);
    if (content === null) {
      continue;
    }

    if (await writeIfMissing(box, `${flatBase}/${file}`, content)) {
      copiedFiles += 1;
    }
  }

  let copiedHistory = 0;
  try {
    const sourceEntries = await box.files.list(`${sourceBase}/history`);
    for (const entry of sourceEntries) {
      const sourcePath = entry.path ?? `${sourceBase}/history/${entry.name}`;
      const fileName = entry.name ?? sourcePath.split("/").pop();
      if (!fileName) {
        continue;
      }

      const content = await readFile(box, sourcePath);
      if (content === null) {
        continue;
      }

      if (await writeIfMissing(box, `${flatBase}/history/${fileName}`, content)) {
        copiedHistory += 1;
      }
    }
  } catch {
    // No source history.
  }

  console.log(`  ${agent}: copied ${copiedFiles} files, ${copiedHistory} history snapshots`);
  console.log(`  Source files left in place (${sourceBase}).\n`);
}

async function main() {
  console.log("=== BotStreet — Flat Data Layout Migration ===\n");

  for (const agent of AGENTS) {
    console.log(`[${agent.name}]`);
    const box = await getBoxByName(agent.boxName);
    await migrateAgent(box, agent.name);
  }

  console.log("=== Migration complete ===");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
