import "dotenv/config";
import { Box, Agent, ClaudeCode, OpenAICodex } from "@upstash/box";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface AgentDef {
  name: string;
  agent?: any;
  customAgent?: boolean;
}

const agents: AgentDef[] = [
  {
    name: "claude",
    agent: {
      provider: Agent.ClaudeCode,
      model: ClaudeCode.Opus_4_6,
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
  },
  {
    name: "gemini",
    customAgent: true,
  },
  {
    name: "openai",
    agent: {
      provider: Agent.Codex,
      model: "openai/gpt-5.4",
      apiKey: process.env.OPENAI_API_KEY!,
    },
  },
];

function initialPortfolio(agentName: string): string {
  return JSON.stringify(
    {
      agent: agentName,
      updated_at: new Date().toISOString(),
      starting_balance: 100000,
      cash: 100000,
      holdings: [],
      total_value: 100000,
      all_time_return_pct: 0,
      day_number: 0,
      start_date: new Date().toISOString().split("T")[0],
      last_action: null,
      last_trade_date: null,
    },
    null,
    2,
  );
}

async function setup() {
  console.log("=== BotStreet — Box Setup ===\n");

  const boxIds: Record<string, string> = {};

  for (const config of agents) {
    console.log(`Creating box for ${config.name}...`);

    const boxConfig: any = { runtime: "node" };
    if (config.agent) {
      boxConfig.agent = config.agent;
    }

    const box = await Box.create(boxConfig);
    console.log(`  Box created: ${box.id}`);
    boxIds[config.name] = box.id;

    // Upload package.json and tsconfig.json
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

    // Upload SKILL.md to workspace root
    await box.files.upload([
      {
        path: path.join(ROOT, "skill/SKILL.md"),
        destination: "/workspace/home/SKILL.md",
      },
    ]);
    console.log(`  Uploaded SKILL.md`);

    // Upload custom agent script for Gemini
    if (config.customAgent) {
      await box.files.upload([
        {
          path: path.join(ROOT, "box/agent-gemini.ts"),
          destination: "/workspace/home/agent-gemini.ts",
        },
      ]);
      console.log(`  Uploaded agent-gemini.ts`);
    }

    // Write initial portfolio, diary, memory
    await box.files.write({
      path: `/workspace/home/agents/${config.name}/portfolio.json`,
      content: initialPortfolio(config.name),
    });
    await box.files.write({
      path: `/workspace/home/agents/${config.name}/diary.md`,
      content: "# Trading Diary\n",
    });
    await box.files.write({
      path: `/workspace/home/agents/${config.name}/memory.md`,
      content: "# Trading Memory\n",
    });
    await box.files.write({
      path: `/workspace/home/agents/${config.name}/today_trades.json`,
      content: "[]",
    });
    await box.files.write({
      path: `/workspace/home/agents/${config.name}/history/.gitkeep`,
      content: "",
    });
    console.log(`  Initialized agent files`);

    // Write .env inside box
    const envLines: string[] = [];
    if (process.env.BRAVE_API_KEY)
      envLines.push(`BRAVE_API_KEY=${process.env.BRAVE_API_KEY}`);
    if (config.customAgent && process.env.GOOGLE_API_KEY) {
      envLines.push(
        `GOOGLE_GENERATIVE_AI_API_KEY=${process.env.GOOGLE_API_KEY}`,
      );
    }
    if (envLines.length > 0) {
      await box.files.write({
        path: "/workspace/home/.env",
        content: envLines.join("\n") + "\n",
      });
      console.log(`  Wrote .env`);
    }

    // Install dependencies
    console.log(`  Installing dependencies...`);
    const install = await box.exec.command("cd /workspace/home && npm install");
    console.log(`  npm install: ${install.status}`);

    console.log(`  ✓ ${config.name} ready\n`);
  }

  console.log("=== Box IDs (add these to your .env) ===\n");
  for (const [name, id] of Object.entries(boxIds)) {
    console.log(`BOX_${name.toUpperCase()}_ID=${id}`);
  }
  console.log();
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
