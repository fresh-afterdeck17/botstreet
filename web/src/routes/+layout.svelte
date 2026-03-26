<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="relative z-1 mx-auto max-w-[1400px] px-8 py-10">
	{@render children()}
</div>
