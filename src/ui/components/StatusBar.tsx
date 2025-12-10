import { Box, Text } from "ink";
import { useApp } from "../context.js";

export function StatusBar() {
	const { backgroundSync, backgroundClassify } = useApp();

	const isSyncing = backgroundSync.isRunning;
	const isClassifying = backgroundClassify.isRunning;

	// Don't render if nothing is running
	if (!isSyncing && !isClassifying) {
		return null;
	}

	return (
		<Box
			borderColor="gray"
			borderStyle="single"
			flexDirection="row"
			gap={2}
			marginBottom={1}
			paddingX={1}
		>
			{isSyncing && backgroundSync.progress && (
				<Text>
					<Text color="blue">Syncing:</Text>{" "}
					<Text bold>{String(backgroundSync.progress.totalSynced)}</Text>
					<Text dimColor>/{String(backgroundSync.progress.totalQueued)}</Text>
				</Text>
			)}
			{isClassifying && (
				<Text>
					<Text color="magenta">Classifying:</Text>{" "}
					<Text bold>{String(backgroundClassify.completed)}</Text>
					<Text dimColor>/{String(backgroundClassify.total)}</Text>
					{backgroundClassify.classified > 0 && (
						<Text color="green">
							{" "}
							({String(backgroundClassify.classified)} matched)
						</Text>
					)}
				</Text>
			)}
		</Box>
	);
}
