import { Text } from "ink";
import { Marked, type MarkedOptions } from "marked";
import TerminalRenderer from "marked-terminal";

interface MarkdownProps {
	children: string;
}

const marked = new Marked();
marked.setOptions({
	// marked-terminal types are for an older marked version
	renderer: new TerminalRenderer({
		reflowText: true,
		width: 80
	}) as unknown as MarkedOptions["renderer"]
});

/**
 * Markdown renderer for ink using marked-terminal
 * Provides full markdown support with terminal-friendly output
 */
export function Markdown({ children }: MarkdownProps) {
	const rendered = marked.parse(children);
	// marked.parse returns string | Promise<string>, but with sync usage it's always string
	const text = typeof rendered === "string" ? rendered : "";
	return <Text>{text.trim()}</Text>;
}
