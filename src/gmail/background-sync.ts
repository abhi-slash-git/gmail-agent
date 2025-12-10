import { type gmail_v1, google } from "googleapis";
import invariant from "tiny-invariant";
import {
	addToSyncQueue,
	type Database,
	deleteSyncedItems,
	getPendingSyncItems,
	getSyncQueueStats,
	markSyncItemFailed,
	markSyncItemSynced,
	markSyncItemSyncing,
	resetStuckSyncingItems,
	type SyncQueueStats,
	upsertEmails
} from "../database/connection.js";
import type { EmailInsert } from "../database/schema.js";
import {
	AdaptiveRateLimiter,
	isRateLimitError,
	withRetry
} from "../utils/retry.js";

const MAX_CONCURRENT_FETCHES = 50;
const MIN_CONCURRENT_FETCHES = 5;
const PAGE_SIZE = 500;
const BATCH_SIZE = 50;

export interface BackgroundSyncProgress {
	stage: "idle" | "listing" | "syncing" | "complete";
	totalQueued: number;
	totalSynced: number;
	totalFailed: number;
	currentBatch: number;
	errors: string[];
	isRunning: boolean;
}

export interface BackgroundSyncOptions {
	maxResults?: number;
	query?: string;
	labelIds?: string[];
	syncAll?: boolean;
	onProgress?: (progress: BackgroundSyncProgress) => void;
}

export class BackgroundSyncManager {
	private gmail: gmail_v1.Gmail;
	private db: Database;
	readonly userId: string;
	private rateLimiter: AdaptiveRateLimiter;
	private isRunning = false;
	private shouldStop = false;
	private progress: BackgroundSyncProgress;

	constructor(accessToken: string, db: Database, userId: string) {
		const auth = new google.auth.OAuth2();
		auth.setCredentials({ access_token: accessToken });
		this.gmail = google.gmail({ auth, version: "v1" });
		this.db = db;
		this.userId = userId;

		this.rateLimiter = new AdaptiveRateLimiter({
			initialConcurrency: MAX_CONCURRENT_FETCHES,
			maxConcurrency: MAX_CONCURRENT_FETCHES,
			minConcurrency: MIN_CONCURRENT_FETCHES
		});

		this.progress = {
			currentBatch: 0,
			errors: [],
			isRunning: false,
			stage: "idle",
			totalFailed: 0,
			totalQueued: 0,
			totalSynced: 0
		};
	}

	/**
	 * Start a new sync - lists emails and adds them to the queue, then processes
	 */
	async startSync(options: BackgroundSyncOptions = {}): Promise<void> {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;
		this.shouldStop = false;
		this.progress = {
			currentBatch: 0,
			errors: [],
			isRunning: true,
			stage: "listing",
			totalFailed: 0,
			totalQueued: 0,
			totalSynced: 0
		};
		options.onProgress?.(this.progress);

		try {
			// Step 1: List all message IDs and add to queue
			const messageIds = await this.listAndQueueMessages(options);

			if (messageIds.length === 0) {
				this.progress.stage = "complete";
				this.progress.isRunning = false;
				options.onProgress?.(this.progress);
				this.isRunning = false;
				return;
			}

			this.progress.totalQueued = messageIds.length;
			this.progress.stage = "syncing";
			options.onProgress?.(this.progress);

			// Step 2: Process the queue
			await this.processQueue(options);
		} catch (error) {
			this.progress.errors.push(
				error instanceof Error ? error.message : String(error)
			);
			options.onProgress?.(this.progress);
		} finally {
			this.progress.stage = "complete";
			this.progress.isRunning = false;
			options.onProgress?.(this.progress);
			this.isRunning = false;
		}
	}

