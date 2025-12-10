import { describe, expect, mock, test } from "bun:test";

// Mock the AI SDK
mock.module("ai", () => ({
	generateObject: mock(async () => ({
		object: {
			description:
				"Job-related emails including applications, recruiter outreach, and interview scheduling",
			labelName: "Jobs",
			name: "Jobs",
			priority: 7
		}
	}))
}));

// Mock the provider
mock.module("./provider.js", () => ({
	getModel: mock(() => "mock-model")
}));

// Mock retry
mock.module("../utils/retry.js", () => ({
	withRetry: mock(async (fn: () => Promise<unknown>) => ({
		attempts: 1,
		result: await fn(),
		totalDelayMs: 0
	}))
}));

describe("generateClassifierFromPrompt", () => {
	test("generates classifier from natural language prompt", async () => {
		const { generateClassifierFromPrompt } = await import(
			"./classifier-generator"
		);

		const result = await generateClassifierFromPrompt(
			"I want to categorize job-related emails"
		);

		expect(result.name).toBe("Jobs");
		expect(result.labelName).toBe("Jobs");
		expect(result.description).toContain("Job-related");
		expect(result.priority).toBe(7);
	});

	test("returns properly typed GeneratedClassifier", async () => {
		const { generateClassifierFromPrompt } = await import(
			"./classifier-generator"
		);

		const result = await generateClassifierFromPrompt("test prompt");

		expect(typeof result.name).toBe("string");
		expect(typeof result.description).toBe("string");
		expect(typeof result.labelName).toBe("string");
		expect(typeof result.priority).toBe("number");
	});

	test("uses haiku model for generation", async () => {
		const { getModel } = await import("./provider.js");
		const { generateClassifierFromPrompt } = await import(
			"./classifier-generator"
		);

		await generateClassifierFromPrompt("test");

		expect(getModel).toHaveBeenCalledWith("haiku");
	});

	test("uses retry with maxRetries 3", async () => {
		const { withRetry } = await import("../utils/retry.js");
		const { generateClassifierFromPrompt } = await import(
			"./classifier-generator"
		);

		await generateClassifierFromPrompt("test");

		expect(withRetry).toHaveBeenCalledWith(expect.any(Function), {
			maxRetries: 3
		});
	});
});
