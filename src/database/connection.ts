import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
	and,
	count,
	desc,
	eq,
	ilike,
	inArray,
	lt,
	not,
	notExists,
	or,
	sql
} from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import invariant from "tiny-invariant";
import { createPGlite } from "../pglite-wrapper";
import type {
	ClassificationRun,
	ClassificationRunInsert,
	Classifier,
	ClassifierInsert,
	Email,
	EmailClassification,
	EmailClassificationInsert,
	EmailInsert,
	SyncQueueEntry,
	SyncQueueEntryInsert
} from "./schema";
import * as schema from "./schema";
import {
	account,
	classificationRun,
	classifier,
	email,
	emailClassification,
	syncQueue
} from "./schema";

export type { Classifier, Email, EmailClassification };

// Special marker for emails that were classified but had no matching classifier
export const NO_MATCH_CLASSIFIER_ID = "__NO_MATCH__";
export const NO_MATCH_CLASSIFIER_NAME = "No Match";

import migrations from "../drizzle/migrations.json";

export type Database = PgliteDatabase<typeof schema>;

/**
 * Represents a connection to the database.
 */
export class DatabaseConnection {
	sql: PGlite;
	db: Database;
	private promise: ReturnType<typeof Promise.withResolvers>["promise"];
	private resolve: ReturnType<typeof Promise.withResolvers>["resolve"];

	static async instance(dbDir: string) {
		const sql = await createPGlite(dbDir);
		return new DatabaseConnection(sql);
	}

	private constructor(sql: PGlite) {
		this.sql = sql;
		this.db = drizzle({
			casing: "camelCase",
			client: this.sql,
			schema
		});

		const { promise, resolve } = Promise.withResolvers();
		this.promise = promise;
		this.resolve = resolve;
	}

