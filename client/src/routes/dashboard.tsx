import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAccessToken, getSecret, refresh } from "../lib/api";
import { useAuth } from "../lib/auth";
import "../auth.css";

export const Route = createFileRoute("/dashboard")({
	component: Dashboard,
});

/** Renders the payload of a JWT so the demo can show what's inside it. */
function decodeJwt(token: string): Record<string, unknown> | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
	} catch {
		return null;
	}
}

function Dashboard() {
	const { user, loading, logout } = useAuth();
	const navigate = useNavigate();

	const [secret, setSecret] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState(getAccessToken());

	useEffect(() => {
		if (!loading && !user) navigate({ to: "/login" });
	}, [user, loading, navigate]);

	if (loading) return <div className="auth-shell">Loading…</div>;
	if (!user) return null;

	const claims = token ? decodeJwt(token) : null;
	const expiresAt =
		typeof claims?.exp === "number"
			? new Date(claims.exp * 1000).toLocaleTimeString()
			: "—";

	async function callProtected() {
		setError(null);
		try {
			const res = await getSecret();
			setSecret(`${res.message} (${res.servedAt})`);
		} catch (err) {
			setSecret(null);
			setError(err instanceof Error ? err.message : "Request failed");
		}
	}

	async function forceRefresh() {
		setError(null);
		const auth = await refresh();
		if (auth) {
			setToken(getAccessToken());
		} else {
			setError("Refresh token rejected — please sign in again.");
		}
	}

	return (
		<div className="auth-shell">
			<div className="auth-card wide">
				<header className="dash-head">
					<div>
						<h1>{user.name}</h1>
						<p className="auth-sub">{user.email}</p>
					</div>
					<button
						type="button"
						className="ghost"
						onClick={async () => {
							await logout();
							navigate({ to: "/login" });
						}}
					>
						Sign out
					</button>
				</header>

				<section>
					<h2>Access token</h2>
					<p className="auth-sub">
						Held in memory only · expires at {expiresAt}
					</p>
					<pre className="token">{token ?? "none"}</pre>
					{claims && (
						<pre className="token">{JSON.stringify(claims, null, 2)}</pre>
					)}
				</section>

				<section>
					<h2>Refresh token</h2>
					<p className="auth-sub">
						Stored as an httpOnly cookie — not readable from JavaScript, and
						rotated on every refresh.
					</p>
					<div className="row">
						<button type="button" onClick={forceRefresh}>
							Refresh now
						</button>
						<button type="button" onClick={callProtected}>
							Call protected endpoint
						</button>
					</div>
				</section>

				{secret && <p className="auth-ok">{secret}</p>}
				{error && <p className="auth-error">{error}</p>}
			</div>
		</div>
	);
}

export default Dashboard;
