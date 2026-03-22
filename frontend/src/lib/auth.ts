import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type Role = 'USER' | 'ADMIN';

export type AuthUser = {
	id: string;
	username: string;
	role: Role;
};

type AuthState = {
	token: string | null;
	user: AuthUser | null;
};

const STORAGE_KEY = 'geoguide.jwt';

function readToken(): string | null {
	if (!browser) return null;
	return localStorage.getItem(STORAGE_KEY);
}

function writeToken(token: string | null) {
	if (!browser) return;
	if (token) localStorage.setItem(STORAGE_KEY, token);
	else localStorage.removeItem(STORAGE_KEY);
}

export const auth = writable<AuthState>({
	token: readToken(),
	user: null
});

export function getAuthTokenSnapshot() {
	let t: string | null = null;
	auth.subscribe((s) => (t = s.token))();
	return t;
}

export async function authInit(apiBase: string) {
	const token = readToken();
	if (!token) {
		auth.set({ token: null, user: null });
		return;
	}

	try {
		const r = await fetch(`${apiBase}/auth/me`, {
			headers: {
				authorization: `Bearer ${token}`
			}
		});
		const json = await r.json();
		if (!r.ok || !json.ok) throw new Error('unauthorized');

		auth.set({ token, user: json.user as AuthUser });
	} catch {
		writeToken(null);
		auth.set({ token: null, user: null });
	}
}

export async function register(apiBase: string, username: string, password: string) {
	const r = await fetch(`${apiBase}/auth/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	const json = await r.json();
	if (!r.ok || !json.ok) {
		const e = String(json.error ?? 'Register failed');
		if (e === 'Username already in use') throw new Error('Нельзя: этот логин уже занят.');
		throw new Error(e);
	}

	writeToken(json.token as string);
	auth.set({ token: json.token as string, user: json.user as AuthUser });
}

export async function login(apiBase: string, username: string, password: string) {
	const r = await fetch(`${apiBase}/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	const json = await r.json();
	if (!r.ok || !json.ok) {
		const e = String(json.error ?? 'Login failed');
		if (e === 'Wrong password') throw new Error('Пароль введен неверно.');
		if (e === 'Unknown username') throw new Error('Пользователь не наиден.');
		throw new Error(e);
	}

	writeToken(json.token as string);
	auth.set({ token: json.token as string, user: json.user as AuthUser });
}

export function logout() {
	writeToken(null);
	auth.set({ token: null, user: null });
}

export async function apiFetch(
	apiBase: string,
	path: string,
	init: RequestInit = {}
): Promise<Response> {
	const token = getAuthTokenSnapshot();
	const headers = new Headers(init.headers ?? {});
	if (!headers.has('content-type') && init.body) {
		headers.set('content-type', 'application/json');
	}
	if (token) headers.set('authorization', `Bearer ${token}`);

	return await fetch(`${apiBase}${path}`, {
		...init,
		headers
	});
}
