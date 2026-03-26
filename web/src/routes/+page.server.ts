import { fetchPortfolios, fetchMarketData } from '$lib/server/boxes.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
	const [portfolios, market] = await Promise.all([fetchPortfolios(), fetchMarketData()]);
	console.log(`[load] portfolios: ${portfolios.length}, market: ${market.length}`);

	const sorted = [...portfolios].sort((a, b) => b.total_value - a.total_value);

	return { portfolios: sorted, market };
};
