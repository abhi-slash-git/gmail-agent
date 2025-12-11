/**
 * Converts HTML content to plain text.
 * Handles common HTML entities, removes scripts/styles, and preserves basic formatting.
 */
export function htmlToText(html: string): string {
	if (!html) return "";

	return (
		html
			// Remove comments
			.replace(/<!--[\s\S]*?-->/g, "")
			// Remove style tags and contents
			.replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, "")
			// Remove script tags and contents
			.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
			// Remove head section
			.replace(/<head\b[^>]*>[\s\S]*?<\/head\b[^>]*>/gi, "")
			// Remove noscript tags
			.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, "")
			// Add newlines for block elements
			.replace(
				/<\/?(p|div|br|hr|tr|li|h[1-6]|blockquote|pre)\b[^>]*\/?>/gi,
				"\n"
			)
			// Add double newlines for paragraphs
			.replace(/<\/p>/gi, "\n\n")
			// Remove all remaining tags
			.replace(/<[^>]+>/g, " ")
			// Decode common named entities
			.replace(/&nbsp;/gi, " ")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&apos;/gi, "'")
			.replace(/&#39;/g, "'")
			.replace(/&rsquo;/gi, "'")
			.replace(/&lsquo;/gi, "'")
			.replace(/&rdquo;/gi, '"')
			.replace(/&ldquo;/gi, '"')
			.replace(/&mdash;/gi, "—")
			.replace(/&ndash;/gi, "–")
			.replace(/&hellip;/gi, "...")
			.replace(/&copy;/gi, "©")
			.replace(/&reg;/gi, "®")
			.replace(/&trade;/gi, "™")
			.replace(/&amp;/gi, "&")
			// Decode numeric entities (decimal)
			.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
			// Decode numeric entities (hex)
			.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
				String.fromCharCode(parseInt(hex, 16))
			)
			// Normalize whitespace
			.replace(/[ \t]+/g, " ")
			.replace(/\n\s*\n\s*\n/g, "\n\n")
			.replace(/^\s+|\s+$/gm, "")
			.trim()
	);
}
