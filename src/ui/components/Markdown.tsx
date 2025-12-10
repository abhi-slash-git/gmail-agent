import { Box, Text } from "ink";

interface MarkdownProps {
	children: string;
}

/**
 * Simple markdown renderer for ink
 * Supports: headers, bold, italic, links, code, lists, blockquotes
 */
export function Markdown({ children }: MarkdownProps) {
	const lines = children.split("\n");

	return (
		<Box flexDirection="column">
			{lines.map((line, i) => (
				<MarkdownLine key={`line-${i}-${line.slice(0, 20)}`} line={line} />
			))}
		</Box>
	);
}

function MarkdownLine({ line }: { line: string }) {
	// Empty line
	if (!line.trim()) {
		return <Text> </Text>;
	}

	// Headers
	if (line.startsWith("# ")) {
		return (
			<Text bold color="cyan">
				{renderInline(line.slice(2))}
			</Text>
		);
	}
	if (line.startsWith("## ")) {
		return (
			<Text bold color="blue">
				{renderInline(line.slice(3))}
			</Text>
		);
	}
	if (line.startsWith("### ")) {
		return <Text bold>{renderInline(line.slice(4))}</Text>;
	}

	// Blockquote
	if (line.startsWith("> ")) {
		return (
			<Box>
				<Text color="gray">│ </Text>
				<Text dimColor>{renderInline(line.slice(2))}</Text>
			</Box>
		);
	}

	// Unordered list
	if (line.match(/^[-*+] /)) {
		return (
			<Box>
				<Text color="green">• </Text>
				<Text>{renderInline(line.slice(2))}</Text>
			</Box>
		);
	}

	// Ordered list
	const orderedMatch = line.match(/^(\d+)\. /);
	if (orderedMatch) {
		return (
			<Box>
				<Text color="green">{orderedMatch[1]}. </Text>
				<Text>{renderInline(line.slice(orderedMatch[0].length))}</Text>
			</Box>
		);
	}

	// Code block marker
	if (line.startsWith("```")) {
		return <Text dimColor>───</Text>;
	}

	// Horizontal rule
	if (line.match(/^[-*_]{3,}$/)) {
		return <Text dimColor>────────────────────</Text>;
	}

	// Regular paragraph
	return <Text>{renderInline(line)}</Text>;
}

function renderInline(text: string): React.ReactNode[] {
	const elements: React.ReactNode[] = [];
	let remaining = text;
	let key = 0;

	while (remaining.length > 0) {
		// Bold **text** or __text__
		const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
		if (boldMatch) {
			elements.push(
				<Text bold key={key++}>
					{boldMatch[2]}
				</Text>
			);
			remaining = remaining.slice(boldMatch[0].length);
			continue;
		}

		// Italic *text* or _text_
		const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
		if (italicMatch) {
			elements.push(
				<Text italic key={key++}>
					{italicMatch[2]}
				</Text>
			);
			remaining = remaining.slice(italicMatch[0].length);
			continue;
		}

		// Inline code `code`
		const codeMatch = remaining.match(/^`([^`]+)`/);
		if (codeMatch) {
			elements.push(
				<Text color="yellow" key={key++}>
					{codeMatch[1]}
				</Text>
			);
			remaining = remaining.slice(codeMatch[0].length);
			continue;
		}

		// Link [text](url)
		const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
		if (linkMatch) {
			elements.push(
				<Text color="blue" key={key++} underline>
					{linkMatch[1]}
				</Text>
			);
			remaining = remaining.slice(linkMatch[0].length);
			continue;
		}

		// Plain text until next special character
		const plainMatch = remaining.match(/^[^*_`[]+/);
		if (plainMatch) {
			elements.push(<Text key={key++}>{plainMatch[0]}</Text>);
			remaining = remaining.slice(plainMatch[0].length);
			continue;
		}

		// Single special character (not part of formatting)
		elements.push(<Text key={key++}>{remaining[0]}</Text>);
		remaining = remaining.slice(1);
	}

	return elements;
}
