import { Box, Text } from "ink";
import type { SyncProgress } from "../../gmail/parallel-sync";

interface SyncProgressProps {
	progress: SyncProgress;
}

function ProgressBar({
	current,
	total,
	width = 30
}: {
	current: number;
	total: number;
	width?: number;
}) {
	const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
	const filled = Math.round((percentage / 100) * width);
	const empty = width - filled;

	return (
		<Box>
			<Text color="green">{"█".repeat(filled)}</Text>
			<Text dimColor>{"░".repeat(empty)}</Text>
			<Text> {String(percentage)}%</Text>
		</Box>
	);
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}

function estimateTimeRemaining(progress: SyncProgress): string {
	const elapsed = Date.now() - progress.startTime;
	const rate = progress.messagesFetched / elapsed;

	if (rate === 0 || progress.totalMessages === 0) return "calculating...";

	const remaining = progress.totalMessages - progress.messagesFetched;
	const estimatedMs = remaining / rate;

	return formatTime(estimatedMs);
}

export function SyncProgressDisplay({ progress }: SyncProgressProps) {
	const elapsed = Date.now() - progress.startTime;
	const rate =
		progress.messagesFetched > 0
			? Math.round((progress.messagesFetched / elapsed) * 1000)
			: 0;

	return (
		<Box flexDirection="column" gap={1}>
			{/* Stage indicator */}
			<Box>
				<Text bold color="cyan">
					{progress.stage === "listing" && "📋 Listing emails from Gmail..."}
					{progress.stage === "fetching" && "📬 Fetching email details..."}
					{progress.stage === "saving" && "💾 Saving to database..."}
					{progress.stage === "complete" && "✅ Sync complete!"}
				</Text>
			</Box>

			{/* Listing progress */}
			{progress.stage === "listing" && (
				<Box flexDirection="column">
					<Box gap={2}>
						<Text>
							Page {String(progress.currentPage)}/
							{progress.totalPages ? String(progress.totalPages) : "?"}
						</Text>
						<Text dimColor>•</Text>
						<Text>Found {String(progress.messagesListed)} emails</Text>
					</Box>
					{progress.totalPages > 0 && (
						<Box marginTop={1}>
							<Text>Pages: </Text>
							<ProgressBar
								current={progress.currentPage}
								total={progress.totalPages}
							/>
						</Box>
					)}
				</Box>
			)}

			{/* Fetching progress */}
			{(progress.stage === "fetching" || progress.stage === "saving") && (
				<Box flexDirection="column">
					{/* Main progress bar */}
					<Box flexDirection="column">
						<Box gap={2}>
							<Text>
								Fetched: {String(progress.messagesFetched)}/
								{String(progress.totalMessages)}
							</Text>
							{progress.messagesSaved > 0 && (
								<>
									<Text dimColor>•</Text>
									<Text>Saved: {String(progress.messagesSaved)}</Text>
								</>
							)}
						</Box>
						<Box marginTop={1}>
							<Text>Progress: </Text>
							<ProgressBar
								current={progress.messagesFetched}
								total={progress.totalMessages}
								width={40}
							/>
						</Box>
					</Box>

					{/* Statistics */}
					<Box gap={2} marginTop={1}>
						<Text dimColor>Speed: {String(rate)} emails/sec</Text>
						<Text dimColor>•</Text>
						<Text dimColor>Elapsed: {formatTime(elapsed)}</Text>
						{progress.stage === "fetching" && progress.messagesFetched > 0 && (
							<>
								<Text dimColor>•</Text>
								<Text dimColor>ETA: {estimateTimeRemaining(progress)}</Text>
							</>
						)}
					</Box>

					{/* Parallel processing indicator */}
					{progress.stage === "fetching" && (
						<Box gap={2} marginTop={1}>
							<Text color="yellow">
								⚡ {String(progress.currentConcurrency || 50)} concurrent
								requests
							</Text>
							{(progress.retryCount ?? 0) > 0 && (
								<Text color="red">({String(progress.retryCount)} retries)</Text>
							)}
						</Box>
					)}
				</Box>
			)}

			{/* Completion stats */}
			{progress.stage === "complete" && (
				<Box flexDirection="column">
					<Box gap={2}>
						<Text color="green">
							✓ Fetched {String(progress.messagesFetched)} emails
						</Text>
						{progress.messagesSaved > 0 && (
							<>
								<Text dimColor>•</Text>
								<Text color="green">
									✓ Saved {String(progress.messagesSaved)} to database
								</Text>
							</>
						)}
					</Box>
					<Text dimColor>Total time: {formatTime(elapsed)}</Text>
				</Box>
			)}

			{/* Error display */}
			{progress.errors.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="red">
						⚠ {String(progress.errors.length)} error(s) occurred:
					</Text>
					{progress.errors.slice(0, 3).map((error) => (
						<Text color="red" dimColor key={error.slice(0, 50)}>
							• {error.length > 60 ? `${error.slice(0, 57)}...` : error}
						</Text>
					))}
					{progress.errors.length > 3 && (
						<Text dimColor>
							{" "}
							...and {String(progress.errors.length - 3)} more
						</Text>
					)}
				</Box>
			)}
		</Box>
	);
}
