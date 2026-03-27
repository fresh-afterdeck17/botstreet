import "dotenv/config";
import { Box } from "@upstash/box";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBoxByName, isBoxNotFoundError } from "./box-utils.js";

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

  for (const file of AGENT_FILES) {
    try {
      backup.files[file] = await box.files.read(`${basePath}/${file}`);
    } catch {}
  }

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
      } catch {}
    }
  } catch {}

  const fileCount = Object.keys(backup.files).length;
  const historyCount = Object.keys(backup.history).length;
  console.log(`  Backed up ${agent}: ${fileCount} files, ${historyCount} history snapshots`);
  return backup;
}

async function restoreAgent(box: Box, backup: BackupData): Promise<void> {
  const basePath = `/workspace/home/agents/${backup.agent}`;

  for (const [file, content] of Object.entries(backup.files)) {
    await box.files.write({ path: `${basePath}/${file}`, content });
  }
  for (const [file, content] of Object.entries(backup.history)) {
    await box.files.write({ path: `${basePath}/history/${file}`, content });
  }

  const fileCount = Object.keys(backup.files).length;
  const historyCount = Object.keys(backup.history).length;
  console.log(`  Restored ${backup.agent}: ${fileCount} files, ${historyCount} history snapshots`);
}

function saveBackupToDisk(backups: BackupData[]): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backups, null, 2));
  return backupPath;
}

function loadBackupFromDisk(backupPath: string): BackupData[] {
  return JSON.parse(readFileSync(backupPath, "utf-8"));
}

async function restoreFromDisk(backupPath: string) {
  console.log(`\n[Restore from disk: ${backupPath}]`);
  const backups = loadBackupFromDisk(backupPath);
  for (const backup of backups) {
    try {
      const box = await getBoxByName(`botstreet-${backup.agent}`);
      await restoreAgent(box, backup);
    } catch (e) {
      console.error(`  Failed to restore ${backup.agent}:`, e);
    }
  }
}

async function main() {
  // If called with a backup file path, just restore from that file
  const restoreArg = process.argv[2];
  if (restoreArg && existsSync(restoreArg)) {
    await restoreFromDisk(restoreArg);
    console.log("\n=== Restore complete ===");
    return;
  }

  console.log("=== BotStreet — Reset Boxes ===\n");

  // ── 1. Backup ──
  console.log("[1/4 Backup]");
  const backups: BackupData[] = [];

  for (let i = 0; i < AGENT_NAMES.length; i++) {
    try {
      const box = await getBoxByName(BOX_NAMES[i]);
      backups.push(await backupAgent(box, AGENT_NAMES[i]));
    } catch (error) {
      if (isBoxNotFoundError(error, BOX_NAMES[i])) {
        console.log(`  ${AGENT_NAMES[i]}: no existing box found, skipping`);
        continue;
      }

      throw error;
    }
  }

  // ── 2. Save to disk BEFORE deleting ──
  let backupPath = "";
  if (backups.length > 0) {
    backupPath = saveBackupToDisk(backups);
    console.log(`  Saved to ${backupPath}`);
  }

  // ── 3. Delete ──
  console.log("\n[2/4 Delete]");
  for (const name of BOX_NAMES) {
    try {
      const box = await getBoxByName(name);
      await box.delete();
      console.log(`  Deleted ${name}`);
    } catch (error) {
      if (isBoxNotFoundError(error, name)) {
        console.log(`  ${name}: not found, skipping`);
        continue;
      }

      throw error;
    }
  }

  // ── 4. Recreate ──
  console.log("\n[3/4 Recreate]");
  const { setup } = await import("./init-boxes.js");
  await setup();

  // ── 5. Restore ──
  console.log("\n[4/4 Restore]");
  if (backupPath) {
    // Always restore from disk file — the source of truth
    await restoreFromDisk(backupPath);
  } else {
    console.log("  No backup to restore.");
  }

  // ── 6. Re-apply schedules ──
  console.log("\n[5/5 Schedules]");
  const { setupSchedules } = await import("./setup-schedules.js");
  await setupSchedules();

  console.log("\n=== Reset complete ===");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  if (existsSync(BACKUP_DIR)) {
    console.error(`\nBackups are safe in ${BACKUP_DIR}`);
    console.error("To restore manually: npx tsx setup/reset-boxes.ts <backup-file-path>");
  }
  process.exit(1);
});
