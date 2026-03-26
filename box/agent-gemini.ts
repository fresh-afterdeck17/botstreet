import { generateText, tool } from "ai";
import { google } from "@ai-sdk/google";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { z } from "zod";

const SKILL = readFileSync("/workspace/home/SKILL.md", "utf-8");

const { text } = await generateText({
  model: google("gemini-2.5-pro"),
  system: SKILL,
  prompt: "Execute the daily trading process now. The command is: trade",
  tools: {
    shell: tool({
      description:
        "Execute a shell command in /workspace/home and return its stdout. Use this for running trading tools like: npx tsx tools/portfolio.ts, npx tsx tools/trade.ts, npx tsx tools/prices.ts, npx tsx tools/validator.ts, npx tsx tools/snapshot.ts, npx tsx tools/search.ts",
      parameters: z.object({
        command: z.string().describe("The shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const result = execSync(command, {
            cwd: "/workspace/home",
            encoding: "utf-8",
            timeout: 60000,
            env: { ...process.env, PATH: process.env.PATH },
          });
          return result;
        } catch (e: any) {
          return `ERROR: ${e.stderr || e.message}`;
        }
      },
    }),
    readFile: tool({
      description: "Read a file and return its contents",
      parameters: z.object({
        path: z.string().describe("Absolute path to the file"),
      }),
      execute: async ({ path }) => {
        try {
          return readFileSync(path, "utf-8");
        } catch (e: any) {
          return `ERROR: ${e.message}`;
        }
      },
    }),
    writeFile: tool({
      description: "Write content to a file (create or overwrite)",
      parameters: z.object({
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("Content to write"),
      }),
      execute: async ({ path, content }) => {
        try {
          writeFileSync(path, content);
          return "OK";
        } catch (e: any) {
          return `ERROR: ${e.message}`;
        }
      },
    }),
  },
  maxSteps: 30,
});

console.log(text);
