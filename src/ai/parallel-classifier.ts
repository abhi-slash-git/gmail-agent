import { generateObject } from "ai";
import invariant from "tiny-invariant";
import { z } from "zod";
import type { Classifier } from "../database/connection";
import {
	AdaptiveRateLimiter,
	isRateLimitError,
	withRetry
} from "../utils/retry.js";
import { getModel } from "./provider";

// Configuration
const MAX_CONCURRENT = 30; // Maximum concurrent API calls
const MIN_CONCURRENT = 5; // Minimum concurrent API calls
const TIMEOUT_MS = 30000; // 30 second timeout per email

export interface EmailInput {
	id: string;
	subject: string;
	from: string;
	snippet: string;
	body: string;
	date: Date;
}

export interface EmailProgress {
	emailId: string;
	subject: string;
	status: "pending" | "classifying" | "completed" | "failed";
	progress: number; // 0-100
	classifier?: string;
	confidence?: number;
	error?: string;
}

export interface ClassificationResult {
	emailId: string;
	classifierId: string | null;
	confidence: number;
}

export interface UserContext {
	email: string | null;
	name: string | null;
}

export interface ParallelClassifyOptions {
	onEmailProgress?: (progress: EmailProgress) => void;
	onBatchComplete?: (completed: number, total: number) => void;
	userContext?: UserContext;
}

// Dependencies interface for dependency injection (useful for testing)
export interface ClassifierDependencies {
	generateObject: typeof generateObject;
	getModel: typeof getModel;
	withRetry: typeof withRetry;
	isRateLimitError: typeof isRateLimitError;
	createRateLimiter: () => AdaptiveRateLimiter;
}

// Default dependencies using actual implementations
const defaultDependencies: ClassifierDependencies = {
	createRateLimiter: () =>
		new AdaptiveRateLimiter({
			initialConcurrency: MAX_CONCURRENT,
			maxConcurrency: MAX_CONCURRENT,
			minConcurrency: MIN_CONCURRENT,
			successThreshold: 10
		}),
	generateObject,
	getModel,
	isRateLimitError,
	withRetry
};

// Simplified schema - just return the best match
const ClassificationSchema = z.object({
	classifierId: z
		.string()
		.nullable()
		.describe(
			"The ID of the best matching classifier, or null if no good match"
		),
	confidence: z
		.number()
		.min(0)
		.max(1)
		.default(0)
		.describe("Confidence score between 0 and 1 (0 if no match)")
});

