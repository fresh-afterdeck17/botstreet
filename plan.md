# BotStreet — Project Plan

## Overview

Three AI agents (Claude, Gemini, OpenAI) each receive $100,000 in virtual money. Each agent lives in its own Upstash Box — a persistent cloud sandbox with durable storage. Each day, a trigger script sends the prompt `trade` to all three boxes. Each agent reads its SKILL.md, uses the shared tools to research the market, makes trading decisions, and writes its results back to its own filesystem. A SvelteKit dashboard displays the live competition.

The experiment tests the full AI investment pipeline: research quality, synthesis, and decision-making. Each agent does its own research using the same tools, so discovering _what_ to invest in is part of the competition.

---

## Architecture

Each agent runs in its own Upstash Box with durable storage. Boxes sleep when idle and wake instantly with all state intact. A shared SKILL.md defines the rules, and shared tools handle all math and validation.

```
Trigger script (@upstash/box SDK)
│
├── Box: claude-trader  (Claude Code built-in)
│   ├── .agents/skills/trade/SKILL.md
│   ├── tools/
│   └── agents/claude/  →  portfolio.json, diary.md, memory.md, history/
│
├── Box: gemini-trader  (Gemini CLI / agent)
│   ├── .agents/skills/trade/SKILL.md
│   ├── tools/
│   └── agents/gemini/  →  portfolio.json, diary.md, memory.md, history/
│
├── Box: openai-trader  (Codex built-in)
│   ├── .agents/skills/trade/SKILL.md
│   ├── tools/
│   └── agents/openai/  →  portfolio.json, diary.md, memory.md, history/
│
└── SvelteKit dashboard  →  reads portfolio data from all 3 boxes
```

### Why Upstash Box

- **Durable storage**: Files persist across runs. Each agent's portfolio, diary, memory, and history survive between sessions without git commits or external databases.
- **Built-in agent support**: Claude Code and Codex are built into Box. No local CLI setup needed.
- **Sleep/wake**: Boxes sleep when idle (no cost), wake instantly with full state when triggered.
- **Isolation**: Each agent runs in its own container. No interference, no shared state.
- **Serverless billing**: Pay per active CPU time, not idle time. One daily run per box is extremely cheap.

---

## Shared Skill: `trade`

Located at `.agents/skills/trade/SKILL.md` inside each box. This is the single source of truth for all three agents. It defines:

- What the agent is (virtual portfolio manager)
- The daily process (step by step)
- Trading rules and constraints
- Which tools to use and how
- File schemas (portfolio.json, diary.md, memory.md, history/)
- What files to update after each run

The SKILL.md tells the agent _what_ to do. The tools enforce _correctness_. The agent decides, the tools execute.

---

## Tools

Shared TypeScript functions in `tools/`. These handle all arithmetic, price fetching, and file I/O. The agent never does math or edits portfolio.json directly — everything goes through the tools.

| Tool                      | Signature                                                | Description                                                   |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `web_search`              | `(query: string) → results[]`                            | General web search for news, analysis, sentiment              |
| `get_historical_prices`   | `(ticker: string, days: number) → price_data[]`          | Daily OHLCV data for trend analysis                           |
| `get_current_prices`      | `(tickers: string[]) → price_map`                        | Current price quotes for one or more tickers                  |
| `get_portfolio`           | `(agent: string) → portfolio`                            | Read agent's current holdings, cash, total value              |
| `validate_ticker`         | `(ticker: string) → {valid, type, name}`                 | Check if a ticker is tradeable and what asset type it is      |
| `execute_trade`           | `(agent: string, ticker, action, amount) → confirmation` | Buy or sell — does all math, updates portfolio.json           |
| `save_snapshot`           | `(agent: string) → confirmation`                         | Copies current portfolio to history/portfolio_YYYY_MM_DD.json |
| `update_portfolio_prices` | `(agent: string) → portfolio`                            | Fetches current prices for all holdings, recalculates values  |

### Why tools own the math

If an agent tries to calculate "buy 312.5 shares at $160 = $50,000" it will eventually get the arithmetic wrong. Compounding errors over 90 days would corrupt the simulation. The tools do all calculations:

- `execute_trade`: calculates shares = amount / price, updates cash, recalculates totals
- `update_portfolio_prices`: fetches fresh prices, recalculates each holding's dollar value and P&L
- `save_snapshot`: copies the current (tool-validated) state to the daily history file

