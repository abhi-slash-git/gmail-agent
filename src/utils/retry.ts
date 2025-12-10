// Retry configuration defaults
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000; // 1 second
const DEFAULT_MAX_BACKOFF_MS = 30000; // 30 seconds
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_JITTER_MS = 500;

// Common rate limit detection
const RATE_LIMIT_CODES = [429, 403, 503];
const RATE_LIMIT_MESSAGES = [
	"quota",
	"rate limit",
	"too many requests",
	"resource exhausted"
];

export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Initial backoff delay in ms (default: 1000) */
	initialBackoffMs?: number;
	/** Maximum backoff delay in ms (default: 30000) */
	maxBackoffMs?: number;
	/** Backoff multiplier for exponential growth (default: 2) */
	backoffMultiplier?: number;
	/** Random jitter range in ms to prevent thundering herd (default: 500) */
	jitterMs?: number;
	/** Custom function to determine if error is retryable (default: checks rate limits) */
	isRetryable?: (error: unknown) => boolean;
	/** Callback called before each retry with attempt number and delay */
	onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
	/** Custom function to determine if error is a rate limit (for logging/metrics) */
	isRateLimit?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
	result: T;
	attempts: number;
	totalDelayMs: number;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (RATE_LIMIT_MESSAGES.some((m) => message.includes(m))) {
			return true;
		}
	}

	// Check for HTTP status codes (common in API client errors)
	const err = error as { code?: number; status?: number; statusCode?: number };
	const code = err.code ?? err.status ?? err.statusCode;
	if (code && RATE_LIMIT_CODES.includes(code)) {
		return true;
	}

	return false;
}

/**
 * Default retryable check - retry on rate limits and transient errors
 */
function defaultIsRetryable(error: unknown): boolean {
	// Always retry rate limits
	if (isRateLimitError(error)) {
		return true;
	}

	// Retry on network errors
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		const networkErrors = [
			"network",
			"timeout",
			"econnreset",
			"econnrefused",
			"socket hang up"
		];
		if (networkErrors.some((e) => message.includes(e))) {
			return true;
		}
	}

	// Check for retryable HTTP codes
	const err = error as { code?: number; status?: number; statusCode?: number };
	const code = err.code ?? err.status ?? err.statusCode;
	if (code) {
		// Retry on server errors and rate limits
		const retryableCodes = [429, 500, 502, 503, 504];
		return retryableCodes.includes(code);
	}

	return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with exponential growth and jitter
 */
function calculateBackoff(
	attempt: number,
	initialMs: number,
	maxMs: number,
	multiplier: number,
	jitterMs: number
): number {
	const exponentialDelay = initialMs * multiplier ** (attempt - 1);
	const cappedDelay = Math.min(exponentialDelay, maxMs);
	const jitter = Math.random() * jitterMs;
	return cappedDelay + jitter;
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @example
 * // Basic usage
 * const result = await withRetry(() => fetchData());
 *
 * @example
 * // With custom options
 * const result = await withRetry(
 *   () => apiCall(),
 *   {
 *     maxRetries: 5,
 *     initialBackoffMs: 500,
 *     onRetry: (attempt, delay) => console.log(`Retry ${attempt} after ${delay}ms`)
 *   }
 * );
 *
 * @example
 * // With custom retry condition
 * const result = await withRetry(
 *   () => riskyOperation(),
 *   {
 *     isRetryable: (error) => error instanceof TransientError
 *   }
 * );
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<RetryResult<T>> {
	const {
		maxRetries = DEFAULT_MAX_RETRIES,
		initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
		maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
		backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
		jitterMs = DEFAULT_JITTER_MS,
		isRetryable = defaultIsRetryable,
		onRetry
	} = options;

	let attempts = 0;
	let totalDelayMs = 0;

	while (true) {
		attempts++;

		try {
			const result = await fn();
			return { attempts, result, totalDelayMs };
		} catch (error) {
			const canRetry = attempts <= maxRetries && isRetryable(error);

			if (!canRetry) {
				throw error;
			}

			const delayMs = calculateBackoff(
				attempts,
				initialBackoffMs,
				maxBackoffMs,
				backoffMultiplier,
				jitterMs
			);

			onRetry?.(attempts, delayMs, error);

			totalDelayMs += delayMs;
			await sleep(delayMs);
		}
	}
}

/**
 * Create a retryable version of an async function
 *
 * @example
 * const fetchWithRetry = createRetryable(fetchData, { maxRetries: 5 });
 * const result = await fetchWithRetry();
 */
export function createRetryable<TArgs extends unknown[], TResult>(
	fn: (...args: TArgs) => Promise<TResult>,
	options: RetryOptions = {}
): (...args: TArgs) => Promise<RetryResult<TResult>> {
	return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Adaptive rate limiter that adjusts concurrency based on success/failure
 */
export class AdaptiveRateLimiter {
	private currentConcurrency: number;
	private minConcurrency: number;
	private maxConcurrency: number;
	private consecutiveSuccesses = 0;
	private consecutiveErrors = 0;
	private successThreshold: number;

	constructor(
		options: {
			initialConcurrency?: number;
			minConcurrency?: number;
			maxConcurrency?: number;
			successThreshold?: number;
		} = {}
	) {
		this.maxConcurrency = options.maxConcurrency ?? 50;
		this.minConcurrency = options.minConcurrency ?? 5;
		this.currentConcurrency = options.initialConcurrency ?? this.maxConcurrency;
		this.successThreshold = options.successThreshold ?? 20;
	}

	getConcurrency(): number {
		return this.currentConcurrency;
	}

	recordSuccess(): void {
		this.consecutiveSuccesses++;
		this.consecutiveErrors = 0;

		// Gradually increase concurrency after sustained success
		if (
			this.consecutiveSuccesses >= this.successThreshold &&
			this.currentConcurrency < this.maxConcurrency
		) {
			this.currentConcurrency = Math.min(
				this.currentConcurrency + 5,
				this.maxConcurrency
			);
			this.consecutiveSuccesses = 0;
		}
	}

	recordError(isRateLimit: boolean): void {
		this.consecutiveErrors++;
		this.consecutiveSuccesses = 0;

		if (isRateLimit) {
			// Aggressive reduction on rate limit
			this.currentConcurrency = Math.max(
				Math.floor(this.currentConcurrency / 2),
				this.minConcurrency
			);
		} else if (this.consecutiveErrors >= 3) {
			// Moderate reduction on other errors
			this.currentConcurrency = Math.max(
				this.currentConcurrency - 5,
				this.minConcurrency
			);
		}
	}

	reset(): void {
		this.currentConcurrency = this.maxConcurrency;
		this.consecutiveSuccesses = 0;
		this.consecutiveErrors = 0;
	}
}
