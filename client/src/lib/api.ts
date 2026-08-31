import type { AuthResponse, User } from "shared";

/**
 * An empty value means "same origin" — that's how the Docker image is built,
 * where Hono serves this bundle and the API together on one port. Unset (dev)
 * falls back to the standalone server Vite proxies to.
 */
export const SERVER_URL =
	import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";

/**
 * The access token lives in memory only. Keeping it out of localStorage means
 * an XSS bug can't read it back later, and the httpOnly refresh cookie is what
 * survives a page reload.
 */
let accessToken: string | null = null;

export function getAccessToken() {
	return accessToken;
}

export function setAccessToken(token: string | null) {
	accessToken = token;
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function parseError(res: Response, fallback: string) {
	const body = await res.json().catch(() => null);
	return new ApiError(body?.error ?? fallback, res.status);
}

/** Refresh in flight, shared so parallel 401s trigger only one rotation. */
let refreshing: Promise<AuthResponse | null> | null = null;

export function refresh(): Promise<AuthResponse | null> {
	if (!refreshing) {
		refreshing = fetch(`${SERVER_URL}/auth/refresh`, {
			method: "POST",
			credentials: "include",
		})
			.then(async (res) => {
				if (!res.ok) {
					setAccessToken(null);
					return null;
				}
				const auth: AuthResponse = await res.json();
				setAccessToken(auth.accessToken);
				return auth;
			})
			.catch(() => null)
			.finally(() => {
				refreshing = null;
			});
	}
	return refreshing;
}

/**
 * Authenticated fetch. On a 401 it transparently rotates the refresh token
 * once and replays the request, so an expired access token is invisible.
 */
export async function apiFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const send = () =>
		fetch(`${SERVER_URL}${path}`, {
			...init,
			credentials: "include",
			headers: {
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers,
				...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
			},
		});

	let res = await send();

	if (res.status === 401 && (await refresh())) {
		res = await send();
	}

	if (!res.ok) throw await parseError(res, "Request failed");
	return res.json() as Promise<T>;
}

export async function login(
	email: string,
	password: string,
): Promise<AuthResponse> {
	const res = await fetch(`${SERVER_URL}/auth/login`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!res.ok) throw await parseError(res, "Login failed");

	const auth: AuthResponse = await res.json();
	setAccessToken(auth.accessToken);
	return auth;
}

export async function logout(): Promise<void> {
	await fetch(`${SERVER_URL}/auth/logout`, {
		method: "POST",
		credentials: "include",
	}).catch(() => {});
	setAccessToken(null);
}

export function getMe() {
	return apiFetch<{ user: User }>("/auth/me");
}

export function getSecret() {
	return apiFetch<{ message: string; servedAt: string }>("/protected/secret");
}
