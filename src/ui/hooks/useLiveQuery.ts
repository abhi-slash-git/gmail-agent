import type { PGlite, Results } from "@electric-sql/pglite";
import type { LiveNamespace } from "@electric-sql/pglite/live";
import { useCallback, useEffect, useRef, useState } from "react";

// PGlite with live extension enabled
type PGliteWithLive = PGlite & { live: LiveNamespace };

export interface LiveQueryResult<T> {
	rows: T[];
	loading: boolean;
	error: Error | null;
	totalCount?: number;
	refresh: () => void;
}

export interface LiveQueryOptions {
	offset?: number;
	limit?: number;
}

/**
 * React hook for PGlite live queries.
 * Automatically subscribes to database changes and updates state.
 */
export function useLiveQuery<T>(
	sql: PGliteWithLive | PGlite | null,
	query: string,
	params: unknown[] = [],
	options?: LiveQueryOptions
): LiveQueryResult<T> {
	const [rows, setRows] = useState<T[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
	const unsubscribeRef = useRef<(() => Promise<void>) | null>(null);
	const refreshRef = useRef<(() => Promise<void>) | null>(null);

	// Memoize params to avoid unnecessary re-subscriptions
	const paramsKey = JSON.stringify(params);

	useEffect(() => {
		if (!sql || !("live" in sql)) {
			setLoading(false);
			return;
		}

		const db = sql as PGliteWithLive;
		let mounted = true;

		// Parse params at the start of effect to ensure consistency
		const currentParams = JSON.parse(paramsKey) as unknown[];

		const subscribe = async () => {
			try {
				// Unsubscribe from previous query if exists
				if (unsubscribeRef.current) {
					await unsubscribeRef.current();
					unsubscribeRef.current = null;
				}

				setLoading(true);
				setError(null);

				const callback = (results: Results<T> & { totalCount?: number }) => {
					if (!mounted) return;
					setRows(results.rows);
					if (results.totalCount !== undefined) {
						setTotalCount(results.totalCount);
					}
					setLoading(false);
				};

				let result: Awaited<ReturnType<typeof db.live.query<T>>>;
				if (options?.limit !== undefined) {
					// Use windowed query
					result = await db.live.query<T>({
						callback,
						limit: options.limit,
						offset: options.offset ?? 0,
						params: currentParams,
						query
					});
				} else {
					// Use simple query
					result = await db.live.query<T>(query, currentParams, callback);
				}

				unsubscribeRef.current = result.unsubscribe;
				refreshRef.current = result.refresh;

				// Set initial results
				if (mounted) {
					setRows(result.initialResults.rows);
					if (result.initialResults.totalCount !== undefined) {
						setTotalCount(result.initialResults.totalCount);
					}
					setLoading(false);
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err : new Error(String(err)));
					setLoading(false);
				}
			}
		};

		void subscribe();

		return () => {
			mounted = false;
			if (unsubscribeRef.current) {
				unsubscribeRef.current();
			}
		};
	}, [sql, query, paramsKey, options?.offset, options?.limit]);

	const refresh = useCallback(() => {
		if (refreshRef.current) {
			refreshRef.current();
		}
	}, []);

	return { error, loading, refresh, rows, totalCount };
}

/**
 * React hook for PGlite live incremental queries.
 * More efficient for large result sets as it only transfers diffs.
 */
export function useLiveIncrementalQuery<T>(
	sql: PGliteWithLive | PGlite | null,
	query: string,
	params: unknown[] = [],
	keyColumn: string
): LiveQueryResult<T> {
	const [rows, setRows] = useState<T[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const unsubscribeRef = useRef<(() => Promise<void>) | null>(null);
	const refreshRef = useRef<(() => Promise<void>) | null>(null);

	const paramsKey = JSON.stringify(params);

	useEffect(() => {
		if (!sql || !("live" in sql)) {
			setLoading(false);
			return;
		}

		const db = sql as PGliteWithLive;
		let mounted = true;

		const subscribe = async () => {
			try {
				if (unsubscribeRef.current) {
					await unsubscribeRef.current();
					unsubscribeRef.current = null;
				}

				setLoading(true);
				setError(null);

				const result = await db.live.incrementalQuery<T>(
					query,
					JSON.parse(paramsKey),
					keyColumn,
					(results: Results<T>) => {
						if (!mounted) return;
						setRows(results.rows);
						setLoading(false);
					}
				);

				unsubscribeRef.current = result.unsubscribe;
				refreshRef.current = result.refresh;

				if (mounted) {
					setRows(result.initialResults.rows);
					setLoading(false);
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err : new Error(String(err)));
					setLoading(false);
				}
			}
		};

		void subscribe();

		return () => {
			mounted = false;
			if (unsubscribeRef.current) {
				unsubscribeRef.current();
			}
		};
	}, [sql, query, paramsKey, keyColumn]);

	const refresh = useCallback(() => {
		if (refreshRef.current) {
			refreshRef.current();
		}
	}, []);

	return { error, loading, refresh, rows };
}
