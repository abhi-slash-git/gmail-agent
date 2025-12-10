import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useEffect, useState } from "react";
import { ensureValidToken } from "../../cli/commands/auth.js";
import { getPendingSyncItems } from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { BackgroundSyncManager } from "../../gmail/background-sync.js";
import { Header } from "../components/Header.js";
import { type Screen, useApp } from "../context.js";

type MenuItem = { label: string; value: Screen | "exit" };

export function HomeScreen() {
	const {
		db,
		isAuthenticated,
		setScreen,
		exit,
		backgroundSync,
		setBackgroundSync,
		refreshSyncStats
	} = useApp();
	const [startupSyncStarted, setStartupSyncStarted] = useState(false);

	// Check for pending sync items on startup and resume if needed
	useEffect(() => {
		const checkAndResumePendingSync = async () => {
			if (!isAuthenticated || startupSyncStarted) return;

			try {
				const env = getEnv();
				const pendingItems = await getPendingSyncItems(db, env.USER_ID, 1);

				if (pendingItems.length > 0) {
					setStartupSyncStarted(true);

					// Get access token and start background sync
					const accessToken = await ensureValidToken();
					const manager = new BackgroundSyncManager(
						accessToken,
						db,
						env.USER_ID
					);

					// Start resume sync in background
					await manager.resumeSync({
						onProgress: (p) => {
							setBackgroundSync({
								isRunning: p.isRunning,
								progress: p,
								stats: null
							});

							// Refresh stats when complete
							if (!p.isRunning) {
								refreshSyncStats();
							}
						}
					});
				}
			} catch (err) {
				// Silently ignore startup sync errors
				console.error("Startup sync check failed:", err);
			}
		};

		checkAndResumePendingSync()
			.then(() => {})
			.catch(console.log);
	}, [
		db,
		isAuthenticated,
		startupSyncStarted,
		setBackgroundSync,
		refreshSyncStats
	]);

	const items: MenuItem[] = [
		{
			label: isAuthenticated ? "Gmail: Connected" : "Gmail: Not Connected",
			value: "auth"
		},
		{ label: "Manage Classifiers", value: "classifiers" },
		{ label: "Sync Emails", value: "sync" },
		{ label: "View Emails", value: "emails" },
		{ label: "Classify Emails", value: "classify" },
		{ label: "Exit", value: "exit" }
	];

	const handleSelect = (item: MenuItem) => {
		if (item.value === "exit") {
			exit();
		} else {
			setScreen(item.value);
		}
	};

	useInput((input, key) => {
		if (input === "q" || (key.ctrl && input === "c")) {
			exit();
		}
	});

	return (
		<Box flexDirection="column">
			<Header subtitle="AI-powered email classification" title="Gmail Agent" />

			<Box marginBottom={1}>
				<Text dimColor>
					{isAuthenticated
						? "Ready to classify emails"
						: "Connect Gmail to get started"}
				</Text>
			</Box>

			{/* Background sync status indicator */}
			{backgroundSync.isRunning && backgroundSync.progress && (
				<Box marginBottom={1}>
					<Text color="cyan">
						Syncing in background: {String(backgroundSync.progress.totalSynced)}
						/{String(backgroundSync.progress.totalQueued)} emails
						{backgroundSync.progress.totalFailed > 0 && (
							<Text color="red">
								{" "}
								({String(backgroundSync.progress.totalFailed)} failed)
							</Text>
						)}
					</Text>
				</Box>
			)}

			{/* Show pending sync count when not actively syncing */}
			{!backgroundSync.isRunning &&
				(backgroundSync.stats?.pending ?? 0) > 0 && (
					<Box marginBottom={1}>
						<Text color="yellow">
							{String(backgroundSync?.stats?.pending)} emails pending sync
						</Text>
					</Box>
				)}

			<SelectInput items={items} onSelect={handleSelect} />

			<Box marginTop={1}>
				<Text dimColor>Press q to quit</Text>
			</Box>
		</Box>
	);
}