async function classifyEmail(
	email: EmailInput,
	classifiers: Classifier[],
	classifierDescriptions: string,
	classifierIds: Set<string>,
	rateLimiter: AdaptiveRateLimiter,
	deps: ClassifierDependencies,
	onProgress?: (progress: EmailProgress) => void,
	userContext?: UserContext
): Promise<ClassificationResult> {
	const emailId = email.id;
	const subject = email.subject || "(no subject)";

	// Report initial progress
	onProgress?.({
		emailId,
		progress: 10,
		status: "classifying",
		subject
	});

	try {
		// Prepare email content - truncate to avoid token limits
		const bodyContent = (email.body || email.snippet || "").slice(0, 2000);
		const emailContent = `From: ${email.from}
Subject: ${subject}
Date: ${email.date.toISOString()}

${bodyContent}`.trim();

		// Report progress - waiting for AI
		onProgress?.({
			emailId,
			progress: 50,
			status: "classifying",
			subject
		});

		// Build user context section if available
		const userContextSection = userContext?.email
			? `\nRecipient context:
- Email: ${userContext.email}
- Name: ${userContext.name || "Unknown"}

Use this context to better understand which emails are addressed TO the user vs FROM others, and to interpret personal/work relevance.
`
			: "";

		// Create classification with retry and timeout
		const { result, attempts } = await deps.withRetry(
			async () => {
				const classificationPromise = await deps.generateObject({
					messages: [
						{
							content: `Classify this email into one of the provided categories. Pick the BEST matching classifier from the list below, or return null if none match well.
${userContextSection}
Available classifiers:
${classifierDescriptions}

Email to classify:
${emailContent}

Instructions:
- Return the classifierId of the best match (must be an exact ID from above) and your confidence (0-1)
- Return null for classifierId if no classifier matches with >0.5 confidence
- Consider the email's purpose, sender, and content when matching
- Match based on the intent and topic, not just keywords`,
							role: "user"
						}
					],
					model: deps.getModel("haiku"),
					schema: ClassificationSchema,
					system:
						"You are an email classifier. Analyze the email and return the best matching classifierId from the provided list, or null if no good match. Only use exact classifier IDs from the list. Be thoughtful about the email's purpose and relevance to each classifier."
				});

				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error("Classification timeout")),
						TIMEOUT_MS
					);
				});

				return Promise.race([classificationPromise, timeoutPromise]);
			},
			{
				maxRetries: 3,
				onRetry: (_attempt, _delayMs, error) => {
					const rateLimit = deps.isRateLimitError(error);
					rateLimiter.recordError(rateLimit);
				}
			}
		);

		// Record success for adaptive rate limiting
		if (attempts === 1) {
			rateLimiter.recordSuccess();
		}

		// Extract and validate result
		const { classifierId, confidence } = result.object;

		// Validate classifierId exists in our list
		const validClassifierId =
			classifierId && classifierIds.has(classifierId) ? classifierId : null;
		const validConfidence = validClassifierId
			? Math.min(1, Math.max(0, confidence))
			: 0;

		// Find classifier for progress reporting
		const classifier = validClassifierId
			? classifiers.find((c) => c.id === validClassifierId)
			: null;

		// Report completion
		onProgress?.({
			classifier: classifier?.name,
			confidence: validConfidence,
			emailId,
			progress: 100,
			status: "completed",
			subject
		});

		return {
			classifierId: validClassifierId,
			confidence: validConfidence,
			emailId
		};
	} catch (_error) {
		// On error, return no classification instead of failing
		// This ensures the email can be retried later
		onProgress?.({
			emailId,
			progress: 100,
			status: "completed",
			subject
		});

		return {
			classifierId: null,
			confidence: 0,
			emailId
		};
	}
}

export async function classifyEmailsParallel(
	emails: EmailInput[],
	classifiers: Classifier[],
	options?: ParallelClassifyOptions,
	deps: ClassifierDependencies = defaultDependencies
): Promise<ClassificationResult[]> {
	if (emails.length === 0 || classifiers.length === 0) {
		return [];
	}

	// Prepare classifier descriptions and IDs for validation
	const classifierDescriptions = classifiers
		.map(
			(c) =>
				`ID: ${c.id}\nName: ${c.name}\nDescription: ${c.description}\nLabel: ${c.labelName}`
		)
		.join("\n\n");

	const classifierIds = new Set(classifiers.map((c) => c.id));

	// Create adaptive rate limiter
	const rateLimiter = deps.createRateLimiter();

	// Initialize progress for all emails
	emails.forEach((email) => {
		options?.onEmailProgress?.({
			emailId: email.id,
			progress: 0,
			status: "pending",
			subject: email.subject || "(no subject)"
		});
	});

	// Process emails with adaptive concurrency
	const results: ClassificationResult[] = [];
	const emailQueue = [...emails];
	const inProgress = new Set<Promise<void>>();

	while (emailQueue.length > 0 || inProgress.size > 0) {
		// Get current concurrency limit from rate limiter
		const currentLimit = rateLimiter.getConcurrency();

		// Start new tasks up to the adaptive concurrency limit
		while (emailQueue.length > 0 && inProgress.size < currentLimit) {
			const email = emailQueue.shift();
			invariant(email, "Email queue should not be empty");

			const task = classifyEmail(
				email,
				classifiers,
				classifierDescriptions,
				classifierIds,
				rateLimiter,
				deps,
				options?.onEmailProgress,
				options?.userContext
			).then((result) => {
				results.push(result);
				options?.onBatchComplete?.(results.length, emails.length);
			});

			const trackingPromise = task.finally(() => {
				inProgress.delete(trackingPromise);
			});

			inProgress.add(trackingPromise);
		}

		// Wait for at least one task to complete
		if (inProgress.size > 0) {
			await Promise.race(inProgress);
		}
	}

	return results;
}