The agent only makes decisions: "buy NVDA for $20,000." The tool handles the rest.

### Tool Implementation

All tools in TypeScript using `yahoo-finance2` for price data.

- **web_search**: Wraps a search API (Brave Search, Tavily, or SerpAPI). Same API key for all agents.
- **get_historical_prices / get_current_prices**: `yahoo-finance2` npm package. Free, no API key.
- **get_portfolio / execute_trade / save_snapshot / update_portfolio_prices**: Read/write the agent's own `portfolio.json` and `history/` directory. All math happens here.
- **validate_ticker**: Uses `yahoo-finance2` to check existence and classify asset type.

---

## Investable Universe

**Open universe.** Agents can trade any ticker they discover through research — there is no predefined list. Finding good investments is part of the competition.

### Allowed Asset Types

| Type          | Examples                                | Rule                                                  |
| ------------- | --------------------------------------- | ----------------------------------------------------- |
| Stocks        | AAPL, NVDA, any publicly traded company | Any stock that returns valid data from yahoo-finance2 |
| Stock ETFs    | SPY, QQQ, XLE, sector ETFs, etc.        | Equity ETFs only                                      |
| Gold / Metals | GLD, SLV, IAU, GDX, etc.                | Gold and precious metals ETFs                         |
| Cash          | CASH                                    | US Dollar, earns 0%                                   |

### Prohibited Asset Types

| Type              | Why                                                                    |
| ----------------- | ---------------------------------------------------------------------- |
| Options           | Too complex for daily simulation, pricing not straightforward          |
| Bonds / Bond ETFs | No TLT, BND, AGG, etc. — keeps the game focused on equities and metals |
| Futures           | Not cleanly supported                                                  |
| Crypto            | Out of scope — different market hours, different dynamics              |
| Shorting          | Can only sell what you hold                                            |
| Forex             | Out of scope                                                           |

### Trade Validation

The `execute_trade` tool validates every trade before applying it:

1. **Ticker exists**: `yahoo-finance2` quote returns valid data
2. **Asset type check**: Must be a stock, equity ETF, or metals ETF — not a bond fund, option, or future
3. **Price is fresh**: Most recent price is from the current or previous trading day
4. **Rules pass**: Position size within limits, sufficient cash for buys, sufficient holdings for sells

If validation fails, the tool returns an error. The agent can retry or skip.

---

## Trading Rules

1. Starting balance: $100,000 per agent
2. Open universe — any ticker supported by yahoo-finance2
3. Allowed: stocks, equity ETFs, gold/metals ETFs, cash
4. Prohibited: bonds, bond ETFs, options, futures, crypto, forex
5. No shorting — can only sell what you hold
6. Max single position: 50% of portfolio
7. Trades execute at current market price (no limit orders)
8. Cash earns 0%

---

## File Structure

Each Upstash Box contains this file tree:

```
/ (inside each box)
│
├── .agents/skills/trade/
│   └── SKILL.md                 # Shared skill — agent reads this on "trade"
│
├── tools/
│   ├── search.ts                # Web search wrapper
│   ├── prices.ts                # yahoo-finance2 wrapper
│   ├── portfolio.ts             # Portfolio read/write/recalculate
│   ├── validator.ts             # Ticker validation + asset classification
│   ├── trade.ts                 # Trade execution + rule enforcement
│   └── snapshot.ts              # Save daily snapshot to history/
│
├── agents/{agent_name}/
│   ├── portfolio.json           # Current state (only modified by tools/)
│   ├── diary.md                 # Last 7 days of entries
│   ├── memory.md                # Long-term knowledge
│   └── history/                 # Daily snapshots
│       ├── portfolio_2026_02_10.json
│       ├── portfolio_2026_02_11.json
│       └── ...
│
├── package.json
└── tsconfig.json
```

The trigger and dashboard live outside the boxes:

