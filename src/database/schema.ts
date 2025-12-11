import {
	bigint,
	boolean,
	doublePrecision,
	index,
	pgTable,
	text,
	timestamp,
	unique
} from "drizzle-orm/pg-core";
import { v7 } from "uuid";

const baseDate = {
	createdAt: timestamp({ mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp({ mode: "date" })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
};

// Account - stores OAuth tokens and user profile info
export const account = pgTable(
	"account",
	{
		id: text()
			.primaryKey()
			.notNull()
			.$default(() => `acc_${v7()}`),
		...baseDate,
		accessToken: text(),
		accessTokenExpiresAt: timestamp({ mode: "date" }),
		accountId: text().notNull(),
		defaultClassifiersSeeded: boolean().default(false).notNull(),
		email: text(),
		name: text(),
		providerId: text().notNull(),
		refreshToken: text(),
		scope: text(),
		userId: text().notNull()
	},
	(table) => [
		index("account_user_provider_idx").on(table.userId, table.providerId)
	]
);

export type Account = typeof account.$inferSelect;
export type AccountInsert = typeof account.$inferInsert;

// Classifier - stores user-defined email classification rules
export const classifier = pgTable(
	"classifier",
	{
		id: text()
			.primaryKey()
			.notNull()
			.$default(() => `clf_${v7()}`),
		...baseDate,
		accountId: text()
			.notNull()
			.references(() => account.id, { onDelete: "cascade" }),
		description: text().notNull(),
		enabled: boolean().default(true).notNull(),
		labelName: text().notNull(),
		name: text().notNull(),
		priority: bigint({ mode: "number" }).default(0),
		userId: text().notNull()
	},
	(table) => [index("classifier_user_idx").on(table.userId)]
);

export type Classifier = typeof classifier.$inferSelect;
export type ClassifierInsert = typeof classifier.$inferInsert;

// Classification Run - tracks each classification execution
export const classificationRun = pgTable("classification_run", {
	id: text()
		.primaryKey()
		.notNull()
		.$default(() => `clr_${v7()}`),
	...baseDate,
	accountId: text()
		.notNull()
		.references(() => account.id, { onDelete: "cascade" }),
	completedAt: timestamp({ mode: "date" }),
	emailsClassified: bigint({ mode: "number" }).notNull().default(0),
	emailsProcessed: bigint({ mode: "number" }).notNull().default(0),
	startedAt: timestamp({ mode: "date" }).notNull().defaultNow(),
	status: text().notNull().default("running"),
	userId: text().notNull()
});

export type ClassificationRun = typeof classificationRun.$inferSelect;
export type ClassificationRunInsert = typeof classificationRun.$inferInsert;

// Email - stores synced emails from Gmail
export const email = pgTable(
	"email",
	{
		id: text()
			.primaryKey()
			.notNull()
			.$default(() => `eml_${v7()}`),
		...baseDate,
		accountId: text()
			.notNull()
			.references(() => account.id, { onDelete: "cascade" }),
		archived: boolean().default(false).notNull(),
		body: text().notNull(),
		date: timestamp({ mode: "date" }).notNull(),
		from: text().notNull(),
		gmailId: text().notNull().unique(),
		labels: text().array().notNull().default([]),
		snippet: text().notNull(),
		subject: text().notNull(),
		threadId: text().notNull(),
		to: text().notNull(),
		unread: boolean().default(false).notNull(),
		userId: text().notNull()
	},
	(table) => [
		index("email_user_date_idx").on(table.userId, table.date),
		index("email_gmail_id_idx").on(table.gmailId)
	]
);

export type Email = typeof email.$inferSelect;
export type EmailInsert = typeof email.$inferInsert;

// Email Classification - tracks which classifiers were applied to each email
export const emailClassification = pgTable(
	"email_classification",
	{
		id: text()
			.primaryKey()
			.notNull()
			.$default(() => `ecl_${v7()}`),
		...baseDate,
		accountId: text()
			.notNull()
			.references(() => account.id, { onDelete: "cascade" }),
		classifierId: text().notNull(),
		classifierName: text().notNull(),
		confidence: doublePrecision().notNull(),
		emailId: text().notNull(),
		gmailId: text().notNull(),
		labelApplied: boolean().notNull().default(false),
		labelName: text().notNull(),
		reasoning: text().notNull(),
		runId: text(),
		userId: text().notNull()
	},
	(table) => [
		unique().on(table.emailId, table.classifierId),
		index("email_classification_email_idx").on(table.emailId),
		index("email_classification_user_idx").on(table.userId),
		index("email_classification_gmail_idx").on(table.gmailId)
	]
);

export type EmailClassification = typeof emailClassification.$inferSelect;
export type EmailClassificationInsert = typeof emailClassification.$inferInsert;

// Sync Queue - tracks emails that need to be synced
export const syncQueue = pgTable(
	"sync_queue",
	{
		id: text()
			.primaryKey()
			.notNull()
			.$default(() => `sqe_${v7()}`),
		...baseDate,
		accountId: text()
			.notNull()
			.references(() => account.id, { onDelete: "cascade" }),
		gmailId: text().notNull(),
		lastError: text(),
		retryCount: bigint({ mode: "number" }).notNull().default(0),
		status: text().notNull().default("pending"), // pending, syncing, synced, failed
		syncedAt: timestamp({ mode: "date" }),
		userId: text().notNull()
	},
	(table) => [
		unique().on(table.gmailId, table.userId),
		index("sync_queue_user_status_idx").on(table.userId, table.status),
		index("sync_queue_gmail_id_idx").on(table.gmailId)
	]
);

export type SyncQueueEntry = typeof syncQueue.$inferSelect;
export type SyncQueueEntryInsert = typeof syncQueue.$inferInsert;
