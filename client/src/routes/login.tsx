import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import "../auth.css";

export const Route = createFileRoute("/login")({
	component: Login,
});

function Login() {
	const { user, loading, login } = useAuth();
	const navigate = useNavigate();

	const [email, setEmail] = useState("alice@example.com");
	const [password, setPassword] = useState("password123");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		if (!loading && user) navigate({ to: "/dashboard" });
	}, [user, loading, navigate]);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		try {
			await login(email, password);
			navigate({ to: "/dashboard" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="auth-shell">
			<form className="auth-card" onSubmit={onSubmit}>
				<h1>Sign in</h1>
				<p className="auth-sub">Access & refresh token demo</p>

				<label htmlFor="email">Email</label>
				<input
					id="email"
					type="email"
					value={email}
					autoComplete="username"
					onChange={(e) => setEmail(e.target.value)}
					required
				/>

				<label htmlFor="password">Password</label>
				<input
					id="password"
					type="password"
					value={password}
					autoComplete="current-password"
					onChange={(e) => setPassword(e.target.value)}
					required
				/>

				{error && <p className="auth-error">{error}</p>}

				<button type="submit" disabled={submitting}>
					{submitting ? "Signing in…" : "Sign in"}
				</button>

				<div className="auth-hint">
					<strong>Seeded users</strong>
					<code>alice@example.com / password123</code>
					<code>bob@example.com / password456</code>
				</div>
			</form>
		</div>
	);
}

export default Login;