```
botstreet/                      # Your local / CI repo
│
├── trigger/
│   └── run-daily.ts             # @upstash/box SDK — sends "trade" to all 3 boxes
│
├── web/                         # SvelteKit dashboard
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte     # Home — leaderboard with 3 agent cards
│   │   │   ├── +page.server.ts  # Server load: fetch portfolios from boxes
│   │   │   ├── agent/[name]/
│   │   │   │   ├── +page.svelte     # Agent detail — full diary, trade history
│   │   │   │   └── +page.server.ts
│   │   │   └── +layout.svelte
│   │   └── lib/
│   │       ├── fetch-portfolios.ts  # Uses @upstash/box SDK to read files from boxes
│   │       ├── fetch-history.ts     # Reads history/*.json from boxes
│   │       ├── types.ts             # Shared TypeScript types
│   │       └── components/
│   │           ├── AgentCard.svelte
│   │           ├── MarketBar.svelte
│   │           ├── HoldingsTable.svelte
│   │           ├── PerformanceChart.svelte
│   │           └── TradeHistory.svelte
│   ├── package.json
│   └── svelte.config.js
│
├── setup/
│   └── init-boxes.ts            # Creates 3 boxes, uploads SKILL.md + tools + initial portfolio
│
├── package.json
└── README.md
```

---

## Data Schemas

### portfolio.json

```json
{
  "agent": "claude",
  "updated_at": "2026-03-24T09:35:00Z",
  "starting_balance": 100000,
  "cash": 22569.2,
  "holdings": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA Corp",
      "dollars": 39496.45,
      "shares": 265.25,
      "avg_entry_price": 142.3,
      "current_price": 148.9,
      "unrealized_pnl_pct": 4.63
    },
    {
      "ticker": "MSFT",
      "name": "Microsoft",
      "dollars": 28212.15,
      "shares": 67.45,
      "avg_entry_price": 410.5,
      "current_price": 418.2,
      "unrealized_pnl_pct": 1.88
    }
  ],
  "total_value": 112847.0,
  "all_time_return_pct": 12.85,
  "day_number": 42,
  "start_date": "2026-02-10",
  "last_action": {
    "summary": "Sold 50% of AAPL position, rotated into NVDA. AI infrastructure spend accelerating per latest earnings.",
    "timestamp": "2026-03-24T09:35:00Z"
  }
}
```

### history/portfolio_2026_03_24.json (daily snapshot)

```json
{
  "date": "2026-03-24",
  "day_number": 42,
  "total_value": 112847.0,
  "cash": 22569.2,
  "all_time_return_pct": 12.85,
  "holdings": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA Corp",
      "dollars": 39496.45,
      "shares": 265.25,
      "current_price": 148.9
    },
    {
      "ticker": "MSFT",
      "name": "Microsoft",
      "dollars": 28212.15,
      "shares": 67.45,
      "current_price": 418.2
    }
  ],
  "trades": [
    {
      "action": "sell",
      "ticker": "AAPL",
      "amount": 15000,
      "price": 189.5,
      "reason": "Rotating out of hardware into AI infra"
    },
    {
      "action": "buy",
      "ticker": "NVDA",
      "amount": 15000,
      "price": 148.9,
      "reason": "AI infrastructure spend accelerating"
    }
  ]
}
```

### diary.md (example entry)

```markdown
## Day 42 — March 24, 2026

### Market Overview

Broad market up on strong jobs data. Tech outperforming. Fed minutes released with no surprises — rates steady. VIX low at 14.3, risk-on sentiment.

### Research Findings

- NVDA: Datacenter revenue beat expectations by 12%. Hyperscaler capex guidance raised.
- AAPL: iPhone sales flat in China. No near-term catalyst.
- Gold: Steady. No flight to safety given low VIX.

### Decisions

- SOLD $15,000 of AAPL — no growth catalyst, better opportunities elsewhere
- BOUGHT $15,000 of NVDA — riding the AI infrastructure wave

### Portfolio After Trades

Total: $112,847 | Cash: 20% | NVDA: 35% | MSFT: 25% | QQQ: 20%

### Conviction Level

High. Current positioning aligned with AI infrastructure thesis. Watching Fed closely for any rate surprise.
```

### memory.md (example)

