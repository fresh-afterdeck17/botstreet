import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Box } from '@upstash/box';
import type { RequestHandler } from './$types.js';

export const config = {
	maxDuration: 300
};

const PROMPT = 'trade';

const AGENTS = [
	{ name: 'claude', boxName: 'botstreet-claude', custom: false },
	{ name: 'gemini', boxName: 'botstreet-gemini', custom: true },
	{ name: 'openai', boxName: 'botstreet-openai', custom: false }
];

async function runAgent(agent: (typeof AGENTS)[number]) {
	const box = await Box.getByName(agent.boxName, { apiKey: env.UPSTASH_BOX_API_KEY });

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

export const POST: RequestHandler = async () => {
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
