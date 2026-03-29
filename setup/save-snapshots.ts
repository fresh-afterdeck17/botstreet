import "dotenv/config";
import { getBoxByName } from "./box-utils.js";

const AGENTS = [
  { name: "claude", boxName: "botstreet-claude-v2" },
  { name: "gemini", boxName: "botstreet-gemini-v2" },
  { name: "openai", boxName: "botstreet-openai-v2" },
] as const;

async function runSnapshot(agent: (typeof AGENTS)[number]) {
  try {
    const box = await getBoxByName(agent.boxName);

    // Snapshots fail if the box is auto-paused, so resume first.
    let status = await box.getStatus();
    if (status.status === "paused") {
      await box.resume();

      const maxWaitMs = 60_000;
      const pollIntervalMs = 2_000;
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        status = await box.getStatus();
        if (status.status !== "paused") break;
      }

      if (status.status === "paused") {
        throw new Error(`Box ${agent.boxName} did not resume in time`);
      }
    }

    const prefix = process.argv[2] || "manual";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshot = await box.snapshot({
      name: `${prefix}-${agent.name}-${timestamp}`,
    });

    return {
      agent: agent.name,
      ok: snapshot.status === "ready",
      snapshot: {
        id: snapshot.id,
        name: snapshot.name,
        boxId: snapshot.box_id,
        status: snapshot.status,
        sizeBytes: snapshot.size_bytes,
        createdAt: snapshot.created_at,
      },
    };
  } catch (error) {
    return {
      agent: agent.name,
      ok: false,
      error: String(error),
    };
  }
}

async function main() {
  const results = await Promise.all(AGENTS.map(runSnapshot));
  const ok = results.every((result) => result.ok);

  console.log(JSON.stringify({ ok, results }, null, 2));

  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
