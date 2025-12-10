import { describe, expect, mock, test } from "bun:test";
import {
	AdaptiveRateLimiter,
	createRetryable,
	isRateLimitError,
	withRetry
} from "./retry";

describe("isRateLimitError", () => {
	test("returns true for rate limit status codes", () => {
		expect(isRateLimitError({ status: 429 })).toBe(true);
		expect(isRateLimitError({ status: 403 })).toBe(true);
		expect(isRateLimitError({ status: 503 })).toBe(true);
		expect(isRateLimitError({ code: 429 })).toBe(true);
		expect(isRateLimitError({ statusCode: 429 })).toBe(true);
	});

	test("returns true for rate limit error messages", () => {
		expect(isRateLimitError(new Error("quota exceeded"))).toBe(true);
		expect(isRateLimitError(new Error("Rate limit reached"))).toBe(true);
		expect(isRateLimitError(new Error("Too many requests"))).toBe(true);
		expect(isRateLimitError(new Error("resource exhausted"))).toBe(true);
	});

	test("returns false for non-rate-limit errors", () => {
		expect(isRateLimitError(new Error("Network error"))).toBe(false);
		expect(isRateLimitError({ status: 500 })).toBe(false);
		expect(isRateLimitError({ status: 404 })).toBe(false);
		expect(isRateLimitError(null)).toBe(false);
		expect(isRateLimitError(undefined)).toBe(false);
		expect(isRateLimitError("string error")).toBe(false);
	});
});

describe("withRetry", () => {
	test("returns result on first success", async () => {
		const fn = mock(() => Promise.resolve("success"));
		const result = await withRetry(fn);

		expect(result.result).toBe("success");
		expect(result.attempts).toBe(1);
		expect(result.totalDelayMs).toBe(0);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	test("retries on retryable errors", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 3) {
				return Promise.reject({ status: 429 });
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 5
		});

		expect(result.result).toBe("success");
		expect(result.attempts).toBe(3);
		expect(fn).toHaveBeenCalledTimes(3);
	});

	test("throws after max retries exceeded", async () => {
		const error = { status: 429 };
		const fn = mock(() => Promise.reject(error));

		await expect(
			withRetry(fn, {
				initialBackoffMs: 10,
				jitterMs: 0,
				maxRetries: 2
			})
		).rejects.toEqual(error);

		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	test("does not retry non-retryable errors", async () => {
		const error = new Error("Fatal error");
		const fn = mock(() => Promise.reject(error));

		await expect(withRetry(fn, { maxRetries: 5 })).rejects.toThrow(
			"Fatal error"
		);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	test("calls onRetry callback", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject({ status: 429 });
			}
			return Promise.resolve("success");
		});

		const onRetry = mock(() => {});

		await withRetry(fn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 3,
			onRetry
		});

		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(1, 10, { status: 429 });
	});

	test("uses custom isRetryable function", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject(new Error("custom retryable"));
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			initialBackoffMs: 10,
			isRetryable: (err) =>
				err instanceof Error && err.message === "custom retryable",
			jitterMs: 0,
			maxRetries: 3
		});

		expect(result.result).toBe("success");
		expect(result.attempts).toBe(2);
	});

	test("applies exponential backoff", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 4) {
				return Promise.reject({ status: 429 });
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			backoffMultiplier: 2,
			initialBackoffMs: 1,
			jitterMs: 0,
			maxRetries: 5
		});

		// Delays: 1, 2, 4 = 7ms total
		expect(result.totalDelayMs).toBe(7);
	});

	test("caps backoff at maxBackoffMs", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 4) {
				return Promise.reject({ status: 429 });
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			backoffMultiplier: 10,
			initialBackoffMs: 1,
			jitterMs: 0,
			maxBackoffMs: 5,
			maxRetries: 5
		});

		// Delays: 1, 5 (capped), 5 (capped) = 11ms total
		expect(result.totalDelayMs).toBe(11);
	});

	test("retries network errors", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject(new Error("ECONNRESET"));
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 3
		});

		expect(result.result).toBe("success");
		expect(result.attempts).toBe(2);
	});

	test("retries timeout errors", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject(new Error("timeout"));
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 3
		});

		expect(result.result).toBe("success");
	});

	test("retries server errors (5xx)", async () => {
		let attempts = 0;
		const fn = mock(() => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject({ status: 502 });
			}
			return Promise.resolve("success");
		});

		const result = await withRetry(fn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 3
		});

		expect(result.result).toBe("success");
	});
});

