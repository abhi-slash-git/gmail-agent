import { type gmail_v1, google } from "googleapis";
import invariant from "tiny-invariant";
import {
	AdaptiveRateLimiter,
	isRateLimitError,
	withRetry
} from "../utils/retry.js";
import type { Email } from "./client";
import { htmlToText } from "./html-to-text.js";

// Configuration - Optimized for Gmail API limits
// Per user: 15,000 quota units/min, messages.get = 5 units = 3,000 gets/min = 50/sec
const MAX_CONCURRENT_FETCHES = 50; // Gmail allows ~50 requests/sec per user
const MIN_CONCURRENT_FETCHES = 5; // Minimum when rate limited
const PAGE_SIZE = 500; // Gmail max - fewer API calls for listing
const CHUNK_SIZE = 250; // Larger chunks for better throughput

export interface SyncProgress {
	stage: "listing" | "fetching" | "saving" | "complete";
	totalMessages: number;
	messagesListed: number;
	messagesFetched: number;
	messagesSaved: number;
	currentPage: number;
	totalPages: number;
	startTime: number;
	errors: string[];
	currentConcurrency?: number;
	retryCount?: number;
}

export interface SyncOptions {
	maxResults?: number;
	query?: string;
	labelIds?: string[];
	onProgress?: (progress: SyncProgress) => void;
	syncAll?: boolean; // Sync all emails from beginning of time
	afterDate?: Date; // Sync emails after this date (for incremental sync)
}

export interface SyncResult {
	totalFetched: number;
	totalSaved: number;
	errors: string[];
	elapsedMs: number;
}

export class ParallelGmailSync {
	private gmail: gmail_v1.Gmail;
	private progress: SyncProgress;
	private rateLimiter: AdaptiveRateLimiter;

	constructor(accessToken: string) {
		const auth = new google.auth.OAuth2();
		auth.setCredentials({ access_token: accessToken });
		this.gmail = google.gmail({ auth, version: "v1" });

		this.rateLimiter = new AdaptiveRateLimiter({
			initialConcurrency: MAX_CONCURRENT_FETCHES,
			maxConcurrency: MAX_CONCURRENT_FETCHES,
			minConcurrency: MIN_CONCURRENT_FETCHES
		});

		this.progress = {
			currentConcurrency: this.rateLimiter.getConcurrency(),
			currentPage: 0,
			errors: [],
			messagesFetched: 0,
			messagesListed: 0,
			messagesSaved: 0,
			retryCount: 0,
			stage: "listing",
			startTime: Date.now(),
			totalMessages: 0,
			totalPages: 0
		};
	}

	async syncEmails(options: SyncOptions = {}): Promise<{
		emails: (Omit<Email, "id" | "threadId"> & {
			gmailId: string;
			threadId: string;
		})[];
		progress: SyncProgress;
	}> {
		this.progress.startTime = Date.now();
		const emails: (Omit<Email, "id" | "threadId"> & {
			gmailId: string;
			threadId: string;
		})[] = [];

		try {
			// Step 1: List all message IDs with pagination
			const messageIds = await this.listAllMessageIds(options);

			if (messageIds.length === 0) {
				this.progress.stage = "complete";
				options.onProgress?.(this.progress);
				return { emails, progress: this.progress };
			}

			// Step 2: Fetch full email details in parallel
			this.progress.stage = "fetching";
			this.progress.totalMessages = messageIds.length;
			options.onProgress?.(this.progress);

			// Process messages in chunks for better memory management
			for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
				const chunk = messageIds.slice(i, i + CHUNK_SIZE);
				const chunkEmails = await this.fetchEmailsParallel(chunk, options, i);
				emails.push(...chunkEmails);
			}

			this.progress.stage = "complete";
			options.onProgress?.(this.progress);
		} catch (error) {
			this.progress.errors.push(
				error instanceof Error ? error.message : String(error)
			);
			options.onProgress?.(this.progress);
		}

