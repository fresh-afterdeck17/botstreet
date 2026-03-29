import "dotenv/config";
import { getBoxByName } from "./box-utils.js";

const BASE_URL = process.env.UPSTASH_BOX_BASE_URL ?? "https://us-east-1.box.upstash.com";
const API_KEY = process.env.UPSTASH_BOX_API_KEY;

const BOX_ALIASES: Record<string, string> = {
  claude: "botstreet-claude-v2",
  gemini: "botstreet-gemini-v2",
  openai: "botstreet-openai-v2",
};

function usage(): never {
  console.error(
    "usage: tsx setup/box-logs.ts [all|claude|gemini|openai|box-name|box-id] [limit] [--tail]",
  );
  process.exit(1);
}

function normalizeLimit(raw: string | undefined): number {
  if (!raw) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid limit: ${raw}`);
  }
  return value;
}

async function resolveBoxId(target: string): Promise<string> {
  if (target.startsWith("box_")) {
    return target;
  }

  const boxName = BOX_ALIASES[target] ?? target;
  const box = await getBoxByName(boxName);
  return box.id;
}

async function fetchLogs(path: string) {
  if (!API_KEY) {
    throw new Error("UPSTASH_BOX_API_KEY is required");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Box-Api-Key": API_KEY,
    },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Logs request failed (${res.status} ${res.statusText}): ${body}`);
  }

  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }
}

async function fetchLogsJson(path: string): Promise<any[]> {
  if (!API_KEY) {
    throw new Error("UPSTASH_BOX_API_KEY is required");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Box-Api-Key": API_KEY,
    },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Logs request failed (${res.status} ${res.statusText}): ${body}`);
  }

  const parsed = JSON.parse(body) as { logs?: any[] };
  return parsed.logs ?? [];
}

function logKey(entry: any, fallbackTarget: string): string {
  return [
    entry.box_id ?? fallbackTarget,
    entry.timestamp ?? "",
    entry.level ?? "",
    entry.source ?? "",
    entry.message ?? "",
  ].join("|");
}

function printEntry(entry: any, fallbackTarget: string) {
  const iso = new Date((entry.timestamp ?? 0) * 1000).toISOString();
  const scope = entry.box_id ?? fallbackTarget;
  const level = entry.level ?? "info";
  const source = entry.source ?? "system";
  const message = typeof entry.message === "string" ? entry.message.trimEnd() : String(entry.message);
  console.log(`[${iso}] [${scope}] [${source}/${level}] ${message}`);
}

async function tailLogs(path: string, target: string, limit: number) {
  const seen = new Set<string>();
  const pollMs = 2_000;

  const initial = await fetchLogsJson(path);
  for (const entry of [...initial].reverse()) {
    seen.add(logKey(entry, target));
    printEntry(entry, target);
  }

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const logs = await fetchLogsJson(path);
    const fresh = [...logs]
      .reverse()
      .filter((entry) => {
        const key = logKey(entry, target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    for (const entry of fresh) {
      printEntry(entry, target);
    }

    if (seen.size > limit * 20) {
      const recent = logs.slice(0, limit).map((entry) => logKey(entry, target));
      seen.clear();
      for (const key of recent) seen.add(key);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const tail = args.includes("--tail");
  const positional = args.filter((arg) => arg !== "--tail");
  const target = positional[0] ?? "all";
  const limit = normalizeLimit(positional[1]);

  if (target === "--help" || target === "-h") {
    usage();
  }

  if (target === "all") {
    const path = `/v2/box/logs?limit=${limit}`;
    if (tail) {
      await tailLogs(path, target, limit);
      return;
    }
    await fetchLogs(path);
    return;
  }

  const boxId = await resolveBoxId(target);
  const path = `/v2/box/${boxId}/logs?limit=${limit}`;
  if (tail) {
    await tailLogs(path, target, limit);
    return;
  }
  await fetchLogs(path);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
