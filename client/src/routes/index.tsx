import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "../lib/auth";
import "../auth.css";

export const Route = createFileRoute("/")({
	component: Index,
});

function Index() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (loading) return;
		navigate({ to: user ? "/dashboard" : "/login" });
	}, [user, loading, navigate]);

	return <div className="auth-shell">Loading…</div>;
}

export default Index;
