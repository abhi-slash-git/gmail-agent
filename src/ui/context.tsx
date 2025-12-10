import type { PGlite } from "@electric-sql/pglite";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState
} from "react";
import { ensureValidToken } from "../cli/commands/auth.js";
import type { Database } from "../database/connection";
import {
	closeDatabase,
	getGmailTokens,
	getPGlite,
	getSyncQueueStats,
	type SyncQueueStats
} from "../database/connection";
import { getEnv } from "../env";
import type { BackgroundSyncProgress } from "../gmail/background-sync";

export type Screen =
	| "home"
	| "auth"
	| "classifiers"
	| "classifier-add"
	| "sync"
	| "classify"
	| "emails";

export interface BackgroundSyncState {
	isRunning: boolean;
	progress: BackgroundSyncProgress | null;
	stats: SyncQueueStats | null;
}

export interface BackgroundClassifyState {
	isRunning: boolean;
	total: number;
	completed: number;
	classified: number;
	activeTasks: number; // Track number of concurrent classification tasks
}

interface AppContextValue {
	db: Database;
	sql: PGlite | null;
	isAuthenticated: boolean;
	error: string | null;
	screen: Screen;
	setScreen: (screen: Screen) => void;
	refreshAuth: () => Promise<void>;
	exit: () => void;
	backgroundSync: BackgroundSyncState;
	setBackgroundSync: (state: BackgroundSyncState) => void;
	refreshSyncStats: () => Promise<void>;
	backgroundClassify: BackgroundClassifyState;
	setBackgroundClassify: (
		state:
			| BackgroundClassifyState
			| ((prev: BackgroundClassifyState) => BackgroundClassifyState)
	) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
	const ctx = useContext(AppContext);
	if (!ctx) throw new Error("useApp must be used within AppProvider");
	return ctx;
}

interface AppProviderProps {
	children: React.ReactNode;
	db: Database;
	onExit: () => void;
}

export function AppProvider({ children, db, onExit }: AppProviderProps) {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [screen, setScreen] = useState<Screen>("home");
	const [backgroundSync, setBackgroundSync] = useState<BackgroundSyncState>({
		isRunning: false,
		progress: null,
		stats: null
	});
	const [backgroundClassify, setBackgroundClassify] =
		useState<BackgroundClassifyState>({
			activeTasks: 0,
			classified: 0,
			completed: 0,
			isRunning: false,
			total: 0
		});

	const refreshAuth = useCallback(async () => {
		const env = getEnv();
		const tokens = await getGmailTokens(db, env.USER_ID);
		setIsAuthenticated(!!tokens);
	}, [db]);

	const refreshSyncStats = useCallback(async () => {
		const env = getEnv();
		const stats = await getSyncQueueStats(db, env.USER_ID);
		setBackgroundSync((prev) => ({ ...prev, stats }));
	}, [db]);

	// Initialize auth state and sync stats on mount
	useEffect(() => {
		const init = async () => {
			try {
				const env = getEnv();
				const tokens = await getGmailTokens(db, env.USER_ID);
				setIsAuthenticated(!!tokens);

				const stats = await getSyncQueueStats(db, env.USER_ID);
				setBackgroundSync((prev) => ({ ...prev, stats }));
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		};
		void init();
	}, [db]);

	// Auto-refresh token every 45 minutes when authenticated
	const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (!isAuthenticated) {
			if (tokenRefreshIntervalRef.current) {
				clearInterval(tokenRefreshIntervalRef.current);
				tokenRefreshIntervalRef.current = null;
			}
			return;
		}

		// Refresh token silently in background
		const refreshToken = async () => {
			try {
				await ensureValidToken({ silent: true });
			} catch {
				// Token refresh failed - user may need to re-authenticate
				// Don't update isAuthenticated here to avoid disrupting the UI
			}
		};

		// Refresh immediately on mount if authenticated
		void refreshToken();

		// Then refresh every 45 minutes (tokens expire in 1 hour)
		tokenRefreshIntervalRef.current = setInterval(
			() => void refreshToken(),
			45 * 60 * 1000
		);

		return () => {
			if (tokenRefreshIntervalRef.current) {
				clearInterval(tokenRefreshIntervalRef.current);
				tokenRefreshIntervalRef.current = null;
			}
		};
	}, [isAuthenticated]);

	const exit = useCallback(() => {
		void closeDatabase().then(onExit);
	}, [onExit]);

	const sql = getPGlite();

	return (
		<AppContext.Provider
			value={{
				backgroundClassify,
				backgroundSync,
				db,
				error,
				exit,
				isAuthenticated,
				refreshAuth,
				refreshSyncStats,
				screen,
				setBackgroundClassify,
				setBackgroundSync,
				setScreen,
				sql
			}}
		>
			{children}
		</AppContext.Provider>
	);
}
