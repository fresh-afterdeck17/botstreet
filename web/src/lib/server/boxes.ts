import { Box } from '@upstash/box';
import { env } from '$env/dynamic/private';
import type { Portfolio, HistorySnapshot, MarketQuote } from '$lib/types.js';

const AGENTS = [
	{ name: 'claude', idKey: 'BOX_CLAUDE_ID' },
	{ name: 'gemini', idKey: 'BOX_GEMINI_ID' },
	{ name: 'openai', idKey: 'BOX_OPENAI_ID' }
] as const;

async function readJson<T>(box: Box, path: string): Promise<T | null> {
	try {
		const raw = await box.files.read(path);
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export async function fetchPortfolios(): Promise<Portfolio[]> {
	const portfolios = await Promise.all(
		AGENTS.map(async (agent) => {
			const boxId = env[agent.idKey];
			if (!boxId) return null;
			try {
				const box = await Box.get(boxId, { apiKey: env.UPSTASH_BOX_API_KEY });
				return await readJson<Portfolio>(box, `/workspace/home/agents/${agent.name}/portfolio.json`);
			} catch (e) {
				console.error(`[fetchPortfolios] ${agent.name} failed:`, e);
				return null;
			}
		})
	);
	return portfolios.filter((p): p is Portfolio => p !== null);
}

export async function fetchHistory(agentName: string): Promise<HistorySnapshot[]> {
	const idKey = AGENTS.find((a) => a.name === agentName)?.idKey;
	if (!idKey || !env[idKey]) return [];

	try {
		const box = await Box.get(env[idKey]!, { apiKey: env.UPSTASH_BOX_API_KEY });
		const files = await box.files.list(`/workspace/home/agents/${agentName}/history`);
		const jsonFiles = files
			.filter((f: any) => f.name?.endsWith('.json') || f.path?.endsWith('.json'))
			.sort((a: any, b: any) => (a.path ?? a.name).localeCompare(b.path ?? b.name));

		const snapshots = await Promise.all(
			jsonFiles.map((f: any) => readJson<HistorySnapshot>(box, f.path))
		);
		return snapshots.filter((s): s is HistorySnapshot => s !== null);
	} catch {
		return [];
	}
}

export async function fetchDiary(agentName: string): Promise<string> {
	const idKey = AGENTS.find((a) => a.name === agentName)?.idKey;
	if (!idKey || !env[idKey]) return '';

	try {
		const box = await Box.get(env[idKey]!, { apiKey: env.UPSTASH_BOX_API_KEY });
		return await box.files.read(`/workspace/home/agents/${agentName}/diary.md`);
	} catch {
		return '';
	}
}

export async function fetchMarketData(): Promise<MarketQuote[]> {
	const tickers = [
		{ ticker: '^GSPC', name: 'S&P 500' },
		{ ticker: '^IXIC', name: 'NASDAQ' },
		{ ticker: '^DJI', name: 'DOW' },
		{ ticker: '^VIX', name: 'VIX' }
	];

	const quotes = await Promise.all(
		tickers.map(async ({ ticker, name }) => {
			try {
				const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
				const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
				const data = (await res.json()) as any;
				const meta = data?.chart?.result?.[0]?.meta;
				if (!meta) return { ticker, name, price: 0, change_pct: 0 };
				const prev = meta.chartPreviousClose ?? meta.regularMarketPrice;
				const change_pct = prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : 0;
				return { ticker, name, price: meta.regularMarketPrice, change_pct: Math.round(change_pct * 100) / 100 };
			} catch {
				return { ticker, name, price: 0, change_pct: 0 };
			}
		})
	);
	return quotes;
}