describe("createRetryable", () => {
	test("creates a retryable function wrapper", async () => {
		const originalFn = mock((x: number) => Promise.resolve(x * 2));
		const retryableFn = createRetryable(originalFn, { maxRetries: 3 });

		const result = await retryableFn(5);

		expect(result.result).toBe(10);
		expect(result.attempts).toBe(1);
		expect(originalFn).toHaveBeenCalledWith(5);
	});

	test("retries wrapped function on failure", async () => {
		let attempts = 0;
		const originalFn = mock((x: number) => {
			attempts++;
			if (attempts < 2) {
				return Promise.reject({ status: 429 });
			}
			return Promise.resolve(x * 2);
		});

		const retryableFn = createRetryable(originalFn, {
			initialBackoffMs: 10,
			jitterMs: 0,
			maxRetries: 3
		});

		const result = await retryableFn(5);

		expect(result.result).toBe(10);
		expect(result.attempts).toBe(2);
	});
});

describe("AdaptiveRateLimiter", () => {
	test("initializes with default values", () => {
		const limiter = new AdaptiveRateLimiter();
		expect(limiter.getConcurrency()).toBe(50);
	});

	test("initializes with custom values", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 20,
			maxConcurrency: 100,
			minConcurrency: 5
		});
		expect(limiter.getConcurrency()).toBe(20);
	});

	test("increases concurrency after sustained success", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 20,
			maxConcurrency: 50,
			successThreshold: 5
		});

		// Record 5 successes (threshold)
		for (let i = 0; i < 5; i++) {
			limiter.recordSuccess();
		}

		expect(limiter.getConcurrency()).toBe(25); // increased by 5
	});

	test("does not exceed maxConcurrency", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 48,
			maxConcurrency: 50,
			successThreshold: 2
		});

		limiter.recordSuccess();
		limiter.recordSuccess();

		expect(limiter.getConcurrency()).toBe(50); // capped at max
	});

	test("halves concurrency on rate limit error", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 40,
			minConcurrency: 5
		});

		limiter.recordError(true); // rate limit

		expect(limiter.getConcurrency()).toBe(20); // halved
	});

	test("does not go below minConcurrency on rate limit", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 8,
			minConcurrency: 5
		});

		limiter.recordError(true); // rate limit

		expect(limiter.getConcurrency()).toBe(5); // capped at min
	});

	test("reduces concurrency by 5 after 3 consecutive non-rate-limit errors", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 30,
			minConcurrency: 5
		});

		limiter.recordError(false);
		expect(limiter.getConcurrency()).toBe(30); // no change yet

		limiter.recordError(false);
		expect(limiter.getConcurrency()).toBe(30); // no change yet

		limiter.recordError(false);
		expect(limiter.getConcurrency()).toBe(25); // reduced by 5
	});

	test("resets consecutive counters on success after error", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 30,
			minConcurrency: 5
		});

		limiter.recordError(false);
		limiter.recordError(false);
		limiter.recordSuccess(); // resets consecutive errors
		limiter.recordError(false);
		limiter.recordError(false);

		// Should not reduce because success broke the streak
		expect(limiter.getConcurrency()).toBe(30);
	});

	test("reset() restores initial state", () => {
		const limiter = new AdaptiveRateLimiter({
			initialConcurrency: 40,
			maxConcurrency: 50,
			minConcurrency: 5
		});

		limiter.recordError(true); // halves to 20
		expect(limiter.getConcurrency()).toBe(20);

		limiter.reset();
		expect(limiter.getConcurrency()).toBe(50); // reset to max
	});
});
