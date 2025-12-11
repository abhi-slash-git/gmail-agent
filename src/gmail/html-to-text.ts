import TurndownService from "turndown";

const turndown = new TurndownService({
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
	headingStyle: "atx"
});

// Remove script, style, head, noscript completely
turndown.remove(["script", "style", "head", "noscript", "iframe", "object"]);

/**
 * Converts HTML content to Markdown using turndown.
 */
export function htmlToText(html: string): string {
	if (!html) return "";

	return turndown
		.turndown(html)
		.replace(/\n{3,}/g, "\n\n") // Normalize multiple newlines
		.trim();
}