	/**
	 * Resume syncing from the queue (for startup or background processing)
	 */
	async resumeSync(options: BackgroundSyncOptions = {}): Promise<void> {
		if (this.isRunning) {
			return;
		}

		// Reset any stuck items first
		await resetStuckSyncingItems(this.db, this.userId);

		// Check if there's anything to sync
		const stats = await getSyncQueueStats(this.db, this.userId);
		if (stats.pending === 0) {
			return;
		}

		this.isRunning = true;
		this.shouldStop = false;
		this.progress = {
			currentBatch: 0,
			errors: [],
			isRunning: true,
			stage: "syncing",
			totalFailed: 0,
			totalQueued: stats.pending,
			totalSynced: stats.synced
		};
		options.onProgress?.(this.progress);

		try {
			await this.processQueue(options);
		} catch (error) {
			this.progress.errors.push(
				error instanceof Error ? error.message : String(error)
			);
			options.onProgress?.(this.progress);
		} finally {
			this.progress.stage = "complete";
			this.progress.isRunning = false;
			options.onProgress?.(this.progress);
			this.isRunning = false;
		}
	}

	/**
	 * Stop the sync process gracefully
	 */
	stop(): void {
		this.shouldStop = true;
	}

	/**
	 * Get current sync stats
	 */
	async getStats(): Promise<SyncQueueStats> {
		return await getSyncQueueStats(this.db, this.userId);
	}

	/**
	 * Clean up synced items from the queue
	 */
	async cleanup(): Promise<number> {
		return await deleteSyncedItems(this.db, this.userId);
	}

	getProgress(): BackgroundSyncProgress {
		return { ...this.progress };
	}

	private async listAndQueueMessages(
		options: BackgroundSyncOptions
	): Promise<string[]> {
		const messageIds: string[] = [];
		let pageToken: string | undefined;

		// Build query
		let query = options.query || "";
		if (!options.syncAll) {
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
			const dateQuery = `after:${Math.floor(thirtyDaysAgo.getTime() / 1000)}`;
			query = query ? `${query} ${dateQuery}` : dateQuery;
		}

		const maxToFetch = options.maxResults || (options.syncAll ? 10000 : 500);

		do {
			if (this.shouldStop) break;

			try {
				const { result } = await withRetry(
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
							const rateLimit = isRateLimitError(error);
							this.rateLimiter.recordError(rateLimit);
						}
					}
				);

				this.rateLimiter.recordSuccess();

				const messages = result.data.messages || [];
				for (const msg of messages) {
					if (msg.id) {
						messageIds.push(msg.id);
					}
				}

				pageToken = result.data.nextPageToken || undefined;

				// Add to queue in batches as we list
				if (messageIds.length >= 100 || !pageToken) {
					await addToSyncQueue(this.db, this.userId, messageIds);
					this.progress.totalQueued += messageIds.length;
					options.onProgress?.(this.progress);
				}
			} catch (error) {
				this.progress.errors.push(
					`Failed to list messages: ${error instanceof Error ? error.message : String(error)}`
				);
				break;
			}

