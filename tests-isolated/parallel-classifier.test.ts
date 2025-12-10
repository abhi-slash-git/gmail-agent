import { describe, expect, mock, test } from "bun:test";
import type { Classifier } from "../src/database/connection";

// Mock the AI SDK - using any to allow flexible mock implementations
// biome-ignore lint/suspicious/noExplicitAny: mock needs flexible typing
const mockGenerateObject = mock(async (_opts?: any) => ({
	object: {
		classifierId: "clf_work" as string | null,
		confidence: 0.9
	}
}));

mock.module("ai", () => ({
	generateObject: mockGenerateObject
}));

// Mock the provider
mock.module("../src/ai/provider", () => ({
	getModel: mock(() => "mock-model")
}));

// Mock the retry module
const mockWithRetry = mock(
	async (
		fn: () => Promise<unknown>,
		_options?: {
			onRetry?: (attempt: number, delayMs: number, error: Error) => void;
		}
	) => ({
		attempts: 1,
		result: await fn(),
		totalDelayMs: 0
	})
);

const mockRecordError = mock(() => {});

mock.module("../src/utils/retry.js", () => ({
	AdaptiveRateLimiter: class {
		getConcurrency = () => 30;
		recordError = mockRecordError;
		recordSuccess = mock(() => {});
		reset = mock(() => {});
	},
	isRateLimitError: (error: unknown) =>
		error instanceof Error && error.message.includes("rate limit"),
	withRetry: mockWithRetry
}));

interface EmailInput {
	id: string;
	subject: string;
	from: string;
	snippet: string;
	body: string;
	date: Date;
}

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

describe("classifyEmailsParallel", () => {
	test("returns empty array for empty inputs", async () => {
		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const results = await classifyEmailsParallel([], []);
		expect(results).toEqual([]);
	});

	test("returns empty array when no emails", async () => {
		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const classifiers = [createTestClassifier("clf_1", "Work", "Work")];
		const results = await classifyEmailsParallel([], classifiers);
		expect(results).toEqual([]);
	});

	test("returns empty array when no classifiers", async () => {
		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test Email")];
		const results = await classifyEmailsParallel(emails, []);
		expect(results).toEqual([]);
	});

	test("classifies emails with matching classifier", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: 0.85
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Project Update")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results).toHaveLength(1);
		expect(results[0]?.emailId).toBe("email1");
		expect(results[0]?.classifierId).toBe("clf_work");
		expect(results[0]?.confidence).toBe(0.85);
	});

	test("returns null classifierId for unmatched emails", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: null as string | null,
				confidence: 0
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Random Email")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results).toHaveLength(1);
		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("validates classifierId against provided classifiers", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_invalid", // Not in our classifier list
				confidence: 0.9
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("calls onEmailProgress callback", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: 0.9
			}
		}));

		const progressUpdates: Array<{
			emailId: string;
			status: string;
			progress: number;
		}> = [];

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(emails, classifiers, {
			onEmailProgress: (progress) => {
				progressUpdates.push({
					emailId: progress.emailId,
					progress: progress.progress,
					status: progress.status
				});
			}
		});

		// Should have at least pending, classifying, and completed states
		expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
		expect(progressUpdates.some((p) => p.status === "pending")).toBe(true);
		expect(progressUpdates.some((p) => p.status === "completed")).toBe(true);
	});

	test("calls onBatchComplete callback", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: 0.9
			}
		}));

		const batchUpdates: Array<{ completed: number; total: number }> = [];

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [
			createTestEmail("email1", "Test 1"),
			createTestEmail("email2", "Test 2")
		];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(emails, classifiers, {
			onBatchComplete: (completed, total) => {
				batchUpdates.push({ completed, total });
			}
		});

		expect(batchUpdates.length).toBeGreaterThan(0);
		// Final update should show all complete
		const lastUpdate = batchUpdates[batchUpdates.length - 1];
		expect(lastUpdate?.completed).toBe(2);
		expect(lastUpdate?.total).toBe(2);
	});

	test("handles API errors gracefully", async () => {
		mockGenerateObject.mockImplementation(() => {
			throw new Error("API error");
		});

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		// Should not throw, but return no match
		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results).toHaveLength(1);
		expect(results[0]?.classifierId).toBeNull();
		expect(results[0]?.confidence).toBe(0);
	});

	test("includes user context when provided", async () => {
		let capturedMessages: unknown[] = [];

		// biome-ignore lint/suspicious/noExplicitAny: mock needs flexible typing
		mockGenerateObject.mockImplementation((opts: any) => {
			capturedMessages = opts.messages;
			return Promise.resolve({
				object: {
					classifierId: "clf_work",
					confidence: 0.9
				}
			});
		});

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		await classifyEmailsParallel(emails, classifiers, {
			userContext: {
				email: "user@example.com",
				name: "Test User"
			}
		});

		// Check that user context is included in the prompt
		const messageContent = JSON.stringify(capturedMessages);
		expect(messageContent).toContain("user@example.com");
		expect(messageContent).toContain("Test User");
	});

	test("classifies multiple emails in parallel", async () => {
		let callCount = 0;

		mockGenerateObject.mockImplementation(() => {
			callCount++;
			return Promise.resolve({
				object: {
					classifierId: "clf_work",
					confidence: 0.8
				}
			});
		});

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [
			createTestEmail("email1", "Test 1"),
			createTestEmail("email2", "Test 2"),
			createTestEmail("email3", "Test 3")
		];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results).toHaveLength(3);
		expect(callCount).toBe(3);
	});

	test("caps confidence at 1.0", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: 1.5 // Over 1.0
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results[0]?.confidence).toBe(1.0);
	});

	test("floors confidence at 0", async () => {
		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: -0.5 // Below 0
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results[0]?.confidence).toBe(0);
	});

	test("calls onRetry callback and records rate limit errors", async () => {
		// Override withRetry to simulate a retry scenario
		mockWithRetry.mockImplementationOnce(
			async (
				fn: () => Promise<unknown>,
				options?: {
					onRetry?: (attempt: number, delayMs: number, error: Error) => void;
				}
			) => {
				// Simulate a failed first attempt that triggers onRetry
				const rateLimitError = new Error("rate limit exceeded");
				options?.onRetry?.(1, 1000, rateLimitError);

				// Then succeed on retry
				return {
					attempts: 2,
					result: await fn(),
					totalDelayMs: 1000
				};
			}
		);

		mockGenerateObject.mockImplementation(async () => ({
			object: {
				classifierId: "clf_work",
				confidence: 0.9
			}
		}));

		const { classifyEmailsParallel } = await import("../src/ai/parallel-classifier");
		const emails = [createTestEmail("email1", "Test")];
		const classifiers = [createTestClassifier("clf_work", "Work", "Work")];

		const results = await classifyEmailsParallel(emails, classifiers);

		expect(results).toHaveLength(1);
		expect(results[0]?.classifierId).toBe("clf_work");
		// The onRetry was called with a rate limit error, so recordError should have been called
		expect(mockRecordError).toHaveBeenCalled();
	});
});
