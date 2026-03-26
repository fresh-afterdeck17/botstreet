import "dotenv/config";
import { Box } from "@upstash/box";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", ".backups");
const AGENT_NAMES = ["claude", "gemini", "openai"];
const BOX_NAMES = AGENT_NAMES.map((n) => `botstreet-${n}`);

const AGENT_FILES = [
  "portfolio.json",
  "diary.md",
  "memory.md",
  "today_trades.json",
];

interface BackupData {
  agent: string;
  files: Record<string, string>;
  history: Record<string, string>;
}

async function backupAgent(box: Box, agent: string): Promise<BackupData> {
  const backup: BackupData = { agent, files: {}, history: {} };
  const basePath = `/workspace/home/agents/${agent}`;

  // Backup known files
  for (const file of AGENT_FILES) {
    try {
      backup.files[file] = await box.files.read(`${basePath}/${file}`);
    } catch {
      // File doesn't exist, skip
    }
  }

  // Backup history snapshots
  try {
    const entries = await box.files.list(`${basePath}/history`);
    const jsonFiles = entries.filter(
      (f: any) => (f.name ?? f.path ?? "").endsWith(".json"),
    );
    for (const f of jsonFiles) {
      const filePath = f.path ?? `${basePath}/history/${f.name}`;
      const fileName = f.name ?? filePath.split("/").pop()!;
      try {
        backup.history[fileName] = await box.files.read(filePath);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // No history directory
  }

  const fileCount = Object.keys(backup.files).length;
  const historyCount = Object.keys(backup.history).length;
  console.log(`  Backed up ${agent}: ${fileCount} files, ${historyCount} history snapshots`);
  return backup;
}

async function restoreAgent(box: Box, backup: BackupData): Promise<void> {
  const basePath = `/workspace/home/agents/${backup.agent}`;

  // Restore known files
  for (const [file, content] of Object.entries(backup.files)) {
    await box.files.write({ path: `${basePath}/${file}`, content });
  }

  // Restore history snapshots
  for (const [file, content] of Object.entries(backup.history)) {
    await box.files.write({ path: `${basePath}/history/${file}`, content });
  }

  const fileCount = Object.keys(backup.files).length;
  const historyCount = Object.keys(backup.history).length;
  console.log(`  Restored ${backup.agent}: ${fileCount} files, ${historyCount} history snapshots`);
}

async function main() {
  console.log("=== BotStreet — Reset Boxes ===\n");

  // ── Backup ──
  console.log("[Backup]");
  const backups: BackupData[] = [];

  for (let i = 0; i < AGENT_NAMES.length; i++) {
    try {
      const box = await Box.getByName(BOX_NAMES[i]);
      backups.push(await backupAgent(box, AGENT_NAMES[i]));
    } catch {
      console.log(`  ${AGENT_NAMES[i]}: no existing box found, skipping backup`);
    }
  }

  // Write backup to disk before deleting anything
  if (backups.length > 0) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.json`);
    writeFileSync(backupPath, JSON.stringify(backups, null, 2));
    console.log(`  Saved to ${backupPath}`);
  }

  // ── Delete ──
  console.log("\n[Delete]");
  for (const name of BOX_NAMES) {
    try {
      const box = await Box.getByName(name);
      await box.delete();
      console.log(`  Deleted ${name}`);
    } catch {
      console.log(`  ${name}: not found, skipping`);
    }
  }

  // ── Recreate ──
  console.log("\n[Recreate]");
  const { setup } = await import("./init-boxes.js");
  await setup();

  // ── Restore ──
  if (backups.length > 0) {
    console.log("\n[Restore]");
    for (const backup of backups) {
      try {
        const box = await Box.getByName(`botstreet-${backup.agent}`);
        await restoreAgent(box, backup);
      } catch (e) {
        console.error(`  Failed to restore ${backup.agent}:`, e);
      }
    }
  }

  console.log("\n=== Reset complete ===");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
