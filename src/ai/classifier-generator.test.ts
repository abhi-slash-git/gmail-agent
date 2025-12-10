import { describe, expect, test } from "bun:test";
import {
	type ClassifierGeneratorDependencies,
	generateClassifierFromPrompt
} from "./classifier-generator";

// Mock dependencies factory - no mock.module needed
function createMockDeps(overrides?: {
	generatedClassifier?: {
		name: string;
		description: string;
		labelName: string;
		priority: number;
	};
	getModelCalls?: string[];
	withRetryCalls?: Array<{ maxRetries?: number }>;
}): ClassifierGeneratorDependencies {
	const getModelCalls = overrides?.getModelCalls ?? [];
	const withRetryCalls = overrides?.withRetryCalls ?? [];

	return {
		generateObject: (() =>
			Promise.resolve({
				object: overrides?.generatedClassifier ?? {
					description:
						"Job-related emails including applications, recruiter outreach, and interview scheduling",
					labelName: "Jobs",
					name: "Jobs",
					priority: 7
				}
			})) as unknown as ClassifierGeneratorDependencies["generateObject"],
		getModel: ((model: string) => {
			getModelCalls.push(model);
			return "mock-model";
		}) as unknown as ClassifierGeneratorDependencies["getModel"],
		withRetry: (async (
			fn: () => Promise<unknown>,
			options?: { maxRetries?: number }
		) => {
			withRetryCalls.push({ maxRetries: options?.maxRetries });
			return {
				attempts: 1,
				result: await fn(),
				totalDelayMs: 0
			};
		}) as unknown as ClassifierGeneratorDependencies["withRetry"]
	};
}

describe("generateClassifierFromPrompt", () => {
	test("generates classifier from natural language prompt", async () => {
		const mockDeps = createMockDeps();

		const result = await generateClassifierFromPrompt(
			"I want to categorize job-related emails",
			mockDeps
		);

		expect(result.name).toBe("Jobs");
		expect(result.labelName).toBe("Jobs");
		expect(result.description).toContain("Job-related");
		expect(result.priority).toBe(7);
	});

	test("returns properly typed GeneratedClassifier", async () => {
		const mockDeps = createMockDeps();

		const result = await generateClassifierFromPrompt("test prompt", mockDeps);

		expect(typeof result.name).toBe("string");
		expect(typeof result.description).toBe("string");
		expect(typeof result.labelName).toBe("string");
		expect(typeof result.priority).toBe("number");
	});

	test("uses haiku model for generation", async () => {
		const getModelCalls: string[] = [];
		const mockDeps = createMockDeps({ getModelCalls });

		await generateClassifierFromPrompt("test", mockDeps);

		expect(getModelCalls).toContain("haiku");
	});

	test("uses retry with maxRetries 3", async () => {
		const withRetryCalls: Array<{ maxRetries?: number }> = [];
		const mockDeps = createMockDeps({ withRetryCalls });

		await generateClassifierFromPrompt("test", mockDeps);

		expect(withRetryCalls).toHaveLength(1);
		expect(withRetryCalls[0]?.maxRetries).toBe(3);
	});

	test("passes different classifier data correctly", async () => {
		const mockDeps = createMockDeps({
			generatedClassifier: {
				description: "Newsletter emails from various sources",
				labelName: "Newsletters",
				name: "Newsletters",
				priority: 5
			}
		});

		const result = await generateClassifierFromPrompt(
			"categorize newsletters",
			mockDeps
		);

		expect(result.name).toBe("Newsletters");
		expect(result.labelName).toBe("Newsletters");
		expect(result.priority).toBe(5);
	});
});
