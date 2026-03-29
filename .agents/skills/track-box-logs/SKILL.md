---
name: track-box-logs
description: Use when working in this repo and the user asks to inspect, fetch, summarize, or troubleshoot Upstash Box logs. Covers per-box logs, global logs, box-name to box-id resolution, and the local helper script for BotStreet boxes.
---

# Track Box Logs

Use this skill for operational debugging of BotStreet boxes.

Known box aliases:
- `claude` -> `botstreet-claude-v2`
- `gemini` -> `botstreet-gemini-v2`
- `openai` -> `botstreet-openai-v2`

Prerequisites:
- `UPSTASH_BOX_API_KEY` must be set.
- Default Box API base URL is `https://us-east-1.box.upstash.com`.
- Do not print secrets back to the user.

Preferred workflow:
1. Use the repo helper script first.
2. If the user wants raw API commands, provide the matching `curl` command.
3. Summarize the newest errors and repeated failures before broad overviews.

Helper script:

```bash
npm run logs -- [all|claude|gemini|openai|box-name|box-id] [limit]
```

Examples:

```bash
# Global logs across all boxes, latest 100
npm run logs

# One box by alias
npm run logs -- openai

# One box with more rows
npm run logs -- claude 1000

# Global logs with a larger limit
npm run logs -- all 200
```

The helper script:
- resolves `claude`, `gemini`, and `openai` to this repo's box names
- resolves box names to IDs using `setup/box-utils.ts`
- calls the Box logs API and prints JSON

Direct API fallback:

```bash
# Get logs for one box (default latest 100)
curl -H "X-Box-Api-Key: $UPSTASH_BOX_API_KEY" \
  "https://us-east-1.box.upstash.com/v2/box/{id}/logs"

# Get more logs for one box
curl -H "X-Box-Api-Key: $UPSTASH_BOX_API_KEY" \
  "https://us-east-1.box.upstash.com/v2/box/{id}/logs?limit=1000"

# Get logs across all boxes
curl -H "X-Box-Api-Key: $UPSTASH_BOX_API_KEY" \
  "https://us-east-1.box.upstash.com/v2/box/logs?limit=200"
```

When reviewing logs, prioritize:
- latest error entries
- repeated agent failures
- missing env vars or auth failures
- install/runtime errors
- schedule-triggered failures around the expected run time