```markdown
# Trading Memory

## Current Thesis

AI infrastructure is the dominant theme. Overweight semis and cloud. Underweight consumer discretionary.

## Position Rationales

- **NVDA**: Core AI pick. Datacenter growth accelerating. Hold until thesis breaks.
- **MSFT**: Azure + Copilot monetization. Steady compounder.
- **QQQ**: Broad tech exposure as a hedge against single-stock risk.

## Lessons Learned

- Day 12: Got burned chasing TSLA on headline hype. Down 4% in 2 days. Don't trade on tweets.
- Day 28: GLD hedge worked well during banking scare. Keep 5-10% in defensive assets during uncertainty.

## Patterns to Watch

- When VIX > 20, shift 10-15% to cash or GLD
- Earnings season creates overreactions — wait 1 day before trading on results
- Fed meeting weeks: reduce position sizes

## Mistakes to Avoid

- Don't hold more than 35% in any single stock
- Don't trade on day 1 of a news cycle — wait for confirmation
```

---

## Trigger Script

Uses `@upstash/box` SDK to send the `trade` prompt to all three boxes. Can run from a cron job, GitHub Action, or Upstash Workflow.

```typescript
// trigger/run-daily.ts
import { Box } from "@upstash/box";

const agents = [
  { name: "claude", boxId: process.env.BOX_CLAUDE_ID! },
  { name: "gemini", boxId: process.env.BOX_GEMINI_ID! },
  { name: "openai", boxId: process.env.BOX_OPENAI_ID! },
];

async function runDaily() {
  console.log(`=== BotStreet — ${new Date().toISOString()} ===`);

  // Run all 3 agents in parallel
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      console.log(`Running ${agent.name} agent...`);
      const box = new Box({ id: agent.boxId });
      const result = await box.prompt("trade");
      console.log(`${agent.name} done.`);
      return result;
    }),
  );

  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(`${agents[i].name} failed:`, result.reason);
    }
  }

  console.log("All agents complete.");
}

runDaily();
```

### Scheduling Options

- **GitHub Action**: cron schedule, calls `npx tsx trigger/run-daily.ts`
- **Upstash Workflow**: serverless, durable, retries on failure
- **Simple cron**: on any always-on server

---

## Setup Script

One-time script to create the three boxes and upload the shared files:

```typescript
// setup/init-boxes.ts
import { Box } from "@upstash/box";

const agentNames = ["claude", "gemini", "openai"];

async function setup() {
  for (const name of agentNames) {
    const box = await Box.create({
      name: `${name}-trader`,
      runtime: "node", // or whichever runtime the agent needs
    });

    // Upload shared skill
    await box.upload(".agents/skills/trade/SKILL.md", skillContent);

    // Upload tools
    await box.upload("tools/prices.ts", pricesToolContent);
    await box.upload("tools/trade.ts", tradeToolContent);
    // ... etc

    // Upload initial portfolio ($100K cash)
    await box.upload(
      `agents/${name}/portfolio.json`,
      JSON.stringify(
        {
          agent: name,
          updated_at: new Date().toISOString(),
          starting_balance: 100000,
          cash: 100000,
          holdings: [],
          total_value: 100000,
          all_time_return_pct: 0,
          day_number: 0,
          start_date: new Date().toISOString().split("T")[0],
          last_action: null,
        },
        null,
        2,
      ),
    );

    // Create empty diary and memory
    await box.upload(`agents/${name}/diary.md`, "# Trading Diary\n");
    await box.upload(`agents/${name}/memory.md`, "# Trading Memory\n");

    console.log(`${name} box created: ${box.id}`);
  }
}

setup();
```

---

## Dashboard (SvelteKit)

The dashboard uses `@upstash/box` SDK in server load functions to read portfolio files from each box's filesystem. No local file access needed — everything goes through the Box API.

### Pages

**`/` — Home (Leaderboard)**

- Market bar (S&P 500, NASDAQ, DOW, VIX)
- Three agent cards ranked by total portfolio value
- Each card: value, all-time return, sparkline, today/week/month performance, top holdings, last action

**`/agent/[name]` — Agent Detail**

- Full portfolio breakdown with all holdings
- Performance chart (built from history/portfolio\_\*.json files)
- Recent diary entries
- Trade history (from trades array in each daily snapshot)

### Data Flow

```
Box: claude-trader  → @upstash/box SDK →  fetch portfolio.json + history/  ─┐
Box: gemini-trader  → @upstash/box SDK →  fetch portfolio.json + history/  ─┼→  SvelteKit server load  →  rendered page
Box: openai-trader  → @upstash/box SDK →  fetch portfolio.json + history/  ─┘
```

For the market bar, fetch live index data from yahoo-finance2 at request time (with reasonable caching).

### Hosting

