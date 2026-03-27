import "dotenv/config";
import { Box, Agent, BoxApiKey, ClaudeCode, OpenAICodex, OpenCodeModel } from "@upstash/box";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface AgentDef {
  name: string;
  agent?: any;
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
    agent: {
      provider: Agent.OpenCode,
      model: OpenCodeModel.Zen_Gemini_3_1_Pro,
      apiKey: BoxApiKey.UpstashKey,
    },
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

  for (const config of agents) {
    console.log(`Creating box for ${config.name}...`);

    const boxConfig: any = {
      runtime: "node",
      name: `botstreet-${config.name}`,
    };
    if (config.agent) {
      boxConfig.agent = config.agent;
    }

    const box = await Box.create(boxConfig);
    console.log(`  Box created: ${box.id} (${boxConfig.name})`);

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

    // Upload SKILL.md as the auto-loaded config file for each agent type:
    // - CLAUDE.md for Claude Code agents
    // - AGENTS.md for OpenAI Codex/OpenCode agents
    // - SKILL.md retained for compatibility and direct reads
    const skillPath = path.join(ROOT, "skill/SKILL.md");
    await box.files.upload([
      { path: skillPath, destination: "/workspace/home/CLAUDE.md" },
      { path: skillPath, destination: "/workspace/home/AGENTS.md" },
      { path: skillPath, destination: "/workspace/home/SKILL.md" },
    ]);
    console.log(`  Uploaded CLAUDE.md + AGENTS.md + SKILL.md`);

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

  console.log(
    "=== Setup complete. Boxes named: botstreet-claude, botstreet-gemini, botstreet-openai ===\n",
  );
}

export { setup };

// Run directly if this is the main module
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  setup().catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
}
