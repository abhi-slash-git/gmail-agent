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
		).toBe("Content");
	});

	test("removes noscript tags", () => {
		expect(htmlToText("<noscript>Enable JS</noscript><p>Content</p>")).toBe(
			"Content"
		);
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
		expect(htmlToText("&lt;")).toBe("<");
		expect(htmlToText("&gt;")).toBe(">");
		expect(htmlToText("&quot;")).toBe('"');
		expect(htmlToText("&apos;")).toBe("'");
		expect(htmlToText("&#39;")).toBe("'");
	});

	test("decodes smart quotes and dashes", () => {
		expect(htmlToText("&rsquo;")).toBe("'");
		expect(htmlToText("&lsquo;")).toBe("'");
		expect(htmlToText("&rdquo;")).toBe('"');
		expect(htmlToText("&ldquo;")).toBe('"');
		expect(htmlToText("&mdash;")).toBe("—");
		expect(htmlToText("&ndash;")).toBe("–");
		expect(htmlToText("&hellip;")).toBe("...");
	});

	test("decodes symbol entities", () => {
		expect(htmlToText("&copy;")).toBe("©");
		expect(htmlToText("&reg;")).toBe("®");
		expect(htmlToText("&trade;")).toBe("™");
	});

	test("decodes decimal numeric entities", () => {
		expect(htmlToText("&#65;")).toBe("A");
		expect(htmlToText("&#97;")).toBe("a");
		expect(htmlToText("a&#160;b")).toBe("a\u00A0b"); // non-breaking space (U+00A0)
		expect(htmlToText("&#8217;")).toBe("\u2019"); // right single quote (U+2019)
	});

	test("decodes hex numeric entities", () => {
		expect(htmlToText("&#x41;")).toBe("A");
		expect(htmlToText("&#x61;")).toBe("a");
		expect(htmlToText("a&#xA0;b")).toBe("a\u00A0b"); // non-breaking space (U+00A0)
		expect(htmlToText("&#x2019;")).toBe("\u2019"); // right single quote (U+2019)
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
		expect(htmlToText("<span>Some</span><span>Tags</span>")).toBe("Some Tags");
	});

	test("preserves text between tags", () => {
		expect(htmlToText("Before<b>Bold</b>After")).toBe("Before Bold After");
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
