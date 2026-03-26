import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Box } from '@upstash/box';
import type { RequestHandler } from './$types.js';

const PROMPT = 'Read SKILL.md and follow its instructions. The command is: trade';

const AGENTS = [
	{ name: 'claude', idKey: 'BOX_CLAUDE_ID', custom: false },
	{ name: 'gemini', idKey: 'BOX_GEMINI_ID', custom: true },
	{ name: 'openai', idKey: 'BOX_OPENAI_ID', custom: false }
];

async function runAgent(agent: (typeof AGENTS)[number]) {
	const boxId = env[agent.idKey];
	if (!boxId) throw new Error(`${agent.idKey} not set`);

	const box = await Box.get(boxId, { apiKey: env.UPSTASH_BOX_API_KEY });

	// Check if already traded today
	try {
		const raw = await box.files.read(`/workspace/home/agents/${agent.name}/portfolio.json`);
		const portfolio = JSON.parse(raw);
		const today = new Date().toISOString().split('T')[0];
		if (portfolio.last_trade_date === today) {
			return { name: agent.name, status: 'skipped', reason: 'already traded today' };
		}
	} catch {
		// Portfolio doesn't exist or can't be read — proceed anyway
	}

	if (agent.custom) {
		const run = await box.exec.command(
			'cd /workspace/home && export $(cat .env | xargs) && npx tsx agent-gemini.ts 2>&1'
		);
		return { name: agent.name, status: run.status };
	} else {
		const run = await box.agent.run({ prompt: PROMPT, timeout: 600000 });
		return { name: agent.name, status: run.status, cost: run.cost?.totalUsd };
	}
}

export const GET: RequestHandler = async ({ request }) => {
	// Verify cron secret to prevent unauthorized triggers
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const timestamp = new Date().toISOString();
	const results = await Promise.allSettled(AGENTS.map(runAgent));

	const summary = results.map((result, i) => {
		if (result.status === 'fulfilled') {
			return { agent: result.value.name, ...result.value };
		}
		return { agent: AGENTS[i].name, status: 'failed', error: String(result.reason) };
	});

	return json({ timestamp, results: summary });
};
