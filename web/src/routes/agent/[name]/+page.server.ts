import { fetchPortfolios, fetchHistory, fetchDiary, refreshPortfolioPrices } from '$lib/server/boxes.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
	const name = params.name;

	const [portfolios, history, diary] = await Promise.all([
		fetchPortfolios(),
		fetchHistory(name),
		fetchDiary(name)
	]);

	const rawPortfolio = portfolios.find((p) => p.agent === name);
	if (!rawPortfolio) throw error(404, `Agent "${name}" not found`);
	const portfolio = await refreshPortfolioPrices(rawPortfolio);

	// Collect all trades from history
	const allTrades = history
		.flatMap((s) =>
			s.trades.map((t) => ({
				...t,
				date: s.date,
				day_number: s.day_number
			}))
		)
		.reverse();

	return { portfolio, history, diary, trades: allTrades };
};
