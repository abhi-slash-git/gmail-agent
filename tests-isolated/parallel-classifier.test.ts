import { beforeEach, describe, expect, test } from "bun:test";
import {
	type ClassifierDependencies,
	classifyEmailsParallel,
	type EmailInput
} from "../src/ai/parallel-classifier";
import type { Classifier } from "../src/database/connection";

// Test helpers
const createTestEmail = (id: string, subject: string): EmailInput => ({
	body: "Test email body",
	date: new Date(),
	from: "sender@test.com",
	id,
	snippet: "Test snippet",
	subject
});

const createTestClassifier = (
	id: string,
	name: string,
	labelName: string
): Classifier => ({
	createdAt: new Date(),
	description: `${name} emails`,
	enabled: true,
	id,
	labelName,
	name,
	priority: 0,
	updatedAt: new Date(),
	userId: "test_user"
});

// Mock dependencies factory
function createMockDeps(overrides?: {
	generateObjectResult?: { classifierId: string | null; confidence: number };
	generateObjectError?: Error;
	recordError?: () => void;
}): ClassifierDependencies {
	const recordError = overrides?.recordError ?? (() => {});

	return {
		createRateLimiter: () => ({
			getConcurrency: () => 30,
			recordError,
			recordSuccess: () => {},
			reset: () => {}
		}),
		generateObject: (() => {
			if (overrides?.generateObjectError) {
				return Promise.reject(overrides.generateObjectError);
			}
			return Promise.resolve({
				object: overrides?.generateObjectResult ?? {
					classifierId: "clf_work",
					confidence: 0.9
				}
			});
		}) as ClassifierDependencies["generateObject"],
		getModel: (() => "mock-model") as ClassifierDependencies["getModel"],
		isRateLimitError: (error: unknown) =>
			error instanceof Error && error.message.includes("rate limit"),
		withRetry: async (fn, _options) => ({
			attempts: 1,
			result: await fn(),
			totalDelayMs: 0
		})
	};
}

describe("classifyEmailsParallel", () => {
	let mockDeps: ClassifierDependencies;

	beforeEach(() => {
		mockDeps = createMockDeps();
	});

	test("returns empty array for empty inputs", async () => {
		const results = await classifyEmailsParallel([], [], undefined, mockDeps);
		expect(results).toEqual([]);
	});

	test("returns empty array when no emails", async () => {
		const classifiers = [createTestClassifier("clf_1", "Work", "Work")];
		const results = await classifyEmailsParallel(
			[],
			classifiers,
			undefined,
			mockDeps
		);
		expect(results).toEqual([]);
	});

	test("returns empty array when no classifiers", async () => {
		const emails = [createTestEmail("email1", "Test Email")];
		const results = await classifyEmailsParallel(
			emails,
			[],
			undefined,
			mockDeps
		);
		expect(results).toEqual([]);
	});

	test("classifies emails with matching classifier", async () => {
		mockDeps = createMockDeps({
			generateObjectResult: { classifierId: "clf_work", confidence: 0.85 }
		});

		const emails = [createTestEmail("email1", "Project Update")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results).toHaveLength(1);
		expect(results[0]?.emailId).toBe("email1");
		expect(results[0]?.classifierId).toBe("clf_work");
		expect(results[0]?.confidence).toBe(0.85);
	});

	test("returns null classifierId for unmatched emails", async () => {
		mockDeps = createMockDeps({
			generateObjectResult: { classifierId: null, confidence: 0 }
		});

		const emails = [createTestEmail("email1", "Random Email")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results).toHaveLength(1);
		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("validates classifierId against provided classifiers", async () => {
		mockDeps = createMockDeps({
			generateObjectResult: { classifierId: "clf_invalid", confidence: 0.9 }
		});

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("calls onEmailProgress callback", async () => {
		const progressUpdates: Array<{
			emailId: string;
			status: string;
			progress: number;
		}> = [];

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(
			emails,
			classifiers,
			{
				onEmailProgress: (progress) => {
					progressUpdates.push({
						emailId: progress.emailId,
						progress: progress.progress,
						status: progress.status
					});
				}
			},
			mockDeps
		);

		expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
		expect(progressUpdates.some((p) => p.status === "pending")).toBe(true);
		expect(progressUpdates.some((p) => p.status === "completed")).toBe(true);
	});

	test("calls onBatchComplete callback", async () => {
		const batchUpdates: Array<{ completed: number; total: number }> = [];

		const emails = [
			createTestEmail("email1", "Test 1"),
			createTestEmail("email2", "Test 2")
		];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(
			emails,
			classifiers,
			{
				onBatchComplete: (completed, total) => {
					batchUpdates.push({ completed, total });
				}
			},
			mockDeps
		);

		expect(batchUpdates.length).toBeGreaterThan(0);
		const lastUpdate = batchUpdates[batchUpdates.length - 1];
		expect(lastUpdate?.completed).toBe(2);
		expect(lastUpdate?.total).toBe(2);
	});

	test("handles API errors gracefully", async () => {
		mockDeps = createMockDeps({
			generateObjectError: new Error("API error")
		});

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results).toHaveLength(1);
		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("includes user context when provided", async () => {
		let capturedMessages: unknown[] = [];

		mockDeps = {
			...createMockDeps(),
			generateObject: ((opts: { messages: unknown[] }) => {
				capturedMessages = opts.messages;
				return Promise.resolve({
					object: { classifierId: "clf_work", confidence: 0.9 }
				});
			}) as ClassifierDependencies["generateObject"]
		};

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(
			emails,
			classifiers,
			{
				userContext: {
					email: "user@example.com",
					name: "Test User"
				}
			},
			mockDeps
		);

		const messageContent = JSON.stringify(capturedMessages);
		expect(messageContent).toContain("user@example.com");
		expect(messageContent).toContain("Test User");
	});

	test("classifies multiple emails in parallel", async () => {
		let callCount = 0;

		mockDeps = {
			...createMockDeps(),
			generateObject: (() => {
				callCount++;
				return Promise.resolve({
					object: { classifierId: "clf_work", confidence: 0.8 }
				});
			}) as ClassifierDependencies["generateObject"]
		};

		const emails = [
			createTestEmail("email1", "Test 1"),
			createTestEmail("email2", "Test 2"),
			createTestEmail("email3", "Test 3")
		];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results).toHaveLength(3);
		expect(callCount).toBe(3);
	});

	test("caps confidence at 1.0", async () => {
		mockDeps = createMockDeps({
			generateObjectResult: { classifierId: "clf_work", confidence: 1.5 }
		});

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results[0]?.confidence).toBe(1.0);
	});

	test("floors confidence at 0", async () => {
		mockDeps = createMockDeps({
			generateObjectResult: { classifierId: "clf_work", confidence: -0.5 }
		});

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(
			emails,
			classifiers,
			undefined,
			mockDeps
		);

		expect(results[0]?.confidence).toBe(0);
	});

	test("calls recordError on rate limit errors during retry", async () => {
		let recordErrorCalled = false;

		const setRecordErrorCalled = () => {
			recordErrorCalled = true;
		};

		mockDeps = {
			...createMockDeps({ recordError: setRecordErrorCalled }),
			withRetry: async (fn, options) => {
				// Simulate a retry scenario
				const rateLimitError = new Error("rate limit exceeded");
				options?.onRetry?.(1, 1000, rateLimitError);
				return {
					attempts: 2,
					result: await fn(),
					totalDelayMs: 1000
				};
			}
		};

		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(emails, classifiers, undefined, mockDeps);

		expect(recordErrorCalled).toBe(true);
	});
});