			if (messageIds.length >= maxToFetch) {
				break;
			}
		} while (pageToken);

		// Add any remaining to queue
		if (messageIds.length > 0) {
			await addToSyncQueue(this.db, this.userId, messageIds);
		}

		return messageIds;
	}

	private async processQueue(options: BackgroundSyncOptions): Promise<void> {
		let batchNumber = 0;

		while (!this.shouldStop) {
			// Get pending items from queue
			const items = await getPendingSyncItems(this.db, this.userId, BATCH_SIZE);

			if (items.length === 0) {
				break;
			}

			batchNumber++;
			this.progress.currentBatch = batchNumber;
			options.onProgress?.(this.progress);

			// Mark items as syncing
			await markSyncItemSyncing(
				this.db,
				items.map((i) => i.id)
			);

			// Fetch emails in parallel with adaptive rate limiting
			const emails: EmailInsert[] = [];
			const queue = [...items];
			const inProgress = new Set<Promise<void>>();

			while (queue.length > 0 || inProgress.size > 0) {
				if (this.shouldStop) break;

				const currentLimit = this.rateLimiter.getConcurrency();
				while (queue.length > 0 && inProgress.size < currentLimit) {
					const item = queue.shift();
					invariant(item, "Queue should not be empty");

					const fetchPromise = this.fetchAndProcessEmail(item.gmailId, options)
						.then(async (emailData) => {
							if (emailData) {
								emails.push(emailData);
								await markSyncItemSynced(this.db, item.gmailId, this.userId);
								this.progress.totalSynced++;
							}
							options.onProgress?.(this.progress);
						})
						.catch(async (error) => {
							const errorMsg =
								error instanceof Error ? error.message : String(error);
							const { deleted, retryCount } = await markSyncItemFailed(
								this.db,
								item.gmailId,
								this.userId,
								errorMsg
							);

							if (deleted) {
								this.progress.totalFailed++;
								this.progress.errors.push(
									`Email ${item.gmailId} failed after ${retryCount} retries: ${errorMsg}`
								);
							}
							options.onProgress?.(this.progress);
						});

					const trackingPromise = fetchPromise.finally(() => {
						inProgress.delete(trackingPromise);
					});

					inProgress.add(trackingPromise);
				}

				if (inProgress.size > 0) {
					await Promise.race(inProgress);
				}
			}

			// Save fetched emails to database
			if (emails.length > 0) {
				await upsertEmails(this.db, emails);
			}
		}
	}

	private async fetchAndProcessEmail(
		gmailId: string,
		_options: BackgroundSyncOptions
	): Promise<EmailInsert | null> {
		const { result, attempts } = await withRetry(
			() =>
				this.gmail.users.messages.get({
					format: "full",
					id: gmailId,
					userId: "me"
				}),
			{
				maxRetries: 3,
				onRetry: (_attempt, _delayMs, error) => {
					const rateLimit = isRateLimitError(error);
					this.rateLimiter.recordError(rateLimit);
				}
			}
		);

		if (attempts === 1) {
			this.rateLimiter.recordSuccess();
		}

		const message = result.data;
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
			to: getHeader("to"),
			userId: this.userId
		};
	}

	private extractBody(
		payload: gmail_v1.Schema$MessagePart | null | undefined
	): string {
		if (!payload) return "";

		if (payload.body?.data) {
			return Buffer.from(payload.body.data, "base64").toString("utf-8");
		}

		if (payload.parts) {
			let textBody = "";
			let htmlBody = "";

			for (const part of payload.parts) {
				if (part.mimeType === "text/plain" && part.body?.data) {
					textBody = Buffer.from(part.body.data, "base64").toString("utf-8");
				} else if (part.mimeType === "text/html" && part.body?.data) {
					htmlBody = Buffer.from(part.body.data, "base64").toString("utf-8");
				} else if (part.parts) {
					const nestedBody = this.extractBody(part);
					if (nestedBody && !textBody) {
						textBody = nestedBody;
					}
				}
			}

			if (textBody) return textBody;
			if (htmlBody) {
				return htmlBody
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
					.replace(/<[^>]+>/g, " ")
					.replace(/&nbsp;/g, " ")
					.replace(/&amp;/g, "&")
					.replace(/&lt;/g, "<")
					.replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"')
					.replace(/&#39;/g, "'")
					.replace(/\s+/g, " ")
					.trim();
			}
		}

		return "";
	}
}

// Singleton for background sync
let _backgroundSyncManager: BackgroundSyncManager | null = null;

export function getBackgroundSyncManager(
	accessToken: string,
	db: Database,
	userId: string
): BackgroundSyncManager {
	if (
		!_backgroundSyncManager ||
		// Create new manager if credentials changed
		_backgroundSyncManager.userId !== userId
	) {
		_backgroundSyncManager = new BackgroundSyncManager(accessToken, db, userId);
	}
	return _backgroundSyncManager;
}

export function clearBackgroundSyncManager(): void {
	if (_backgroundSyncManager) {
		_backgroundSyncManager.stop();
		_backgroundSyncManager = null;
	}
}
