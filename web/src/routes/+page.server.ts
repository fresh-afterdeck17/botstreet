import { fetchPortfolios, fetchMarketData, refreshPortfolioPrices } from '$lib/server/boxes.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
	const [rawPortfolios, market] = await Promise.all([fetchPortfolios(), fetchMarketData()]);

	const portfolios = await Promise.all(rawPortfolios.map(refreshPortfolioPrices));
	const sorted = [...portfolios].sort((a, b) => b.total_value - a.total_value);

	return { portfolios: sorted, market };
};
