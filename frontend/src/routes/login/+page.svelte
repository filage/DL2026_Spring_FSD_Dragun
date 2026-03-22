<script lang="ts">
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { DEFAULT_API_BASE_URL } from '$lib/config';
	import { login } from '$lib/auth';

	let username = '';
	let password = '';
	let loading = false;
	let error: string | null = null;

	const apiBase = env.PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

	async function submit() {
		loading = true;
		error = null;
		try {
			await login(apiBase, username, password);
			await goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}
</script>

<div class="page">
	<div class="card">
		<h1>Вход</h1>

		{#if error}
			<div class="error">{error}</div>
		{/if}

		<form on:submit|preventDefault={submit}>
			<label>
				Ник
				<input type="text" bind:value={username} autocomplete="username" required />
			</label>
			<label>
				Пароль
				<input type="password" bind:value={password} autocomplete="current-password" required />
			</label>
			<button disabled={loading}>{loading ? 'Входим…' : 'Войти'}</button>
		</form>

		<div class="footer">
			<a href="/register">Нет аккаунта? Регистрация</a>
			<a href="/">На карту</a>
		</div>
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: grid;
		place-items: center;
		background: #0b1020;
		color: #e5e7eb;
		padding: 16px;
	}
	.card {
		width: 100%;
		max-width: 420px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		padding: 16px;
		display: grid;
		gap: 10px;
	}
	h1 {
		margin: 0;
		font-size: 18px;
	}
	form {
		display: grid;
		gap: 10px;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 12px;
		opacity: 0.9;
	}
	input {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #e5e7eb;
		padding: 10px 12px;
		border-radius: 12px;
	}
	button {
		background: rgba(79, 70, 229, 0.35);
		border: 1px solid rgba(79, 70, 229, 0.8);
		color: #e5e7eb;
		padding: 10px 12px;
		border-radius: 12px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		padding: 10px 12px;
		background: rgba(239, 68, 68, 0.18);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 12px;
	}
	.footer {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 13px;
	}
	a {
		color: #93c5fd;
		text-decoration: none;
	}
</style>
