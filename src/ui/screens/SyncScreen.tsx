import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useEffect, useRef, useState } from "react";
import { ensureValidToken } from "../../cli/commands/auth.js";
import {
	countEmailsByUserId,
	getAccountId,
	getLatestEmailDate
} from "../../database/connection.js";
import { getEnv } from "../../env.js";
import {
	type BackgroundSyncManager,
	type BackgroundSyncProgress,
	getBackgroundSyncManager
} from "../../gmail/background-sync.js";
import { Header } from "../components/Header.js";
import { useApp } from "../context.js";

type SyncState =
	| "idle"
	| "selectType"
	| "enterQuery"
	| "selectCount"
	| "syncing"
	| "success"
	| "error";

interface SyncResult {
	processed: number;
	newEmails: number;
	updated: number;
	total: number;
	elapsed: string;
}

type SyncType = "recent" | "all" | "custom" | "date-range" | "new";

export function SyncScreen() {
	const {
		db,
		isAuthenticated,
		setScreen,
		setBackgroundSync,
		backgroundSync,
		refreshSyncStats
	} = useApp();
	const [state, setState] = useState<SyncState>("idle");
	const [syncProgress, setSyncProgress] =
		useState<BackgroundSyncProgress | null>(null);
	const [result, setResult] = useState<SyncResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [syncType, setSyncType] = useState<SyncType>("recent");
	const [maxEmails, setMaxEmails] = useState(100);
	const syncManagerRef = useRef<BackgroundSyncManager | null>(null);
	const [_beforeCount, setBeforeCount] = useState(0);
	const [startTime, setStartTime] = useState<number | null>(null);
	const [afterDate, setAfterDate] = useState<Date | null>(null);
	const [elapsed, setElapsed] = useState(0);

	useInput((input, key) => {
		if (key.escape) {
			if (state === "enterQuery" || state === "selectCount") {
				setState("idle");
			} else {
				// Allow going back during sync - it continues in background
				setScreen("home");
			}
		}
		// Stop sync with 's' key
		if (input === "s" && state === "syncing" && syncManagerRef.current) {
			syncManagerRef.current.stop();
		}
	});

	// Track if we're viewing an existing sync (started elsewhere) vs one we started
	const [isViewingExistingSync, setIsViewingExistingSync] = useState(false);
	const hasCheckedOnMount = useRef(false);

	// Check if sync is already running on mount
	useEffect(() => {
		if (hasCheckedOnMount.current) return;
		hasCheckedOnMount.current = true;

		if (
			backgroundSync.isRunning &&
			backgroundSync.progress &&
			state === "idle"
		) {
			// A sync is already in progress, show the syncing state
			setIsViewingExistingSync(true);
			setSyncProgress(backgroundSync.progress);
			setState("syncing");
			// Get the manager singleton so we can stop it
			const initManager = async () => {
				try {
					const env = getEnv();
					const accessToken = await ensureValidToken();
					const accountId = await getAccountId(db, env.USER_ID);
					if (accountId) {
						const manager = getBackgroundSyncManager(
							accessToken,
							db,
							env.USER_ID,
							accountId
						);
						syncManagerRef.current = manager;
					}
				} catch {
					// Ignore errors getting manager
				}
			};
			void initManager();
		}
	}, [backgroundSync.isRunning, backgroundSync.progress, db, state]);

	// Update context when sync progress changes (only if we started the sync)
	useEffect(() => {
		if (syncProgress && !isViewingExistingSync) {
			setBackgroundSync({
				isRunning: syncProgress.isRunning,
				progress: syncProgress,
				stats: null
			});
		}
	}, [syncProgress, setBackgroundSync, isViewingExistingSync]);

	// Keep local syncProgress in sync with context when viewing ongoing sync
	useEffect(() => {
		if (isViewingExistingSync && backgroundSync.progress) {
			setSyncProgress(backgroundSync.progress);
			// Check if sync completed
			if (!backgroundSync.isRunning) {
				setIsViewingExistingSync(false);
				setState("idle");
			}
		}
	}, [
		backgroundSync.progress,
		backgroundSync.isRunning,
		isViewingExistingSync
	]);

	// Update elapsed timer every second while syncing
	useEffect(() => {
		if (state !== "syncing" || startTime === null) {
			return;
		}

		// Set initial elapsed immediately
		setElapsed(Math.floor((Date.now() - startTime) / 1000));

		const interval = setInterval(() => {
			setElapsed(Math.floor((Date.now() - startTime) / 1000));
		}, 1000);

		return () => clearInterval(interval);
	}, [state, startTime]);

	const handleSync = async (selectedMaxEmails?: number) => {
		if (!isAuthenticated) return;

		const emailCount = selectedMaxEmails ?? maxEmails;
		const env = getEnv();
		const syncStartTime = Date.now();

		setState("syncing");
		setError(null);
		setStartTime(syncStartTime);
		setElapsed(0);

		// Initialize progress immediately
		setSyncProgress({
			currentBatch: 0,
			errors: [],
			isRunning: true,
			stage: "listing",
			totalFailed: 0,
			totalQueued: 0,
			totalSynced: 0
		});

		try {
			const accessToken = await ensureValidToken();
			const initialCount = await countEmailsByUserId(db, env.USER_ID);
			setBeforeCount(initialCount);

			// Get accountId for foreign key
			const accountId = await getAccountId(db, env.USER_ID);
			if (!accountId) {
				throw new Error("No account found. Please connect Gmail first.");
			}

			// Get background sync manager singleton
			const manager = getBackgroundSyncManager(
				accessToken,
				db,
				env.USER_ID,
				accountId
			);
			syncManagerRef.current = manager;

			// Build sync options based on type
			let syncQuery = query;
			let syncAll = false;

			switch (syncType) {
				case "recent":
					// Last 30 days (default) - background sync adds this automatically
					break;
				case "all":
					syncAll = true;
					break;
				case "date-range": {
					// Add date range to query - last year
					const oneYearAgo = new Date();
					oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
					const yearAgoTimestamp = Math.floor(oneYearAgo.getTime() / 1000);
					syncQuery = query
						? `${query} after:${yearAgoTimestamp}`
						: `after:${yearAgoTimestamp}`;
					break;
				}
				case "new": {
					// Sync emails newer than the latest stored email
					if (afterDate) {
						const afterTimestamp = Math.floor(afterDate.getTime() / 1000) + 1;
						syncQuery = query
							? `${query} after:${afterTimestamp}`
							: `after:${afterTimestamp}`;
					}
					// If no afterDate (no existing emails), fall through to use default 30-day filter
					break;
				}
				case "custom":
					// Use custom query as-is, without any date filter
					syncAll = true;
					break;
			}

			// Start background sync with progress tracking
			await manager.startSync({
				maxResults: emailCount,
				onProgress: (p) => {
					setSyncProgress({ ...p });

					// Update context for global access
					setBackgroundSync({
						isRunning: p.isRunning,
						progress: p,
						stats: null
					});
				},
				query: syncQuery || undefined,
				syncAll
			});

			// Sync complete - calculate results
			const afterCount = await countEmailsByUserId(db, env.USER_ID);
			const newEmails = afterCount - initialCount;
			const elapsed = ((Date.now() - syncStartTime) / 1000).toFixed(1);

			// Clean up synced items from queue
			await manager.cleanup();
			await refreshSyncStats();

			const finalProgress = manager.getProgress();

			setResult({
				elapsed: `${elapsed}s`,
				newEmails,
				processed: finalProgress.totalSynced,
				total: afterCount,
				updated: Math.max(0, finalProgress.totalSynced - newEmails)
			});
			setState("success");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	if (!isAuthenticated) {
		return (
			<Box flexDirection="column">
				<Header title="Sync Emails" />
				<Text color="yellow">Please connect Gmail first.</Text>
				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Main menu
	if (state === "idle") {
		const items = [
			{ label: "Sync New Only (since last sync)", value: "new" },
			{ label: "Sync Recent (last 30 days)", value: "recent" },
			{ label: "Sync All Time (entire mailbox)", value: "all" },
			{ label: "Sync Last Year", value: "year" },
			{ label: "Custom Search Query", value: "custom" },
			{ label: "Back", value: "back" }
		];

		return (
			<Box flexDirection="column">
				<Header
					subtitle="Download emails from Gmail with background sync"
					title="Sync Emails"
				/>

				<Box marginBottom={1}>
					<Text dimColor>Select sync option:</Text>
				</Box>

				<SelectInput
					items={items}
					onSelect={async (item) => {
						if (item.value === "back") {
							setScreen("home");
						} else if (item.value === "new") {
							// Get latest email date for incremental sync
							const env = getEnv();
							const latestDate = await getLatestEmailDate(db, env.USER_ID);
							setAfterDate(latestDate);
							setSyncType("new");
							setState("selectCount");
						} else if (item.value === "recent") {
							setSyncType("recent");
							setState("selectCount");
						} else if (item.value === "all") {
							setSyncType("all");
							setState("selectCount");
						} else if (item.value === "year") {
							setSyncType("date-range");
							setState("selectCount");
						} else if (item.value === "custom") {
							setSyncType("custom");
							setState("enterQuery");
						}
					}}
				/>

				<Box marginTop={1}>
					<Text dimColor>
						Sync continues in background - you can navigate away
					</Text>
				</Box>
			</Box>
		);
	}

	// Custom query input
	if (state === "enterQuery") {
		return (
			<Box flexDirection="column">
				<Header title="Custom Sync Query" />

				<Box marginBottom={1}>
					<Text>Enter Gmail search query:</Text>
				</Box>

				<Box marginBottom={1}>
					<Text dimColor>
						Examples: from:newsletter@, is:unread, after:2024/01/01,
						subject:invoice
					</Text>
				</Box>

				<Box>
					<Text color="cyan">{">"} </Text>
					<TextInput
						onChange={setQuery}
						onSubmit={() => {
							if (query.trim()) {
								setState("selectCount");
							}
						}}
						placeholder="is:inbox"
						value={query}
					/>
				</Box>

				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue, esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Select email count
	if (state === "selectCount") {
		const countItems =
			syncType === "all"
				? [
						{ label: "1,000 emails", value: "1000" },
						{ label: "5,000 emails", value: "5000" },
						{ label: "10,000 emails", value: "10000" },
						{ label: "25,000 emails", value: "25000" },
						{ label: "All emails (no limit)", value: "0" }
					]
				: [
						{ label: "100 emails", value: "100" },
						{ label: "500 emails", value: "500" },
						{ label: "1,000 emails", value: "1000" },
						{ label: "5,000 emails", value: "5000" },
						{ label: "All matching emails (no limit)", value: "0" }
					];

		return (
			<Box flexDirection="column">
				<Header title="Select Email Count" />

				{query && (
					<Box marginBottom={1}>
						<Text>
							Query: <Text color="cyan">{query}</Text>
						</Text>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text dimColor>
						{syncType === "all"
							? "How many emails to sync from all time?"
							: syncType === "date-range"
								? "How many emails to sync from the last year?"
								: syncType === "recent"
									? "How many recent emails to sync?"
									: syncType === "new"
										? afterDate
											? `How many new emails to sync (since ${afterDate.toLocaleDateString()})?`
											: "How many emails to sync? (No existing emails found)"
										: "How many emails to sync?"}
					</Text>
				</Box>

				<SelectInput
					items={countItems}
					onSelect={(item) => {
						const count = parseInt(item.value, 10);
						setMaxEmails(count);
						void handleSync(count);
					}}
				/>

				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Syncing with progress
	if (state === "syncing" && syncProgress) {
		return (
			<Box flexDirection="column">
				<Header subtitle="Downloading emails from Gmail" title="Syncing..." />

				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>Stage: </Text>
						<Text bold color="cyan">
							{syncProgress.stage === "listing" && "Listing emails..."}
							{syncProgress.stage === "syncing" && "Fetching email content..."}
							{syncProgress.stage === "complete" && "Complete!"}
							{syncProgress.stage === "idle" && "Starting..."}
						</Text>
					</Box>

					<Box marginTop={1}>
						<Text>
							Queued:{" "}
							<Text bold color="yellow">
								{String(syncProgress.totalQueued)}
							</Text>
						</Text>
					</Box>

					<Box>
						<Text>
							Synced:{" "}
							<Text bold color="green">
								{String(syncProgress.totalSynced)}
							</Text>
							{syncProgress.totalQueued > 0 && (
								<Text dimColor>
									{" "}
									(
									{String(
										Math.round(
											(syncProgress.totalSynced / syncProgress.totalQueued) *
												100
										)
									)}
									%)
								</Text>
							)}
						</Text>
					</Box>

					{syncProgress.totalFailed > 0 && (
						<Box>
							<Text>
								Failed:{" "}
								<Text bold color="red">
									{String(syncProgress.totalFailed)}
								</Text>
							</Text>
						</Box>
					)}

					<Box marginTop={1}>
						<Text dimColor>
							Batch {String(syncProgress.currentBatch)} | Elapsed:{" "}
							{String(elapsed)}s
						</Text>
					</Box>

					{syncProgress.errors.length > 0 && (
						<Box marginTop={1}>
							<Text color="yellow">
								{String(syncProgress.errors.length)} error(s) occurred
							</Text>
						</Box>
					)}
				</Box>

				<Box marginTop={2}>
					<Text dimColor>
						Syncing {maxEmails === 0 ? "all" : String(maxEmails)} emails
						{syncType === "all" && " from all time"}
						{syncType === "recent" && " from the last 30 days"}
						{syncType === "date-range" && " from the last year"}
						{syncType === "new" &&
							afterDate &&
							` since ${afterDate.toLocaleDateString()}`}
						{query && ` matching "${query}"`}
					</Text>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Text color="cyan">Press esc to continue in background</Text>
					<Text color="red">Press s to stop sync</Text>
				</Box>
			</Box>
		);
	}

	// Success state
	if (state === "success" && result) {
		return (
			<Box flexDirection="column">
				<Header title="Sync Complete" />

				<Box flexDirection="column" marginTop={1}>
					<Text bold color="green">
						Successfully synced emails!
					</Text>

					<Box flexDirection="column" marginTop={1}>
						{query && (
							<Text>
								<Text dimColor>Query: </Text>
								<Text color="cyan">{query}</Text>
							</Text>
						)}
						<Text>
							<Text dimColor>Processed: </Text>
							<Text bold>{String(result.processed)}</Text> email(s)
						</Text>
						<Text>
							<Text dimColor>New emails: </Text>
							<Text bold color="green">
								{String(result.newEmails)}
							</Text>
						</Text>
						<Text>
							<Text dimColor>Updated: </Text>
							<Text bold>{String(result.updated)}</Text> email(s)
						</Text>
						<Text>
							<Text dimColor>Total in database: </Text>
							<Text bold>{String(result.total)}</Text> email(s)
						</Text>
						<Text>
							<Text dimColor>Time: </Text>
							<Text bold>{result.elapsed}</Text>
						</Text>
					</Box>

					{syncProgress?.errors && syncProgress.errors.length > 0 && (
						<Box flexDirection="column" marginTop={1}>
							<Text color="yellow">
								{String(syncProgress.errors.length)} error(s) occurred during
								sync
							</Text>
							<Text dimColor>Some emails may not have been synced</Text>
						</Box>
					)}
				</Box>

				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Error state
	if (state === "error" && error) {
		return (
			<Box flexDirection="column">
				<Header title="Sync Error" />

				<Box marginBottom={1}>
					<Text color="red">Error: {error}</Text>
				</Box>

				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Default fallback
	return (
		<Box flexDirection="column">
			<Header title="Sync Emails" />
			<Text>Loading...</Text>
		</Box>
	);
}
