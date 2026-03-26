import { env } from '$env/dynamic/private';
import { Box } from '@upstash/box';
import type { RequestHandler } from './$types.js';

export const config = {
	maxDuration: 600
};

const PROMPT = 'trade';

const AGENTS = [
	{ name: 'claude', boxName: 'botstreet-claude', custom: false },
	{ name: 'gemini', boxName: 'botstreet-gemini', custom: true },
	{ name: 'openai', boxName: 'botstreet-openai', custom: false }
];

export const GET: RequestHandler = async () => {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			function send(agent: string, type: string, data: unknown) {
				const line = JSON.stringify({ agent, type, data });
				controller.enqueue(encoder.encode(`data: ${line}\n\n`));
			}

			async function runAgent(agent: (typeof AGENTS)[number]) {
				const box = await Box.getByName(agent.boxName, { apiKey: env.UPSTASH_BOX_API_KEY });

				// Check if already traded today
				try {
					const raw = await box.files.read(
						`/workspace/home/agents/${agent.name}/portfolio.json`
					);
					const portfolio = JSON.parse(raw);
					const today = new Date().toISOString().split('T')[0];
					if (portfolio.last_trade_date === today) {
						send(agent.name, 'skipped', { reason: 'already traded today' });
						return;
					}
				} catch {
					// proceed
				}

				send(agent.name, 'started', {});

				if (agent.custom) {
					// Gemini: exec stream
					const run = await box.exec.stream(
						'cd /workspace/home && export $(cat .env | xargs) && npx tsx agent-gemini.ts 2>&1'
					);
					for await (const chunk of run) {
						if (chunk.type === 'output') {
							send(agent.name, 'text', { text: chunk.data });
						}
					}
					send(agent.name, 'done', { status: run.status });
				} else {
					// Claude/Codex: agent stream
					const run = await box.agent.stream({ prompt: PROMPT, timeout: 600000 });
					for await (const chunk of run) {
						if (chunk.type === 'text-delta') {
							send(agent.name, 'text', { text: chunk.text });
						} else if (chunk.type === 'tool-call') {
							send(agent.name, 'tool', {
								name: chunk.toolName,
								input: chunk.input
							});
						}
					}
					send(agent.name, 'done', {
						status: run.status,
						cost: run.cost?.totalUsd
					});
				}
			}

			try {
				await Promise.all(AGENTS.map((a) => runAgent(a).catch((e) => {
					send(a.name, 'error', { message: String(e) });
				})));
			} finally {
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
