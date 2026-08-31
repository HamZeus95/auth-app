import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { User } from "shared";
import * as api from "./api";

type AuthContextValue = {
	user: User | null;
	/** True until the initial refresh settles, so routes don't flash the login page. */
	loading: boolean;
	login: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);

	// On boot the access token is gone (memory only), but the refresh cookie
	// may still be valid — trade it for a fresh session.
	useEffect(() => {
		let cancelled = false;

		api.refresh().then((auth) => {
			if (cancelled) return;
			setUser(auth?.user ?? null);
			setLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	// Renew shortly before the access token expires so a logged-in tab
	// never has to recover from a 401.
	useEffect(() => {
		if (!user) return;

		const timer = setInterval(
			() => {
				api.refresh().then((auth) => {
					if (!auth) setUser(null);
				});
			},
			10 * 60 * 1000,
		);

		return () => clearInterval(timer);
	}, [user]);

	const doLogin = useCallback(async (email: string, password: string) => {
		const auth = await api.login(email, password);
		setUser(auth.user);
	}, []);

	const doLogout = useCallback(async () => {
		await api.logout();
		setUser(null);
	}, []);

	const value = useMemo(
		() => ({ user, loading, login: doLogin, logout: doLogout }),
		[user, loading, doLogin, doLogout],
	);

	return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
	const ctx = use(AuthContext);
	if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
	return ctx;
}