		return { emails, progress: this.progress };
	}

	private async listAllMessageIds(options: SyncOptions): Promise<string[]> {
		const messageIds: string[] = [];
		let pageToken: string | undefined;
		let pageCount = 0;

		// Build query
		let query = options.query || "";
		if (options.afterDate) {
			// Use provided afterDate for incremental sync
			const dateQuery = `after:${Math.floor(options.afterDate.getTime() / 1000)}`;
			query = query ? `${query} ${dateQuery}` : dateQuery;
		} else if (!options.syncAll) {
			// Default to last 30 days if not syncing all
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
			const dateQuery = `after:${Math.floor(thirtyDaysAgo.getTime() / 1000)}`;
			query = query ? `${query} ${dateQuery}` : dateQuery;
		}

		// Estimate total pages (we'll update this as we go)
		const maxToFetch = options.maxResults || (options.syncAll ? 10000 : 500);
		this.progress.totalPages = Math.ceil(maxToFetch / PAGE_SIZE);

		do {
			pageCount++;
			this.progress.currentPage = pageCount;
			this.progress.stage = "listing";
			options.onProgress?.(this.progress);

			try {
				const { result, attempts } = await withRetry(
					() =>
						this.gmail.users.messages.list({
							labelIds: options.labelIds,
							maxResults: Math.min(PAGE_SIZE, maxToFetch - messageIds.length),
							pageToken,
							q: query,
							userId: "me"
						}),
					{
						maxRetries: 3,
						onRetry: (_attempt, _delayMs, error) => {
							this.progress.retryCount = (this.progress.retryCount || 0) + 1;
							const rateLimit = isRateLimitError(error);
							this.rateLimiter.recordError(rateLimit);
							this.progress.currentConcurrency =
								this.rateLimiter.getConcurrency();
							options.onProgress?.(this.progress);
						}
					}
				);

				if (attempts === 1) {
					this.rateLimiter.recordSuccess();
				}

				const messages = result.data.messages || [];
				for (const msg of messages) {
					if (msg.id) {
						messageIds.push(msg.id);
					}
				}

				this.progress.messagesListed = messageIds.length;
				options.onProgress?.(this.progress);

				pageToken = result.data.nextPageToken || undefined;
			} catch (error) {
				const errorMsg = `Failed to list messages on page ${pageCount}: ${error instanceof Error ? error.message : String(error)}`;
				this.progress.errors.push(errorMsg);
				return messageIds; // Return what we have so far
			}

			// Stop if we've reached the desired count
			if (messageIds.length >= maxToFetch) {
				break;
			}

			// Update total pages estimate if we're still going
			if (pageToken && pageCount >= this.progress.totalPages) {
				this.progress.totalPages = pageCount + 1;
			}
		} while (pageToken);

		return messageIds;
	}

	private async fetchEmailsParallel(
		messageIds: string[],
		options: SyncOptions,
		baseOffset = 0
	): Promise<
		(Omit<Email, "id" | "threadId"> & { gmailId: string; threadId: string })[]
	> {
		const emails: (Omit<Email, "id" | "threadId"> & {
			gmailId: string;
			threadId: string;
		})[] = [];
		const queue = [...messageIds];
		const inProgress = new Set<Promise<void>>();
		let completed = 0;

		while (queue.length > 0 || inProgress.size > 0) {
			// Start new fetches up to the current concurrency limit (adaptive)
			const currentLimit = this.rateLimiter.getConcurrency();
			while (queue.length > 0 && inProgress.size < currentLimit) {
				const messageId = queue.shift();
				invariant(messageId, "Queue should not be empty");

				const fetchPromise = this.fetchEmailWithRetry(messageId, options)
					.then((email) => {
						if (email) {
							emails.push(email);
						}
						completed++;
						// Update progress in real-time
						this.progress.messagesFetched = baseOffset + completed;
						this.progress.currentConcurrency =
							this.rateLimiter.getConcurrency();
						options.onProgress?.(this.progress);
					})
					.catch((error) => {
						completed++;
						const errorMsg = `Failed to fetch email ${messageId}: ${error instanceof Error ? error.message : String(error)}`;
						this.progress.errors.push(errorMsg);
						this.progress.messagesFetched = baseOffset + completed;
						options.onProgress?.(this.progress);
					});

				const trackingPromise = fetchPromise.finally(() => {
					inProgress.delete(trackingPromise);
				});

				inProgress.add(trackingPromise);
			}

			// Wait for at least one fetch to complete
			if (inProgress.size > 0) {
				await Promise.race(inProgress);
			}
		}

		return emails;
	}

	private async fetchEmailWithRetry(
		messageId: string,
		options: SyncOptions
	): Promise<
		Omit<Email, "id" | "threadId"> & { gmailId: string; threadId: string }
	> {
		const { result, attempts } = await withRetry(
			() => this.fetchEmail(messageId),
			{
				maxRetries: 3,
				onRetry: (_attempt, _delayMs, error) => {
					this.progress.retryCount = (this.progress.retryCount || 0) + 1;
					const rateLimit = isRateLimitError(error);
					this.rateLimiter.recordError(rateLimit);
					this.progress.currentConcurrency = this.rateLimiter.getConcurrency();
					options.onProgress?.(this.progress);
				}
			}
		);

		if (attempts === 1) {
			this.rateLimiter.recordSuccess();
		}

		return result;
	}

	private async fetchEmail(
		messageId: string
	): Promise<
		Omit<Email, "id" | "threadId"> & { gmailId: string; threadId: string }
	> {
		const response = await this.gmail.users.messages.get({
			format: "full",
			id: messageId,
			userId: "me"
		});

		const message = response.data;
		const headers = message.payload?.headers || [];

		const getHeader = (name: string) =>
			headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
				?.value || "";

		invariant(message.id, "Message ID should exist");
		invariant(message.threadId, "Thread ID should exist");

		return {
			body: this.extractBody(message.payload),
			date: new Date(getHeader("date") || Date.now()),
			from: getHeader("from"),
			gmailId: message.id,
			labels: message.labelIds || [],
			snippet: message.snippet || "",
			subject: getHeader("subject"),
			threadId: message.threadId,
			to: getHeader("to")
		};
	}

	private extractBody(
		payload: gmail_v1.Schema$MessagePart | null | undefined
	): string {
		if (!payload) return "";

		// Single part message
		if (payload.body?.data) {
			return Buffer.from(payload.body.data, "base64").toString("utf-8");
		}

		// Multipart message - prefer text/plain, fallback to text/html
		if (payload.parts) {
			let textBody = "";
			let htmlBody = "";

			for (const part of payload.parts) {
				if (part.mimeType === "text/plain" && part.body?.data) {
					textBody = Buffer.from(part.body.data, "base64").toString("utf-8");
				} else if (part.mimeType === "text/html" && part.body?.data) {
					htmlBody = Buffer.from(part.body.data, "base64").toString("utf-8");
				} else if (part.parts) {
					// Recursive for nested parts
					const nestedBody = this.extractBody(part);
					if (nestedBody && !textBody) {
						textBody = nestedBody;
					}
				}
			}

			// Prefer plain text over HTML
			if (textBody) return textBody;
			if (htmlBody) {
				return htmlToText(htmlBody);
			}
		}

		return "";
	}

	getProgress(): SyncProgress {
		return { ...this.progress };
	}
}