Deploy on Vercel. Dashboard reads from Upstash Boxes at request time (with cache headers so it doesn't hit boxes on every page load — once per hour is plenty since data only changes once a day).

---

## Tech Stack

| Component         | Technology                                       |
| ----------------- | ------------------------------------------------ |
| Language          | TypeScript                                       |
| Agent execution   | Upstash Box (cloud sandbox per agent)            |
| Agent runtimes    | Claude Code (built-in), Codex (built-in), Gemini |
| Skill standard    | `.agents/skills/` (open standard, cross-agent)   |
| Box SDK           | `@upstash/box` (trigger, file I/O, setup)        |
| Price data        | yahoo-finance2 (npm, free, no API key)           |
| Web search (tool) | Brave Search API or Tavily                       |
| State storage     | Durable filesystem inside each Upstash Box       |
| Dashboard         | SvelteKit (server load functions)                |
| Dashboard hosting | Vercel                                           |
| Styling           | Tailwind CSS                                     |
| Scheduling        | GitHub Action / Upstash Workflow / cron          |

---

## Milestones

### Phase 1 — Foundation

**Tasks:**

- [ ] Integrate `@upstash/box` account, test SDK
- [ ] Write SKILL.md
- [ ] Implement all 8 tool functions in TypeScript
- [ ] Create `setup/init-boxes.ts` to bootstrap 3 boxes
- [ ] Create initial portfolio.json files (3x $100K cash)
- [ ] Upload everything to boxes

**Tests:**

| Test                                   | Input                                 | Expected Output                                                         |
| -------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Box SDK connection                     | `box.ping()`                          | Returns success, box is reachable                                       |
| File upload/download                   | Upload a test file, read it back      | Content matches exactly                                                 |
| `get_current_prices`                   | `["AAPL", "MSFT"]`                    | Returns valid prices, both > 0, includes timestamp                      |
| `get_current_prices` — invalid ticker  | `["XYZNOTREAL"]`                      | Returns error, does not crash                                           |
| `get_historical_prices`                | `("NVDA", 30)`                        | Returns 30 data points with date, open, high, low, close, volume        |
| `validate_ticker` — stock              | `"AAPL"`                              | `{ valid: true, type: "stock", name: "Apple Inc." }`                    |
| `validate_ticker` — equity ETF         | `"SPY"`                               | `{ valid: true, type: "etf", name: "SPDR S&P 500..." }`                 |
| `validate_ticker` — metals ETF         | `"GLD"`                               | `{ valid: true, type: "metals", name: "SPDR Gold..." }`                 |
| `validate_ticker` — bond ETF (blocked) | `"TLT"`                               | `{ valid: false, type: "bond", reason: "bonds not allowed" }`           |
| `validate_ticker` — nonsense           | `"ZZZZZZ"`                            | `{ valid: false, reason: "ticker not found" }`                          |
| `get_portfolio` — initial state        | Read fresh portfolio.json             | `{ cash: 100000, holdings: [], total_value: 100000 }`                   |
| `execute_trade` — buy                  | `("claude", "AAPL", "buy", 10000)`    | Cash decreases by 10000, AAPL appears in holdings, shares = 10000/price |
| `execute_trade` — sell                 | Sell existing AAPL position           | Cash increases, AAPL removed from holdings                              |
| `execute_trade` — insufficient cash    | Buy for $200,000 with $100K cash      | Returns error, portfolio unchanged                                      |
| `execute_trade` — sell more than held  | Sell $50K of AAPL when holding $10K   | Returns error, portfolio unchanged                                      |
| `execute_trade` — position limit       | Buy $60K of one stock (>50% of $100K) | Returns error, portfolio unchanged                                      |
| `execute_trade` — blocked asset        | `("claude", "TLT", "buy", 5000)`      | Returns error, bonds not allowed                                        |
| `update_portfolio_prices`              | Portfolio with AAPL + MSFT holdings   | All prices updated, dollars recalculated, total_value recomputed        |
| `save_snapshot`                        | After a trade                         | `history/portfolio_YYYY_MM_DD.json` exists, contains trades array       |
| Math accuracy                          | Buy $25,000 of stock at $150.00       | shares = 166.6667, dollars = 25000.00, cash = 75000.00 (exact)          |
| Math accuracy — sell partial           | Sell $10,000 of $25,000 position      | Remaining shares correct, cash correct, avg_entry_price unchanged       |
| `web_search`                           | `"stock market news today"`           | Returns results array with titles and URLs                              |

---

### Phase 2 — Single Agent End-to-End

**Tasks:**

- [ ] Send `trade` to the Claude box, verify full cycle
- [ ] Verify portfolio math is correct (tools do all arithmetic)
- [ ] Verify diary, memory, and history files are written correctly
- [ ] Fix edge cases (insufficient cash, invalid ticker, weekend prices)

**Tests:**

| Test                       | How                                         | Expected Outcome                                                                    |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Skill discovery            | Send `trade` to Claude box                  | Agent acknowledges reading SKILL.md, begins daily process                           |
| Price update               | Check portfolio.json after run              | All holdings have fresh `current_price` from today or previous trading day          |
| Portfolio math integrity   | Compare tool-calculated total vs manual sum | `total_value = cash + sum(holding.dollars)` with no rounding drift                  |
| Trade execution            | Agent decides to buy something              | `portfolio.json` updated by tool, not by agent writing raw JSON                     |
| Diary written              | Read `diary.md` after run                   | Today's entry exists with sections: Market Overview, Research, Decisions, Portfolio |
| Diary trimming             | Run 8+ times                                | `diary.md` contains only last 7 entries, oldest removed                             |
| Memory updated             | Read `memory.md` after run                  | Contains thesis, position rationales, any new lessons                               |
| Snapshot saved             | Check `history/` directory                  | `portfolio_YYYY_MM_DD.json` exists for today with trades array                      |
| No duplicate snapshot      | Run `trade` twice same day                  | Second run overwrites or skips, doesn't create duplicate                            |
| Insufficient cash handling | Agent tries to buy more than cash allows    | Tool returns error, agent adjusts or skips, portfolio not corrupted                 |
| Invalid ticker handling    | Agent tries to buy nonsense ticker          | Tool returns error, agent continues with other trades                               |
| Weekend/holiday            | Trigger on Saturday                         | Agent detects market closed, either skips trades or does research-only              |
| Idempotency                | Run `trade` twice in one day                | Second run updates prices but doesn't double-trade or corrupt state                 |
| End-to-end value check     | Record total_value before and after         | Change is explained by price movements + trades, no phantom gains/losses            |

---

### Phase 3 — Multi-Agent

**Tasks:**

- [ ] Send `trade` to Gemini box, verify same flow
- [ ] Send `trade` to OpenAI box, verify same flow
- [ ] Ensure all three produce valid, consistent portfolio.json files
- [ ] Run one full day with all three agents in parallel

**Tests:**

| Test                        | How                                             | Expected Outcome                                                               |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Gemini skill discovery      | Send `trade` to Gemini box                      | Agent reads SKILL.md, follows the same process as Claude                       |
| OpenAI skill discovery      | Send `trade` to Codex box                       | Agent reads SKILL.md, follows the same process as Claude                       |
| Schema conformance — Claude | Validate portfolio.json against TypeScript type | All required fields present, correct types                                     |
| Schema conformance — Gemini | Same validation                                 | Same result                                                                    |
| Schema conformance — OpenAI | Same validation                                 | Same result                                                                    |
| Tool usage — Gemini         | Check Gemini used tools not raw JSON edits      | portfolio.json was modified by `execute_trade`, not direct file write          |
| Tool usage — OpenAI         | Same check                                      | Same result                                                                    |
| Parallel execution          | Run all 3 with `Promise.allSettled`             | All 3 complete without interfering with each other                             |
| No cross-contamination      | Check each box's files                          | Claude's box only has `agents/claude/`, Gemini only has `agents/gemini/`, etc. |
| Price consistency           | Compare prices used by all 3 on same day        | Prices should be nearly identical (same source, same day)                      |
| All snapshots saved         | Check each box's `history/`                     | Each has `portfolio_YYYY_MM_DD.json` for today                                 |
| Diary independence          | Read all 3 diaries                              | Each has unique research and decisions, not copy-pasted                        |
| Error isolation             | Kill one box mid-run                            | Other two complete normally                                                    |
| Starting balance            | All 3 start day 1 at $100K                      | Confirmed in each portfolio.json                                               |

---

### Phase 4 — Dashboard

**Tasks:**

- [ ] Scaffold SvelteKit app with Tailwind
- [ ] Build `fetch-portfolios.ts` using @upstash/box SDK
- [ ] Build home page with 3 agent cards
- [ ] Build agent detail page with charts and trade history
- [ ] Deploy to Vercel

**Tests:**

| Test                | How                                    | Expected Outcome                                                  |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Fetch portfolios    | Call `fetch-portfolios.ts`             | Returns 3 valid portfolio objects from 3 boxes                    |
| Fetch history       | Call `fetch-history.ts` for Claude     | Returns array of daily snapshots sorted by date                   |
| Ranking order       | Home page with known values            | Cards sorted by total_value descending, rank badges correct       |
| Agent card — values | Compare card display to portfolio.json | Portfolio value, return %, holdings match the data                |
| Sparkline chart     | Agent with 30+ days of history         | Chart renders with correct shape (values match snapshots)         |
| Performance stats   | Check today/week/month numbers         | Calculated correctly from history snapshots                       |
| Holdings table      | Agent detail page                      | All holdings shown with ticker, name, allocation %, dollar amount |
| Trade history       | Agent detail page                      | Trades from history/\*.json shown in reverse chronological order  |
| Diary display       | Agent detail page                      | Recent diary entries rendered as markdown                         |
| Market bar          | Home page                              | S&P 500, NASDAQ, DOW, VIX values shown with daily change          |
| Empty state         | Agent with 0 trades (all cash)         | Dashboard renders gracefully, shows $100K cash, no chart errors   |
| Mobile responsive   | View on 375px width                    | Cards stack vertically, text readable, no overflow                |
| Vercel deploy       | Push to Vercel                         | Build succeeds, pages load, data displays                         |
| Server-side caching | Request page twice within 1 hour       | Second request served from cache, doesn't hit boxes               |
| Stale data handling | Box unreachable                        | Dashboard shows last cached data, doesn't crash                   |

---

### Phase 5 — Automation & Polish

**Tasks:**

- [ ] Set up daily trigger (GitHub Action or Upstash Workflow)
- [ ] Add error handling and retries in trigger script
- [ ] Add performance comparison charts to dashboard
- [ ] Write README for public repo

**Tests:**

| Test                     | How                                    | Expected Outcome                                                                   |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Scheduled trigger fires  | Wait for cron/schedule time            | All 3 agents run, new snapshots appear in boxes                                    |
| Trigger retry on failure | Simulate one box timeout               | Trigger retries that box up to 3 times, other boxes unaffected                     |
| Trigger logging          | Check run logs                         | Timestamp, agent name, success/failure, duration logged for each agent             |
| Weekend skip             | Trigger fires on Saturday              | Agents either skip entirely or run research-only (no trades), configurable         |
| Comparison chart         | Home page                              | Overlay line chart showing all 3 agents' total_value over time                     |
| Comparison data          | Chart with 30+ days                    | All 3 lines start at $100K on day 1, diverge based on performance                  |
| Alert on failure         | One agent fails 3 times in a row       | Notification sent (email, Slack, or logged)                                        |
| README accuracy          | Read README                            | Setup instructions work from scratch on a clean machine                            |
| Full 7-day dry run       | Run trigger 7 consecutive days         | All 3 agents have 7 snapshots, diaries trimmed correctly, dashboard shows all data |
| Cost check               | Review Upstash billing after 7-day run | CPU costs are within expected range (minimal — ~minutes of active time per day)    |

---

## Open Questions

1. **Search API**: Which web search API to use? Brave Search is cheapest. Tavily has good structured output. SerpAPI is most mature.
2. **Agent models**: Lock specific model versions, or always use latest? Locking is more scientific. Latest is more exciting.
3. **Weekends/holidays**: Skip days when market is closed? Or let agents research and prepare but not trade?
4. **Benchmark**: Add a 4th "agent" that just holds SPY (buy-and-hold) as a baseline comparison?
5. **Public diary**: Show agent reasoning on the dashboard? It's entertaining but makes the page much longer.
6. **Gemini in Box**: Claude Code and Codex are built into Upstash Box. Need to verify Gemini CLI / agent support, or use AI SDK with Gemini model as the runtime instead.
7. **Dashboard caching**: How often should the dashboard fetch from boxes? Server-side caching with 1-hour max-age seems right since data only changes once daily.
