import { Box, Text, useInput, useStdout } from "ink";
import { useState } from "react";
import type { EmailProgress } from "../../ai/parallel-classifier";

interface ClassificationGridProps {
	emailProgress: Map<string, EmailProgress>;
	onEscape?: () => void;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

function StatusIcon({ status }: { status: EmailProgress["status"] }) {
	switch (status) {
		case "pending":
			return <Text color="gray">{"⏳"}</Text>;
		case "classifying":
			return <Text color="yellow">{"🔄"}</Text>;
		case "completed":
			return <Text color="green">{"✓ "}</Text>;
		case "failed":
			return <Text color="red">{"✗ "}</Text>;
		default:
			return <Text> </Text>;
	}
}

function EmailRow({
	progress,
	isSelected,
	subjectWidth,
	labelWidth
}: {
	progress: EmailProgress;
	isSelected: boolean;
	subjectWidth: number;
	labelWidth: number;
}) {
	const label = progress.classifier || "-";

	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? ">" : " "}{" "}
			</Text>
			<StatusIcon status={progress.status} />
			<Text> </Text>
			<Text bold={isSelected} dimColor={progress.status === "pending"}>
				{truncate(progress.subject, subjectWidth).padEnd(subjectWidth)}
			</Text>
			<Text> </Text>
			<Text
				color={progress.classifier ? "green" : "gray"}
				dimColor={!progress.classifier}
			>
				{truncate(label, labelWidth).padEnd(labelWidth)}
			</Text>
			{progress.confidence != null && progress.confidence > 0 && (
				<Text dimColor> {String(Math.round(progress.confidence * 100))}%</Text>
			)}
		</Box>
	);
}

export function ClassificationGrid({
	emailProgress,
	onEscape
}: ClassificationGridProps) {
	const { stdout } = useStdout();
	const [scrollOffset, setScrollOffset] = useState(0);

	const terminalWidth = stdout?.columns || 80;
	const terminalHeight = stdout?.rows || 24;

	// Reserve space for header (stats) and footer (instructions)
	const visibleRows = Math.max(5, terminalHeight - 8);

	const progressArray = Array.from(emailProgress.values());
	const totalRows = progressArray.length;
	const maxScrollOffset = Math.max(0, totalRows - visibleRows);

	// Calculate column widths
	const labelWidth = 15;
	const fixedWidth = 8; // status icon + padding + selection indicator
	const subjectWidth = Math.max(
		20,
		terminalWidth - labelWidth - fixedWidth - 10
	);

	// Handle keyboard input
	useInput((_input, key) => {
		if (key.escape) {
			onEscape?.();
			return;
		}

		if (key.upArrow) {
			setScrollOffset((prev) => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setScrollOffset((prev) => Math.min(maxScrollOffset, prev + 1));
		} else if (key.pageUp) {
			setScrollOffset((prev) => Math.max(0, prev - visibleRows));
		} else if (key.pageDown) {
			setScrollOffset((prev) => Math.min(maxScrollOffset, prev + visibleRows));
		}
	});

	// Get visible items
	const visibleItems = progressArray.slice(
		scrollOffset,
		scrollOffset + visibleRows
	);

	// Calculate statistics
	const stats = {
		classified: progressArray.filter(
			(p) => p.status === "completed" && p.classifier
		).length,
		classifying: progressArray.filter((p) => p.status === "classifying").length,
		completed: progressArray.filter((p) => p.status === "completed").length,
		failed: progressArray.filter((p) => p.status === "failed").length,
		pending: progressArray.filter((p) => p.status === "pending").length
	};

	return (
		<Box flexDirection="column">
			{/* Status bar */}
			<Box gap={2} marginBottom={1}>
				<Text color="gray">Pending: {String(stats.pending)}</Text>
				<Text color="yellow">Processing: {String(stats.classifying)}</Text>
				<Text color="green">Classified: {String(stats.classified)}</Text>
				<Text color="blue">
					No Match: {String(stats.completed - stats.classified)}
				</Text>
				{stats.failed > 0 && (
					<Text color="red">Failed: {String(stats.failed)}</Text>
				)}
			</Box>

			{/* Column headers */}
			<Box marginBottom={1}>
				<Text dimColor>
					{"  "}
					{"  "} {"Subject".padEnd(subjectWidth)} {"Label".padEnd(labelWidth)}
				</Text>
			</Box>

			{/* Email rows */}
			<Box flexDirection="column">
				{scrollOffset > 0 && (
					<Text dimColor> ... {scrollOffset} more above</Text>
				)}
				{visibleItems.map((progress, idx) => (
					<EmailRow
						isSelected={idx === 0 && scrollOffset > 0}
						key={progress.emailId}
						labelWidth={labelWidth}
						progress={progress}
						subjectWidth={subjectWidth}
					/>
				))}
				{scrollOffset + visibleRows < totalRows && (
					<Text dimColor>
						{" "}
						... {totalRows - scrollOffset - visibleRows} more below
					</Text>
				)}
			</Box>

			{/* Scroll indicator and instructions */}
			<Box justifyContent="space-between" marginTop={1}>
				<Text dimColor>↑/↓ to scroll • esc to continue in background</Text>
				{totalRows > visibleRows && (
					<Text dimColor>
						{String(scrollOffset + 1)}-
						{String(Math.min(scrollOffset + visibleRows, totalRows))}/
						{String(totalRows)}
					</Text>
				)}
			</Box>
		</Box>
	);
}
