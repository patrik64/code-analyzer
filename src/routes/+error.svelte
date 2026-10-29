<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="card error">
	<h1>{page.status} · {page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p class="text-2">{page.error?.message ?? 'Unknown error'}</p>
	<p><a class="btn" href="/">← Back to the start page</a></p>
</div>

<style>
	.error {
		max-width: 640px;
		margin: 40px auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
