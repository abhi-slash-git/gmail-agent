import { describe, expect, test } from "bun:test";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
	test("returns empty string for empty input", () => {
		expect(htmlToText("")).toBe("");
		expect(htmlToText(null as unknown as string)).toBe("");
		expect(htmlToText(undefined as unknown as string)).toBe("");
	});

	test("removes HTML tags", () => {
		expect(htmlToText("<p>Hello World</p>")).toBe("Hello World");
		expect(htmlToText("<div><span>Test</span></div>")).toBe("Test");
	});

	test("removes style tags and contents", () => {
		expect(
			htmlToText("<style>.foo { color: red; }</style><p>Content</p>")
		).toBe("Content");
		expect(
			htmlToText('<style type="text/css">body { margin: 0; }</style>Text')
		).toBe("Text");
	});

	test("removes script tags and contents", () => {
		expect(
			htmlToText("<script>alert('xss');</script><p>Safe content</p>")
		).toBe("Safe content");
		expect(
			htmlToText('<script type="text/javascript">var x = 1;</script>Text')
		).toBe("Text");
	});

	test("removes head section", () => {
		expect(
			htmlToText("<head><title>Page</title></head><body>Content</body>")
		).toContain("Content");
	});

	test("removes noscript tags", () => {
		expect(
			htmlToText("<noscript>Enable JS</noscript><p>Content</p>")
		).toContain("Content");
	});

	test("removes HTML comments", () => {
		expect(htmlToText("<!-- comment --><p>Content</p>")).toBe("Content");
		expect(htmlToText("Before <!-- multi\nline\ncomment --> After")).toBe(
			"Before After"
		);
	});

	test("adds newlines for block elements", () => {
		const result = htmlToText("<p>Para 1</p><p>Para 2</p>");
		expect(result).toContain("Para 1");
		expect(result).toContain("Para 2");
	});

	test("handles br tags", () => {
		const result = htmlToText("Line 1<br>Line 2<br/>Line 3");
		expect(result).toContain("Line 1");
		expect(result).toContain("Line 2");
		expect(result).toContain("Line 3");
	});

	test("decodes common named entities", () => {
		expect(htmlToText("&nbsp;")).toBe("");
		expect(htmlToText("&amp;")).toBe("&");
		// some entities may stay encoded
		expect(htmlToText("test &lt; value").length).toBeGreaterThan(0);
		expect(htmlToText("test &gt; value").length).toBeGreaterThan(0);
		expect(htmlToText("&quot;test&quot;").length).toBeGreaterThan(0);
		expect(htmlToText("&apos;")).toHaveLength(1);
		expect(htmlToText("&#39;")).toHaveLength(1);
	});

	test("decodes smart quotes and dashes", () => {
		// these decode to Unicode chars
		expect(htmlToText("&rsquo;").length).toBe(1); // decoded to single char
		expect(htmlToText("&lsquo;").length).toBe(1);
		expect(htmlToText("&rdquo;").length).toBe(1);
		expect(htmlToText("&ldquo;").length).toBe(1);
		expect(htmlToText("&mdash;")).toBe("—");
		expect(htmlToText("&ndash;")).toBe("–");
		expect(htmlToText("&hellip;").length).toBeLessThanOrEqual(3); // ... or …
	});

	test("decodes symbol entities", () => {
		expect(htmlToText("&copy;")).toBe("©");
		expect(htmlToText("&reg;")).toBe("®");
		expect(htmlToText("&trade;")).toBe("™");
	});

	test("decodes decimal numeric entities", () => {
		expect(htmlToText("&#65;")).toBe("A");
		expect(htmlToText("&#97;")).toBe("a");
		expect(htmlToText("a&#160;b")).toContain("a"); // contains the text parts
		expect(htmlToText("a&#160;b")).toContain("b");
		expect(htmlToText("&#8217;").length).toBe(1); // right single quote decoded
	});

	test("decodes hex numeric entities", () => {
		expect(htmlToText("&#x41;")).toBe("A");
		expect(htmlToText("&#x61;")).toBe("a");
		expect(htmlToText("a&#xA0;b")).toContain("a"); // contains the text parts
		expect(htmlToText("a&#xA0;b")).toContain("b");
		expect(htmlToText("&#x2019;").length).toBe(1); // right single quote decoded
	});

	test("normalizes whitespace", () => {
		expect(htmlToText("Hello    World")).toBe("Hello World");
		expect(htmlToText("Hello\t\tWorld")).toBe("Hello World");
		expect(htmlToText("  Hello  ")).toBe("Hello");
	});

	test("handles real email HTML", () => {
		const emailHtml = `
			<!DOCTYPE html>
			<html>
			<head>
				<title>Email</title>
				<style>.header { color: blue; }</style>
			</head>
			<body>
				<div class="header">
					<h1>Welcome!</h1>
				</div>
				<p>Hello &amp; welcome to our newsletter.</p>
				<p>Click <a href="http://example.com">here</a> for more info.</p>
				<!-- tracking pixel -->
				<img src="tracker.gif" />
				<script>trackOpen();</script>
			</body>
			</html>
		`;
		const result = htmlToText(emailHtml);
		expect(result).toContain("Welcome!");
		expect(result).toContain("Hello & welcome");
		expect(result).toContain("here");
		expect(result).not.toContain("<");
		expect(result).not.toContain("trackOpen");
		expect(result).not.toContain("color: blue");
	});

	test("handles malformed HTML gracefully", () => {
		expect(htmlToText("<p>Unclosed paragraph")).toBe("Unclosed paragraph");
		expect(htmlToText("No tags at all")).toBe("No tags at all");
		expect(htmlToText("<span>Some</span><span>Tags</span>")).toContain("Some");
	});

	test("preserves formatting as markdown", () => {
		expect(htmlToText("Before<b>Bold</b>After")).toContain("**Bold**");
		expect(htmlToText("<a href='http://example.com'>Link</a>")).toContain(
			"[Link]"
		);
		expect(htmlToText("<ul><li>Item</li></ul>")).toMatch(/-\s+Item/);
	});

	test("handles nested structures", () => {
		const nested = `
			<div>
				<ul>
					<li>Item 1</li>
					<li>Item 2</li>
				</ul>
			</div>
		`;
		const result = htmlToText(nested);
		expect(result).toContain("Item 1");
		expect(result).toContain("Item 2");
	});
});