	private async ensureMigrationsTable() {
		await this.db.execute("CREATE SCHEMA IF NOT EXISTS drizzle");
		await this.db.execute(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
		  id SERIAL PRIMARY KEY,
		  hash text NOT NULL,
		  created_at bigint
		)`);
	}

	private async getMigratedHashes() {
		const result = await this.db.execute(
			`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`
		);
		return result.rows.map((row) => row.hash as string);
	}

	private async recordMigration(hash: string) {
		await this.sql.query(
			`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
			 VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`,
			[hash, Date.now()]
		);
	}

	async waitForMigrations() {
		await this.promise;
	}

	async migrate() {
		try {
			await this.ensureMigrationsTable();

			const executedHashes = await this.getMigratedHashes();
			const pendingMigrations = migrations.filter(
				(migration) => !executedHashes.includes(migration.hash)
			);

			if (pendingMigrations.length === 0) {
				return;
			}

			for (const migration of pendingMigrations) {
				for (const sql of migration.sql) {
					await this.db.execute(sql);
				}
				await this.recordMigration(migration.hash);
			}
		} finally {
			this.resolve();
		}
	}

	async close() {
		return await this.sql.close().catch(console.error);
	}
}

// Singleton connection instance
let _connection: DatabaseConnection | null = null;

export async function getDatabase(dbDir: string): Promise<Database> {
	if (_connection) {
		return _connection.db;
	}

	// Ensure parent directory exists
	await mkdir(dirname(dbDir), { recursive: true });

	_connection = await DatabaseConnection.instance(dbDir);
	await _connection.migrate();

	return _connection.db;
}

export function getPGlite(): PGlite | null {
	return _connection?.sql ?? null;
}

export async function closeDatabase(): Promise<void> {
	if (_connection) {
		await _connection.close();
		_connection = null;
	}
}

// Helper to get accountId from userId
export async function getAccountId(
	db: Database,
	userId: string
): Promise<string | null> {
	const result = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "google"))
	});
	return result?.id ?? null;
}

// Classifier Repository functions
export async function findClassifiersByUserId(
	db: Database,
	userId: string
): Promise<Classifier[]> {
	return await db.query.classifier.findMany({
		orderBy: (fields, { desc }) => desc(fields.priority),
		where: (fields, { eq }) => eq(fields.userId, userId)
	});
}

export async function findClassifierById(
	db: Database,
	classifierId: string
): Promise<Classifier | null> {
	const result = await db.query.classifier.findFirst({
		where: (fields, { eq }) => eq(fields.id, classifierId)
	});
	return result ?? null;
}

export async function createClassifier(
	db: Database,
	payload: ClassifierInsert
): Promise<Classifier | null> {
	const result = await db.insert(classifier).values(payload).returning();
	return result?.at(0) ?? null;
}

// Default classifiers to seed for new users
// These are ordered by priority - higher priority classifiers are checked first
// and take precedence when multiple classifiers could match an email
export const DEFAULT_CLASSIFIERS: Array<
	Omit<ClassifierInsert, "userId" | "id" | "accountId">
> = [
	{
		description:
			"Spam, scams, and phishing attempts: Emails trying to steal personal information, fake invoices, lottery/prize scams, Nigerian prince schemes, impersonation of banks/companies asking for credentials, urgent threats demanding immediate action, suspicious links, requests for gift cards, fake job offers, romance scams, cryptocurrency scams, and any deceptive email designed to defraud or harvest sensitive data",
		labelName: "Suspicious",
		name: "Spam & Scams",
		priority: 11
	},
	{
		description:
			"Emails that need a reply or personal attention: Direct questions from real people expecting a response, requests for information or feedback, personal emails from friends/family/colleagues, introductions, invitations requiring RSVP, and any email where someone is waiting for your reply. Does NOT include automated emails, marketing, or notifications.",
		labelName: "NeedsReply",
		name: "Needs Reply",
		priority: 10
	},
	{
		description:
			"Banking and financial account emails: Bank statements, credit card statements, wire transfer notices, investment portfolio updates, tax documents (W2, 1099), bills and payment due reminders, loan statements, and official communications from banks or financial institutions about your accounts",
		labelName: "Finance",
		name: "Financial",
		priority: 8
	},
	{
		description:
			"Online shopping and deliveries: Order confirmations from Amazon/eBay/etc, itemized receipts, shipping notifications, package tracking updates, delivery confirmations, out-for-delivery alerts, and updates from carriers like FedEx/UPS/USPS/DHL",
		labelName: "Orders",
		name: "Orders & Shipping",
		priority: 6
	},
	{
		description:
			"Automated system notifications that need no action: Calendar event confirmations, appointment reminders, password change notices, login alerts, account settings changes, welcome emails, email verification confirmations, subscription renewal notices, and any auto-generated acknowledgment that something happened successfully",
		labelName: "Notifications",
		name: "Automated Notifications",
		priority: 5
	},
	{
		description:
			"Newsletters and content subscriptions: Blog digests, industry news roundups, weekly/daily newsletters, Substack posts, Medium digests, product updates from companies you follow, educational content, and curated content from publishers",
		labelName: "Newsletters",
		name: "Newsletters",
		priority: 4
	},
	{
		description:
			"Marketing and promotions: Sales announcements, discount codes, promotional offers, flash sales, abandoned cart reminders, product recommendations, brand newsletters focused on selling, and advertising emails from retailers or services",
		labelName: "Promotions",
		name: "Marketing & Promos",
		priority: 2
	}
];

/**
 * Seeds default classifiers for a user if they haven't been seeded before.
 * Uses a flag on the account to track if defaults have been seeded,
 * so users who delete all classifiers won't get defaults again.
 * Returns the number of classifiers created.
 */
export async function seedDefaultClassifiers(
	db: Database,
	userId: string
): Promise<number> {
	// Check if defaults have already been seeded for this user
	const userAccount = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "google"))
	});

	if (!userAccount || userAccount.defaultClassifiersSeeded) {
		return 0;
	}

	const accountId = userAccount.id;

	// Create default classifiers
	let created = 0;
	for (const classifierData of DEFAULT_CLASSIFIERS) {
		const result = await createClassifier(db, {
			...classifierData,
			accountId,
			userId
		});
		if (result) {
			created++;
		}
	}

	// Mark defaults as seeded
	await db
		.update(account)
		.set({ defaultClassifiersSeeded: true, updatedAt: new Date() })
		.where(and(eq(account.userId, userId), eq(account.providerId, "google")));

	return created;
}

export async function updateClassifier(
	db: Database,
	userId: string,
	classifierId: string,
	payload: Partial<ClassifierInsert>
): Promise<Classifier | null> {
	const result = await db
		.update(classifier)
		.set(payload)
		.where(and(eq(classifier.id, classifierId), eq(classifier.userId, userId)))
		.returning();
	return result?.at(0) ?? null;
}

export async function deleteClassifier(
	db: Database,
	userId: string,
	classifierId: string
): Promise<boolean> {
	const result = await db
		.delete(classifier)
		.where(and(eq(classifier.id, classifierId), eq(classifier.userId, userId)))
		.returning();
	return result.length > 0;
}

// Classification Run functions
export async function createClassificationRun(
	db: Database,
	payload: ClassificationRunInsert
): Promise<ClassificationRun | null> {
	const result = await db.insert(classificationRun).values(payload).returning();
	return result?.at(0) ?? null;
}

export async function updateClassificationRun(
	db: Database,
	runId: string,
	payload: Partial<ClassificationRunInsert>
): Promise<ClassificationRun | null> {
	const result = await db
		.update(classificationRun)
		.set(payload)
		.where(eq(classificationRun.id, runId))
		.returning();
	return result?.at(0) ?? null;
}

// Gmail Token functions
export interface GmailTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: Date | null;
}

export async function getGmailTokens(
	db: Database,
	userId: string
): Promise<GmailTokens | null> {
	const result = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "google"))
	});

	if (!result?.accessToken || !result?.refreshToken) {
		return null;
	}

	return {
		accessToken: result.accessToken,
		expiresAt: result.accessTokenExpiresAt,
		refreshToken: result.refreshToken
	};
}

export async function saveGmailTokens(
	db: Database,
	userId: string,
	tokens: GmailTokens
): Promise<void> {
	const existing = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "google"))
	});

	if (existing) {
		await db
			.update(account)
			.set({
				accessToken: tokens.accessToken,
				accessTokenExpiresAt: tokens.expiresAt,
				refreshToken: tokens.refreshToken
			})
			.where(and(eq(account.userId, userId), eq(account.providerId, "google")));
	} else {
		await db.insert(account).values({
			accessToken: tokens.accessToken,
			accessTokenExpiresAt: tokens.expiresAt,
			accountId: "gmail",
			providerId: "google",
			refreshToken: tokens.refreshToken,
			scope: "gmail.readonly gmail.labels gmail.modify",
			userId
		});
	}
}

export async function deleteGmailTokens(
	db: Database,
	userId: string
): Promise<void> {
	// Deleting the account will CASCADE delete all related data
	// (classifiers, emails, classifications, sync queue, classification runs)
	await db
		.delete(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, "google")));
}

// User Profile functions
export interface UserProfile {
	email: string | null;
	name: string | null;
}

export async function getUserProfile(
	db: Database,
	userId: string
): Promise<UserProfile | null> {
	const result = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, "google"))
	});

	if (!result) {
		return null;
	}

	return {
		email: result.email,
		name: result.name
	};
}

export async function saveUserProfile(
	db: Database,
	userId: string,
	profile: UserProfile
): Promise<void> {
	await db
		.update(account)
		.set({
			email: profile.email,
			name: profile.name,
			updatedAt: new Date()
		})
		.where(and(eq(account.userId, userId), eq(account.providerId, "google")));
}

// Email Repository functions
export async function findEmailsByUserId(
	db: Database,
	userId: string,
	options?: { limit?: number; offset?: number; excludeSent?: boolean }
): Promise<Email[]> {
	if (options?.excludeSent) {
		// Use select query to support array filtering
		return await db
			.select()
			.from(email)
			.where(
				and(eq(email.userId, userId), not(sql`'SENT' = ANY(${email.labels})`))
			)
			.orderBy(desc(email.date))
			.limit(options?.limit ?? 50)
			.offset(options?.offset ?? 0);
	}

	return await db.query.email.findMany({
		limit: options?.limit,
		offset: options?.offset,
		orderBy: (fields, { desc }) => desc(fields.date),
		where: (fields, { eq }) => eq(fields.userId, userId)
	});
}

export async function findUnclassifiedEmails(
	db: Database,
	userId: string,
	options?: { limit?: number }
): Promise<Email[]> {
	// Use NOT EXISTS subquery to efficiently find emails without classifications
	// Also exclude sent emails (those with "SENT" in labels)
	return await db
		.select()
		.from(email)
		.where(
			and(
				eq(email.userId, userId),
				// Exclude sent emails
				not(sql`'SENT' = ANY(${email.labels})`),
				notExists(
					db
						.select()
						.from(emailClassification)
						.where(eq(emailClassification.gmailId, email.gmailId))
				)
			)
		)
		.orderBy(desc(email.date))
		.limit(options?.limit ?? 50);
}

export async function findEmailByGmailId(
	db: Database,
	userId: string,
	gmailId: string
): Promise<Email | null> {
	const result = await db.query.email.findFirst({
		where: (fields, { eq, and }) =>
			and(eq(fields.userId, userId), eq(fields.gmailId, gmailId))
	});
	return result ?? null;
}

export async function upsertEmails(
	db: Database,
	emailsToInsert: EmailInsert[]
): Promise<number> {
	if (emailsToInsert.length === 0) return 0;

	// Process in batches of 50 for better performance
	const BATCH_SIZE = 50;
	let upserted = 0;

	for (let i = 0; i < emailsToInsert.length; i += BATCH_SIZE) {
		const batch = emailsToInsert.slice(i, i + BATCH_SIZE);

		// Use Promise.all to run batch inserts in parallel
		const results = await Promise.all(
			batch.map((e) => {
				// Determine archived status based on INBOX label
				const isArchived = !e.labels?.includes("INBOX");
				// Determine unread status based on UNREAD label
				const isUnread = e.labels?.includes("UNREAD") ?? false;

				return db
					.insert(email)
					.values({ ...e, archived: isArchived, unread: isUnread })
					.onConflictDoUpdate({
						set: {
							archived: isArchived,
							body: e.body,
							date: e.date,
							from: e.from,
							labels: e.labels,
							snippet: e.snippet,
							subject: e.subject,
							threadId: e.threadId,
							to: e.to,
							unread: isUnread,
							updatedAt: new Date()
						},
						target: email.gmailId
					})
					.returning();
			})
		);

		upserted += results.filter((r) => r.length > 0).length;
	}

	return upserted;
}

export async function countEmailsByUserId(
	db: Database,
	userId: string,
	options?: { archived?: boolean; unread?: boolean }
): Promise<number> {
	const conditions = [eq(email.userId, userId)];

	if (options?.archived !== undefined) {
		conditions.push(eq(email.archived, options.archived));
	}

	if (options?.unread !== undefined) {
		conditions.push(eq(email.unread, options.unread));
	}

	const result = await db
		.select({ count: count() })
		.from(email)
		.where(and(...conditions));
	return result[0]?.count ?? 0;
}

export async function deleteEmailsByIds(
	db: Database,
	emailIds: string[]
): Promise<number> {
	if (emailIds.length === 0) return 0;

	// Also delete associated classifications
	await db
		.delete(emailClassification)
		.where(inArray(emailClassification.emailId, emailIds));

	const result = await db
		.delete(email)
		.where(inArray(email.id, emailIds))
		.returning();

	return result.length;
}

export async function markEmailArchived(
	db: Database,
	emailId: string
): Promise<void> {
	await db
		.update(email)
		.set({ archived: true, updatedAt: new Date() })
		.where(eq(email.id, emailId));
}

export async function markEmailsArchived(
	db: Database,
	emailIds: string[]
): Promise<void> {
	if (emailIds.length === 0) return;
	await db
		.update(email)
		.set({ archived: true, updatedAt: new Date() })
		.where(inArray(email.id, emailIds));
}

export async function markEmailRead(
	db: Database,
	emailId: string
): Promise<void> {
	await db
		.update(email)
		.set({ unread: false, updatedAt: new Date() })
		.where(eq(email.id, emailId));
}

export async function markEmailUnread(
	db: Database,
	emailId: string
): Promise<void> {
	await db
		.update(email)
		.set({ unread: true, updatedAt: new Date() })
		.where(eq(email.id, emailId));
}

export async function markEmailsRead(
	db: Database,
	emailIds: string[]
): Promise<void> {
	if (emailIds.length === 0) return;
	await db
		.update(email)
		.set({ unread: false, updatedAt: new Date() })
		.where(inArray(email.id, emailIds));
}

export async function markEmailsUnread(
	db: Database,
	emailIds: string[]
): Promise<void> {
	if (emailIds.length === 0) return;
	await db
		.update(email)
		.set({ unread: true, updatedAt: new Date() })
		.where(inArray(email.id, emailIds));
}

export async function getLatestEmailDate(
	db: Database,
	userId: string
): Promise<Date | null> {
	const result = await db
		.select({ date: email.date })
		.from(email)
		.where(eq(email.userId, userId))
		.orderBy(desc(email.date))
		.limit(1);
	return result[0]?.date ?? null;
}

export interface ClassifierFilterOption {
	id: string;
	name: string;
	count: number;
}

export async function getClassifierFilterOptions(
	db: Database,
	userId: string
): Promise<ClassifierFilterOption[]> {
	// Get unique classifiers that have been used for classifications, with counts
	const result = await db
		.select({
			count: sql<number>`count(*)::int`,
			id: emailClassification.classifierId,
			name: emailClassification.classifierName
		})
		.from(emailClassification)
		.where(eq(emailClassification.userId, userId))
		.groupBy(
			emailClassification.classifierId,
			emailClassification.classifierName
		)
		.orderBy(emailClassification.classifierName);

	return result;
}

export async function searchEmails(
	db: Database,
	userId: string,
	options?: {
		query?: string;
		limit?: number;
		offset?: number;
		classifierIds?: string[];
		archived?: boolean;
		unread?: boolean;
	}
): Promise<Email[]> {
	const {
		query,
		limit = 50,
		offset = 0,
		classifierIds,
		archived,
		unread
	} = options || {};

	const conditions = [eq(email.userId, userId)];

	// Filter by archived status if specified
	if (archived !== undefined) {
		conditions.push(eq(email.archived, archived));
	}

	// Filter by unread status if specified
	if (unread !== undefined) {
		conditions.push(eq(email.unread, unread));
	}

	if (query) {
		const searchPattern = `%${query}%`;
		const orCondition = or(
			ilike(email.subject, searchPattern),
			ilike(email.from, searchPattern),
			ilike(email.snippet, searchPattern)
		);
		invariant(orCondition, "OR condition should not be undefined");
		conditions.push(orCondition);
	}

	// If filtering by classifiers, use a subquery to find matching email IDs
	if (classifierIds && classifierIds.length > 0) {
		conditions.push(
			inArray(
				email.id,
				db
					.select({ emailId: emailClassification.emailId })
					.from(emailClassification)
					.where(inArray(emailClassification.classifierId, classifierIds))
			)
		);
	}

	return await db
		.select()
		.from(email)
		.where(and(...conditions))
		.orderBy(desc(email.date))
		.limit(limit)
		.offset(offset);
}

// Email Classification Repository functions
export async function upsertEmailClassification(
	db: Database,
	payload: EmailClassificationInsert
): Promise<EmailClassification | null> {
	const result = await db
		.insert(emailClassification)
		.values(payload)
		.onConflictDoUpdate({
			set: {
				confidence: payload.confidence,
				labelApplied: payload.labelApplied,
				reasoning: payload.reasoning,
				runId: payload.runId,
				updatedAt: new Date()
			},
			target: [emailClassification.emailId, emailClassification.classifierId]
		})
		.returning();
	return result?.at(0) ?? null;
}

export async function deleteEmailClassification(
	db: Database,
	emailId: string
): Promise<boolean> {
	const result = await db
		.delete(emailClassification)
		.where(eq(emailClassification.emailId, emailId))
		.returning();
	return result.length > 0;
}

export async function markLabelApplied(
	db: Database,
	emailId: string
): Promise<void> {
	await db
		.update(emailClassification)
		.set({ labelApplied: true, updatedAt: new Date() })
		.where(eq(emailClassification.emailId, emailId));
}

export async function markLabelsApplied(
	db: Database,
	emailIds: string[]
): Promise<void> {
	if (emailIds.length === 0) return;
	await db
		.update(emailClassification)
		.set({ labelApplied: true, updatedAt: new Date() })
		.where(inArray(emailClassification.emailId, emailIds));
}

export async function findClassificationsByEmailIds(
	db: Database,
	emailIds: string[]
): Promise<Map<string, EmailClassification>> {
	if (emailIds.length === 0) return new Map();

	const results = await db
		.select()
		.from(emailClassification)
		.where(inArray(emailClassification.emailId, emailIds))
		.orderBy(desc(emailClassification.confidence));

	// Return map of emailId -> highest confidence classification
	const classificationMap = new Map<string, EmailClassification>();
	for (const classification of results) {
		// Only keep first (highest confidence) classification per email
		if (!classificationMap.has(classification.emailId)) {
			classificationMap.set(classification.emailId, classification);
		}
	}
	return classificationMap;
}

// Sync Queue Repository functions
export interface SyncQueueStats {
	pending: number;
	syncing: number;
	synced: number;
	failed: number;
	total: number;
}

export async function addToSyncQueue(
	db: Database,
	userId: string,
	accountId: string,
	gmailIds: string[]
): Promise<number> {
	if (gmailIds.length === 0) return 0;

	const BATCH_SIZE = 100;
	let added = 0;

	for (let i = 0; i < gmailIds.length; i += BATCH_SIZE) {
		const batch = gmailIds.slice(i, i + BATCH_SIZE);
		const entries: SyncQueueEntryInsert[] = batch.map((gmailId) => ({
			accountId,
			gmailId,
			status: "pending",
			userId
		}));

		// Use onConflictDoNothing to skip already queued items
		const results = await db
			.insert(syncQueue)
			.values(entries)
			.onConflictDoNothing()
			.returning();

		added += results.length;
	}

	return added;
}

export async function getPendingSyncItems(
	db: Database,
	userId: string,
	limit = 50
): Promise<SyncQueueEntry[]> {
	return await db
		.select()
		.from(syncQueue)
		.where(and(eq(syncQueue.userId, userId), eq(syncQueue.status, "pending")))
		.orderBy(syncQueue.createdAt)
		.limit(limit);
}

export async function markSyncItemSyncing(
	db: Database,
	ids: string[]
): Promise<void> {
	if (ids.length === 0) return;

	await db
		.update(syncQueue)
		.set({ status: "syncing", updatedAt: new Date() })
		.where(inArray(syncQueue.id, ids));
}

export async function markSyncItemSynced(
	db: Database,
	gmailId: string,
	userId: string
): Promise<void> {
	await db
		.update(syncQueue)
		.set({
			status: "synced",
			syncedAt: new Date(),
			updatedAt: new Date()
		})
		.where(and(eq(syncQueue.gmailId, gmailId), eq(syncQueue.userId, userId)));
}

export async function markSyncItemFailed(
	db: Database,
	gmailId: string,
	userId: string,
	error: string
): Promise<{ deleted: boolean; retryCount: number }> {
	// First get the current retry count
	const item = await db.query.syncQueue.findFirst({
		where: and(eq(syncQueue.gmailId, gmailId), eq(syncQueue.userId, userId))
	});

	if (!item) {
		return { deleted: false, retryCount: 0 };
	}

	const newRetryCount = (item.retryCount ?? 0) + 1;

	// If we've hit 5 retries, delete the item
	if (newRetryCount >= 5) {
		await db
			.delete(syncQueue)
			.where(and(eq(syncQueue.gmailId, gmailId), eq(syncQueue.userId, userId)));
		return { deleted: true, retryCount: newRetryCount };
	}

	// Otherwise update retry count and set back to pending
	await db
		.update(syncQueue)
		.set({
			lastError: error,
			retryCount: newRetryCount,
			status: "pending",
			updatedAt: new Date()
		})
		.where(and(eq(syncQueue.gmailId, gmailId), eq(syncQueue.userId, userId)));

	return { deleted: false, retryCount: newRetryCount };
}

export async function deleteSyncedItems(
	db: Database,
	userId: string
): Promise<number> {
	const result = await db
		.delete(syncQueue)
		.where(and(eq(syncQueue.userId, userId), eq(syncQueue.status, "synced")))
		.returning();
	return result.length;
}

export async function getSyncQueueStats(
	db: Database,
	userId: string
): Promise<SyncQueueStats> {
	const results = await db
		.select({
			count: count(),
			status: syncQueue.status
		})
		.from(syncQueue)
		.where(eq(syncQueue.userId, userId))
		.groupBy(syncQueue.status);

	const stats: SyncQueueStats = {
		failed: 0,
		pending: 0,
		synced: 0,
		syncing: 0,
		total: 0
	};

	for (const row of results) {
		const status = row.status as keyof Omit<SyncQueueStats, "total">;
		if (status in stats) {
			stats[status] = row.count;
		}
		stats.total += row.count;
	}

	return stats;
}

export async function resetStuckSyncingItems(
	db: Database,
	userId: string
): Promise<number> {
	// Reset items that have been "syncing" for more than 5 minutes (likely stuck)
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

	const result = await db
		.update(syncQueue)
		.set({
			status: "pending",
			updatedAt: new Date()
		})
		.where(
			and(
				eq(syncQueue.userId, userId),
				eq(syncQueue.status, "syncing"),
				lt(syncQueue.updatedAt, fiveMinutesAgo)
			)
		)
		.returning();

	return result.length;
}
