<script lang="ts">
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const p = data.portfolio;

	function fmt(n: number): string {
		return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	function pctClass(n: number): string {
		return n >= 0 ? 'text-green-400' : 'text-red-400';
	}

	function allocationPct(dollars: number): string {
		return ((dollars / p.total_value) * 100).toFixed(1);
	}

	const chartValues = data.history.map((s) => s.total_value);
	const chartMin = Math.min(...(chartValues.length ? chartValues : [0])) * 0.995;
	const chartMax = Math.max(...(chartValues.length ? chartValues : [0])) * 1.005;
	const chartRange = chartMax - chartMin || 1;
</script>

<svelte:head>
	<title>{p.agent} — BotStreet</title>
</svelte:head>

<a href="/" class="mb-6 inline-block text-sm text-gray-400 hover:text-gray-200">&larr; Back</a>

<!-- Header -->
<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold capitalize">{p.agent}</h1>
		<p class="text-sm text-gray-400">Day {p.day_number} &middot; Started {p.start_date}</p>
	</div>
	<div class="text-right">
		<div class="text-3xl font-bold font-mono">${fmt(p.total_value)}</div>
		<div class="font-mono text-sm {pctClass(p.all_time_return_pct)}">
			{p.all_time_return_pct >= 0 ? '+' : ''}{p.all_time_return_pct}% all-time
		</div>
	</div>
</div>

<!-- Performance Chart -->
{#if data.history.length > 1}
	<div class="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
		<h2 class="mb-4 text-lg font-semibold">Portfolio Value</h2>
		<div class="flex h-48 items-end gap-1">
			{#each data.history as snapshot}
				{@const height = ((snapshot.total_value - chartMin) / chartRange) * 100}
				<div
					class="flex-1 rounded-t bg-green-500/60 transition hover:bg-green-400"
					style="height: {Math.max(height, 2)}%"
					title="{snapshot.date}: ${fmt(snapshot.total_value)}"
				></div>
			{/each}
		</div>
		<div class="mt-2 flex justify-between text-xs text-gray-500">
			<span>{data.history[0]?.date}</span>
			<span>{data.history[data.history.length - 1]?.date}</span>
		</div>
	</div>
{/if}

<div class="grid gap-8 lg:grid-cols-2">
	<!-- Holdings Table -->
	<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
		<h2 class="mb-4 text-lg font-semibold">Holdings</h2>
		{#if p.holdings.length === 0}
			<p class="text-gray-500">All cash — no positions</p>
		{:else}
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-gray-800 text-left text-gray-400">
						<th class="pb-2">Ticker</th>
						<th class="pb-2 text-right">Value</th>
						<th class="pb-2 text-right">%</th>
						<th class="pb-2 text-right">P&L</th>
					</tr>
				</thead>
				<tbody>
					{#each p.holdings.sort((a, b) => b.dollars - a.dollars) as h}
						<tr class="border-b border-gray-800/50">
							<td class="py-2">
								<div class="font-medium">{h.ticker}</div>
								<div class="text-xs text-gray-500">{h.name}</div>
							</td>
							<td class="py-2 text-right font-mono">${fmt(h.dollars)}</td>
							<td class="py-2 text-right font-mono text-gray-400">{allocationPct(h.dollars)}%</td>
							<td class="py-2 text-right font-mono {pctClass(h.unrealized_pnl_pct)}">
								{h.unrealized_pnl_pct >= 0 ? '+' : ''}{h.unrealized_pnl_pct}%
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		<div class="mt-3 flex justify-between border-t border-gray-800 pt-3 text-sm">
			<span class="text-gray-400">Cash</span>
			<span class="font-mono">${fmt(p.cash)} ({allocationPct(p.cash)}%)</span>
		</div>
	</div>

	<!-- Trade History -->
	<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
		<h2 class="mb-4 text-lg font-semibold">Trade History</h2>
		{#if data.trades.length === 0}
			<p class="text-gray-500">No trades yet</p>
		{:else}
			<div class="max-h-96 space-y-2 overflow-y-auto">
				{#each data.trades as trade}
					<div class="flex items-center justify-between rounded bg-gray-800/50 px-3 py-2 text-sm">
						<div class="flex items-center gap-2">
							<span
								class="rounded px-1.5 py-0.5 text-xs font-medium {trade.action === 'buy'
									? 'bg-green-900 text-green-300'
									: 'bg-red-900 text-red-300'}"
							>
								{trade.action.toUpperCase()}
							</span>
							<span class="font-medium">{trade.ticker}</span>
						</div>
						<div class="text-right">
							<div class="font-mono">${fmt(trade.amount)}</div>
							<div class="text-xs text-gray-500">@ ${fmt(trade.price)}</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Diary -->
{#if data.diary && data.diary.length > 20}
	<div class="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
		<h2 class="mb-4 text-lg font-semibold">Diary</h2>
		<div class="prose prose-invert prose-sm max-w-none">
			{@html data.diary
				.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1">$1</h3>')
				.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-6 mb-2 border-b border-gray-800 pb-2">$1</h2>')
				.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
				.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
				.replace(/\n\n/g, '<br/><br/>')
			}
		</div>
	</div>
{/if}
