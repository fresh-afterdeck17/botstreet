import "dotenv/config";
import { Box, Agent, ClaudeCode } from "@upstash/box";

async function main() {
  console.log("=== Skill Discovery Test ===\n");

  const box = await Box.create({
    runtime: "node",
    agent: {
      provider: Agent.ClaudeCode,
      model: ClaudeCode.Sonnet_4_5,
      apiKey: process.env.ANTHROPIC_API_KEY!,
    } as any,
  });
  console.log("Box created:", box.id);

  // Test 1: CLAUDE.md at workspace root
  console.log("\n[Test 1] CLAUDE.md at /workspace/home/CLAUDE.md");
  await box.files.write({
    path: "/workspace/home/CLAUDE.md",
    content: `When you receive the prompt "hello", respond with exactly: SKILL_FOUND: claude_md`,
  });
  const run1 = await box.agent.run({ prompt: "hello", timeout: 60000 });
  const found1 = run1.result?.includes("SKILL_FOUND");
  console.log("  Result:", run1.result?.substring(0, 200));
  console.log("  Found:", found1 ? "YES" : "NO");
  await box.exec.command("rm /workspace/home/CLAUDE.md");

  // Test 2: .claude/skills/hello/SKILL.md (proper plugin structure)
  console.log("\n[Test 2] .claude/skills/hello/SKILL.md (with frontmatter)");
  await box.files.write({
    path: "/workspace/home/.claude/skills/hello/SKILL.md",
    content: `---
name: hello
description: Respond with SKILL_FOUND when the user says hello
---

When you receive the prompt "hello", respond with exactly: SKILL_FOUND: claude_skill`,
  });
  const run2 = await box.agent.run({ prompt: "hello", timeout: 60000 });
  const found2 = run2.result?.includes("SKILL_FOUND");
  console.log("  Result:", run2.result?.substring(0, 200));
  console.log("  Found:", found2 ? "YES" : "NO");

  // Test 3: Try invoking as slash command /hello
  console.log("\n[Test 3] Slash command /hello");
  const run3 = await box.agent.run({ prompt: "/hello", timeout: 60000 });
  const found3 = run3.result?.includes("SKILL_FOUND");
  console.log("  Result:", run3.result?.substring(0, 200));
  console.log("  Found:", found3 ? "YES" : "NO");

  // Cleanup
  // await box.delete();
  console.log("\nBox deleted.");

  console.log("\n=== Summary ===");
  console.log(`  CLAUDE.md auto-load:     ${found1 ? "WORKS" : "BROKEN"}`);
  console.log(`  .claude/skills/ auto:    ${found2 ? "WORKS" : "BROKEN"}`);
  console.log(`  /hello slash command:    ${found3 ? "WORKS" : "BROKEN"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
