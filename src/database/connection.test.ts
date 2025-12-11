import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
	addToSyncQueue,
	countEmailsByUserId,
	createClassificationRun,
	createClassifier,
	type Database,
	deleteClassifier,
	deleteEmailClassification,
	deleteEmailsByIds,
	deleteGmailTokens,
	deleteSyncedItems,
	findClassificationsByEmailIds,
	findClassifierById,
	findClassifiersByUserId,
	findEmailByGmailId,
	findEmailsByUserId,
	findUnclassifiedEmails,
	getClassifierFilterOptions,
	getGmailTokens,
	getLatestEmailDate,
	getPendingSyncItems,
	getSyncQueueStats,
	getUserProfile,
	markEmailArchived,
	markEmailRead,
	markEmailsArchived,
	markEmailsRead,
	markEmailsUnread,
	markEmailUnread,
	markLabelApplied,
	markLabelsApplied,
	markSyncItemFailed,
	markSyncItemSynced,
	markSyncItemSyncing,
	NO_MATCH_CLASSIFIER_ID,
	NO_MATCH_CLASSIFIER_NAME,
	resetStuckSyncingItems,
	saveGmailTokens,
	saveUserProfile,
	searchEmails,
	updateClassificationRun,
	updateClassifier,
	upsertEmailClassification,
	upsertEmails
} from "./connection";
import * as schema from "./schema";

let sql: PGlite;
let db: Database;

const TEST_USER_ID = "test_user";
const TEST_ACCOUNT_ID = "test_account";

beforeAll(async () => {
	// Create in-memory PGlite instance for testing
	sql = new PGlite();
	db = drizzle({ casing: "camelCase", client: sql, schema });

	// Run migrations manually for test db - use camelCase column names to match drizzle casing config
	await db.execute(`
		CREATE TABLE IF NOT EXISTS account (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accessToken" TEXT,
			"accessTokenExpiresAt" TIMESTAMP,
			"accountId" TEXT NOT NULL,
			"defaultClassifiersSeeded" BOOLEAN DEFAULT false NOT NULL,
			email TEXT,
			name TEXT,
			"providerId" TEXT NOT NULL,
			"refreshToken" TEXT,
			scope TEXT,
			"userId" TEXT NOT NULL
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS classifier (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accountId" TEXT NOT NULL,
			description TEXT NOT NULL,
			enabled BOOLEAN DEFAULT true NOT NULL,
			"labelName" TEXT NOT NULL,
			name TEXT NOT NULL,
			priority BIGINT DEFAULT 0,
			"userId" TEXT NOT NULL
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS classification_run (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accountId" TEXT NOT NULL,
			"completedAt" TIMESTAMP,
			"emailsClassified" BIGINT DEFAULT 0 NOT NULL,
			"emailsProcessed" BIGINT DEFAULT 0 NOT NULL,
			"startedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			status TEXT DEFAULT 'running' NOT NULL,
			"userId" TEXT NOT NULL
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS email (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accountId" TEXT NOT NULL,
			archived BOOLEAN DEFAULT false NOT NULL,
			body TEXT NOT NULL,
			date TIMESTAMP NOT NULL,
			"from" TEXT NOT NULL,
			"gmailId" TEXT NOT NULL UNIQUE,
			labels TEXT[] DEFAULT '{}' NOT NULL,
			snippet TEXT NOT NULL,
			subject TEXT NOT NULL,
			"threadId" TEXT NOT NULL,
			"to" TEXT NOT NULL,
			unread BOOLEAN DEFAULT false NOT NULL,
			"userId" TEXT NOT NULL
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS email_classification (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accountId" TEXT NOT NULL,
			"classifierId" TEXT NOT NULL,
			"classifierName" TEXT NOT NULL,
			confidence DOUBLE PRECISION NOT NULL,
			"emailId" TEXT NOT NULL,
			"gmailId" TEXT NOT NULL,
			"labelApplied" BOOLEAN DEFAULT false NOT NULL,
			"labelName" TEXT NOT NULL,
			reasoning TEXT NOT NULL,
			"runId" TEXT,
			"userId" TEXT NOT NULL,
			UNIQUE("emailId", "classifierId")
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS sync_queue (
			id TEXT PRIMARY KEY NOT NULL,
			"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
			"accountId" TEXT NOT NULL,
			"gmailId" TEXT NOT NULL,
			"lastError" TEXT,
			"retryCount" BIGINT DEFAULT 0 NOT NULL,
			status TEXT DEFAULT 'pending' NOT NULL,
			"syncedAt" TIMESTAMP,
			"userId" TEXT NOT NULL,
			UNIQUE("gmailId", "userId")
		)
	`);
});

afterAll(async () => {
	await sql.close();
});

afterEach(async () => {
	// Clean up test data
	await db.execute("DELETE FROM email_classification");
	await db.execute("DELETE FROM email");
	await db.execute("DELETE FROM classifier");
	await db.execute("DELETE FROM classification_run");
	await db.execute("DELETE FROM account");
	await db.execute("DELETE FROM sync_queue");
});

describe("Classifier Repository", () => {
	test("createClassifier creates a new classifier", async () => {
		const classifier = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Test description",
			labelName: "TestLabel",
			name: "Test Classifier",
			priority: 5,
			userId: TEST_USER_ID
		});

		expect(classifier).not.toBeNull();
		expect(classifier?.name).toBe("Test Classifier");
		expect(classifier?.description).toBe("Test description");
		expect(classifier?.labelName).toBe("TestLabel");
		expect(classifier?.priority).toBe(5);
		expect(classifier?.enabled).toBe(true);
		expect(classifier?.userId).toBe(TEST_USER_ID);
	});

	test("findClassifiersByUserId returns user classifiers sorted by priority", async () => {
		await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Low priority",
			labelName: "Low",
			name: "Low",
			priority: 1,
			userId: TEST_USER_ID
		});
		await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "High priority",
			labelName: "High",
			name: "High",
			priority: 10,
			userId: TEST_USER_ID
		});
		await createClassifier(db, {
			accountId: "other_account",
			description: "Other user",
			labelName: "Other",
			name: "Other",
			priority: 5,
			userId: "other_user"
		});

		const classifiers = await findClassifiersByUserId(db, TEST_USER_ID);

		expect(classifiers).toHaveLength(2);
		expect(classifiers[0]?.name).toBe("High");
		expect(classifiers[1]?.name).toBe("Low");
	});

	test("findClassifierById returns classifier by ID", async () => {
		const created = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Test",
			labelName: "Test",
			name: "Test",
			userId: TEST_USER_ID
		});

		const found = await findClassifierById(db, created!.id);
		expect(found).not.toBeNull();
		expect(found?.id).toBe(created!.id);
	});

	test("findClassifierById returns null for non-existent ID", async () => {
		const found = await findClassifierById(db, "non_existent_id");
		expect(found).toBeNull();
	});

	test("updateClassifier updates classifier fields", async () => {
		const created = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Original",
			labelName: "Original",
			name: "Original",
			userId: TEST_USER_ID
		});

		const updated = await updateClassifier(db, TEST_USER_ID, created!.id, {
			enabled: false,
			name: "Updated"
		});

		expect(updated?.name).toBe("Updated");
		expect(updated?.enabled).toBe(false);
	});

	test("updateClassifier returns null for wrong user", async () => {
		const created = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Test",
			labelName: "Test",
			name: "Test",
			userId: TEST_USER_ID
		});

		const updated = await updateClassifier(db, "wrong_user", created!.id, {
			name: "Updated"
		});

		expect(updated).toBeNull();
	});

	test("deleteClassifier removes classifier", async () => {
		const created = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Test",
			labelName: "Test",
			name: "Test",
			userId: TEST_USER_ID
		});

		const deleted = await deleteClassifier(db, TEST_USER_ID, created!.id);
		expect(deleted).toBe(true);

		const found = await findClassifierById(db, created!.id);
		expect(found).toBeNull();
	});

	test("deleteClassifier returns false for wrong user", async () => {
		const created = await createClassifier(db, {
			accountId: TEST_ACCOUNT_ID,
			description: "Test",
			labelName: "Test",
			name: "Test",
			userId: TEST_USER_ID
		});

		const deleted = await deleteClassifier(db, "wrong_user", created!.id);
		expect(deleted).toBe(false);
	});
});

describe("Classification Run", () => {
	test("createClassificationRun creates a new run", async () => {
		const run = await createClassificationRun(db, {
			accountId: TEST_ACCOUNT_ID,
			status: "running",
			userId: TEST_USER_ID
		});

		expect(run).not.toBeNull();
		expect(run?.status).toBe("running");
		expect(run?.userId).toBe(TEST_USER_ID);
		expect(run?.emailsProcessed).toBe(0);
		expect(run?.emailsClassified).toBe(0);
	});

	test("updateClassificationRun updates run fields", async () => {
		const run = await createClassificationRun(db, {
			accountId: TEST_ACCOUNT_ID,
			status: "running",
			userId: TEST_USER_ID
		});

		const updated = await updateClassificationRun(db, run!.id, {
			completedAt: new Date(),
			emailsClassified: 10,
			emailsProcessed: 20,
			status: "completed"
		});

		expect(updated?.status).toBe("completed");
		expect(updated?.emailsProcessed).toBe(20);
		expect(updated?.emailsClassified).toBe(10);
		expect(updated?.completedAt).not.toBeNull();
	});
});

describe("Gmail Tokens", () => {
	test("saveGmailTokens creates new tokens", async () => {
		await saveGmailTokens(db, TEST_USER_ID, {
			accessToken: "access123",
			expiresAt: new Date("2025-01-01"),
			refreshToken: "refresh123"
		});

		const tokens = await getGmailTokens(db, TEST_USER_ID);
		expect(tokens).not.toBeNull();
		expect(tokens?.accessToken).toBe("access123");
		expect(tokens?.refreshToken).toBe("refresh123");
	});

	test("saveGmailTokens updates existing tokens", async () => {
		await saveGmailTokens(db, TEST_USER_ID, {
			accessToken: "access1",
			expiresAt: new Date("2025-01-01"),
			refreshToken: "refresh1"
		});

		await saveGmailTokens(db, TEST_USER_ID, {
			accessToken: "access2",
			expiresAt: new Date("2025-02-01"),
			refreshToken: "refresh2"
		});

		const tokens = await getGmailTokens(db, TEST_USER_ID);
		expect(tokens?.accessToken).toBe("access2");
		expect(tokens?.refreshToken).toBe("refresh2");
	});

	test("getGmailTokens returns null for non-existent user", async () => {
		const tokens = await getGmailTokens(db, "non_existent");
		expect(tokens).toBeNull();
	});

	test("deleteGmailTokens removes tokens", async () => {
		await saveGmailTokens(db, TEST_USER_ID, {
			accessToken: "access123",
			expiresAt: new Date(),
			refreshToken: "refresh123"
		});

		await deleteGmailTokens(db, TEST_USER_ID);

		const tokens = await getGmailTokens(db, TEST_USER_ID);
		expect(tokens).toBeNull();
	});
});

describe("User Profile", () => {
	test("saveUserProfile and getUserProfile work together", async () => {
		// First create an account
		await saveGmailTokens(db, TEST_USER_ID, {
			accessToken: "access",
			expiresAt: new Date(),
			refreshToken: "refresh"
		});

		await saveUserProfile(db, TEST_USER_ID, {
			email: "test@example.com",
			name: "Test User"
		});

		const profile = await getUserProfile(db, TEST_USER_ID);
		expect(profile?.email).toBe("test@example.com");
		expect(profile?.name).toBe("Test User");
	});

	test("getUserProfile returns null for non-existent user", async () => {
		const profile = await getUserProfile(db, "non_existent");
		expect(profile).toBeNull();
	});
});

describe("Email Repository", () => {
	test("upsertEmails inserts new emails", async () => {
		const count = await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test body",
				date: new Date(),
				from: "from@test.com",
				gmailId: "gmail1",
				labels: ["INBOX"],
				snippet: "Test snippet",
				subject: "Test Subject",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		expect(count).toBe(1);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		expect(emails).toHaveLength(1);
		expect(emails[0]?.subject).toBe("Test Subject");
		expect(emails[0]?.archived).toBe(false);
	});

	test("upsertEmails sets archived=true for non-INBOX emails", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "gmail2",
				labels: ["SENT"],
				snippet: "Test",
				subject: "Archived",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		expect(emails[0]?.archived).toBe(true);
	});

	test("upsertEmails sets unread=true for UNREAD label", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "gmail3",
				labels: ["INBOX", "UNREAD"],
				snippet: "Test",
				subject: "Unread",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		expect(emails[0]?.unread).toBe(true);
	});

	test("upsertEmails updates existing emails", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Original",
				date: new Date(),
				from: "from@test.com",
				gmailId: "gmail4",
				labels: ["INBOX"],
				snippet: "Original",
				subject: "Original",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Updated",
				date: new Date(),
				from: "from@test.com",
				gmailId: "gmail4",
				labels: ["INBOX"],
				snippet: "Updated",
				subject: "Updated",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		expect(emails).toHaveLength(1);
		expect(emails[0]?.subject).toBe("Updated");
	});

	test("findEmailsByUserId respects limit and offset", async () => {
		for (let i = 0; i < 5; i++) {
			await upsertEmails(db, [
				{
					accountId: TEST_ACCOUNT_ID,
					body: `Body ${i}`,
					date: new Date(Date.now() - i * 1000),
					from: "from@test.com",
					gmailId: `gmail${i}`,
					labels: ["INBOX"],
					snippet: `Snippet ${i}`,
					subject: `Subject ${i}`,
					threadId: `thread${i}`,
					to: "to@test.com",
					userId: TEST_USER_ID
				}
			]);
		}

		const emails = await findEmailsByUserId(db, TEST_USER_ID, {
			limit: 2,
			offset: 1
		});
		expect(emails).toHaveLength(2);
	});

	test("findEmailsByUserId excludes sent emails when excludeSent=true", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Inbox",
				date: new Date(),
				from: "from@test.com",
				gmailId: "inbox1",
				labels: ["INBOX"],
				snippet: "Inbox",
				subject: "Inbox",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Sent",
				date: new Date(),
				from: "from@test.com",
				gmailId: "sent1",
				labels: ["SENT"],
				snippet: "Sent",
				subject: "Sent",
				threadId: "thread2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID, {
			excludeSent: true
		});
		expect(emails).toHaveLength(1);
		expect(emails[0]?.subject).toBe("Inbox");
	});

	test("findUnclassifiedEmails returns only unclassified non-sent emails", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Unclassified",
				date: new Date(),
				from: "from@test.com",
				gmailId: "unclassified1",
				labels: ["INBOX"],
				snippet: "Unclassified",
				subject: "Unclassified",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		// Get email ID
		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		// Classify one email
		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Test",
			reasoning: "Test",
			userId: TEST_USER_ID
		});

		// Add another unclassified email
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Unclassified 2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "unclassified2",
				labels: ["INBOX"],
				snippet: "Unclassified 2",
				subject: "Unclassified 2",
				threadId: "thread2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const unclassified = await findUnclassifiedEmails(db, TEST_USER_ID);
		expect(unclassified).toHaveLength(1);
		expect(unclassified[0]!.gmailId).toBe("unclassified2");
	});

	test("findEmailByGmailId returns email by Gmail ID", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "specific_gmail_id",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const email = await findEmailByGmailId(
			db,
			TEST_USER_ID,
			"specific_gmail_id"
		);
		expect(email).not.toBeNull();
		expect(email?.gmailId).toBe("specific_gmail_id");
	});

	test("countEmailsByUserId counts emails", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "g1",
				labels: ["INBOX", "UNREAD"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "g2",
				labels: ["SENT"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const total = await countEmailsByUserId(db, TEST_USER_ID);
		expect(total).toBe(2);

		const archived = await countEmailsByUserId(db, TEST_USER_ID, {
			archived: true
		});
		expect(archived).toBe(1);

		const unread = await countEmailsByUserId(db, TEST_USER_ID, {
			unread: true
		});
		expect(unread).toBe(1);
	});

	test("deleteEmailsByIds deletes emails and classifications", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Delete me",
				date: new Date(),
				from: "from@test.com",
				gmailId: "delete1",
				labels: ["INBOX"],
				snippet: "Delete me",
				subject: "Delete me",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		const deleted = await deleteEmailsByIds(db, [emails[0]!.id]);

		expect(deleted).toBe(1);

		const remaining = await findEmailsByUserId(db, TEST_USER_ID);
		expect(remaining).toHaveLength(0);
	});

	test("markEmailArchived marks email as archived", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "archive1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		await markEmailArchived(db, emails[0]!.id);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated[0]?.archived).toBe(true);
	});

	test("markEmailRead marks email as read", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "read1",
				labels: ["INBOX", "UNREAD"],
				snippet: "Test",
				subject: "Test",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		expect(emails[0]?.unread).toBe(true);

		await markEmailRead(db, emails[0]!.id);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated[0]?.unread).toBe(false);
	});

	test("markEmailUnread marks email as unread", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "unread1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "thread1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		await markEmailUnread(db, emails[0]!.id);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated[0]?.unread).toBe(true);
	});

	test("getLatestEmailDate returns latest date", async () => {
		const oldDate = new Date("2024-01-01");
		const newDate = new Date("2024-06-01");

		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Old",
				date: oldDate,
				from: "from@test.com",
				gmailId: "old1",
				labels: ["INBOX"],
				snippet: "Old",
				subject: "Old",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "New",
				date: newDate,
				from: "from@test.com",
				gmailId: "new1",
				labels: ["INBOX"],
				snippet: "New",
				subject: "New",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const latest = await getLatestEmailDate(db, TEST_USER_ID);
		expect(latest?.getTime()).toBe(newDate.getTime());
	});

	test("searchEmails filters by query", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Important message",
				date: new Date(),
				from: "boss@company.com",
				gmailId: "search1",
				labels: ["INBOX"],
				snippet: "Important",
				subject: "Meeting Tomorrow",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Random",
				date: new Date(),
				from: "spam@spam.com",
				gmailId: "search2",
				labels: ["INBOX"],
				snippet: "Random",
				subject: "Win a prize",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const results = await searchEmails(db, TEST_USER_ID, { query: "meeting" });
		expect(results).toHaveLength(1);
		expect(results[0]?.subject).toBe("Meeting Tomorrow");
	});

	test("searchEmails filters by classifierIds", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Work",
				date: new Date(),
				from: "from@test.com",
				gmailId: "clf_filter1",
				labels: ["INBOX"],
				snippet: "Work",
				subject: "Work",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Personal",
				date: new Date(),
				from: "from@test.com",
				gmailId: "clf_filter2",
				labels: ["INBOX"],
				snippet: "Personal",
				subject: "Personal",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		// Classify first email
		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_work",
			classifierName: "Work",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Work",
			reasoning: "",
			userId: TEST_USER_ID
		});

		const results = await searchEmails(db, TEST_USER_ID, {
			classifierIds: ["clf_work"]
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.subject).toBe("Work");
	});
});

describe("Email Classification Repository", () => {
	test("upsertEmailClassification creates classification", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "clf_test1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		const classification = await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test Classifier",
			confidence: 0.85,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "TestLabel",
			reasoning: "Test reasoning",
			userId: TEST_USER_ID
		});

		expect(classification).not.toBeNull();
		expect(classification?.confidence).toBe(0.85);
		expect(classification?.classifierName).toBe("Test Classifier");
	});

	test("upsertEmailClassification updates existing", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "clf_update1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.5,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Test",
			reasoning: "Original",
			userId: TEST_USER_ID
		});

		const updated = await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: true,
			labelName: "Test",
			reasoning: "Updated",
			userId: TEST_USER_ID
		});

		expect(updated?.confidence).toBe(0.9);
		expect(updated?.labelApplied).toBe(true);
	});

	test("deleteEmailClassification removes classification", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "clf_delete1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Test",
			reasoning: "",
			userId: TEST_USER_ID
		});

		const deleted = await deleteEmailClassification(db, emails[0]!.id);
		expect(deleted).toBe(true);
	});

	test("markLabelApplied updates labelApplied flag", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "Test",
				date: new Date(),
				from: "from@test.com",
				gmailId: "mark_label1",
				labels: ["INBOX"],
				snippet: "Test",
				subject: "Test",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Test",
			reasoning: "",
			userId: TEST_USER_ID
		});

		await markLabelApplied(db, emails[0]!.id);

		const classifications = await findClassificationsByEmailIds(db, [
			emails[0]!.id
		]);
		expect(classifications.get(emails[0]!.id)?.labelApplied).toBe(true);
	});

	test("findClassificationsByEmailIds returns map", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "map1",
				labels: ["INBOX"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "map2",
				labels: ["INBOX"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_1",
			classifierName: "Test",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Test",
			reasoning: "",
			userId: TEST_USER_ID
		});

		const map = await findClassificationsByEmailIds(db, [
			emails[0]!.id,
			emails[1]!.id
		]);
		expect(map.size).toBe(1);
		expect(map.has(emails[0]!.id)).toBe(true);
		expect(map.has(emails[1]!.id)).toBe(false);
	});

	test("getClassifierFilterOptions returns unique classifiers with counts", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "filter_opt1",
				labels: ["INBOX"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "filter_opt2",
				labels: ["INBOX"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_work",
			classifierName: "Work",
			confidence: 0.9,
			emailId: emails[0]!.id,
			gmailId: emails[0]!.gmailId,
			labelApplied: false,
			labelName: "Work",
			reasoning: "",
			userId: TEST_USER_ID
		});

		await upsertEmailClassification(db, {
			accountId: TEST_ACCOUNT_ID,
			classifierId: "clf_work",
			classifierName: "Work",
			confidence: 0.9,
			emailId: emails[1]!.id,
			gmailId: emails[1]!.gmailId,
			labelApplied: false,
			labelName: "Work",
			reasoning: "",
			userId: TEST_USER_ID
		});

		const options = await getClassifierFilterOptions(db, TEST_USER_ID);
		expect(options).toHaveLength(1);
		expect(options[0]?.name).toBe("Work");
		expect(options[0]?.count).toBe(2);
	});
});

describe("Sync Queue Repository", () => {
	test("addToSyncQueue adds items", async () => {
		const added = await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, [
			"gmail1",
			"gmail2",
			"gmail3"
		]);
		expect(added).toBe(3);
	});

	test("addToSyncQueue skips duplicates", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["gmail1"]);
		const added = await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, [
			"gmail1",
			"gmail2"
		]);
		expect(added).toBe(1);
	});

	test("getPendingSyncItems returns pending items", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["p1", "p2"]);

		const pending = await getPendingSyncItems(db, TEST_USER_ID);
		expect(pending).toHaveLength(2);
	});

	test("markSyncItemSyncing updates status", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["sync1"]);
		const items = await getPendingSyncItems(db, TEST_USER_ID);

		await markSyncItemSyncing(db, [items[0]!.id]);

		const pending = await getPendingSyncItems(db, TEST_USER_ID);
		expect(pending).toHaveLength(0);
	});

	test("markSyncItemSynced updates status and timestamp", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["synced1"]);

		await markSyncItemSynced(db, "synced1", TEST_USER_ID);

		const stats = await getSyncQueueStats(db, TEST_USER_ID);
		expect(stats.synced).toBe(1);
	});

	test("markSyncItemFailed increments retry count", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["fail1"]);

		const result = await markSyncItemFailed(db, "fail1", TEST_USER_ID, "Error");
		expect(result.retryCount).toBe(1);
		expect(result.deleted).toBe(false);
	});

	test("markSyncItemFailed deletes after 5 retries", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["fail_delete"]);

		// Fail 5 times
		for (let i = 0; i < 4; i++) {
			await markSyncItemFailed(db, "fail_delete", TEST_USER_ID, "Error");
		}

		const result = await markSyncItemFailed(
			db,
			"fail_delete",
			TEST_USER_ID,
			"Final error"
		);
		expect(result.deleted).toBe(true);
		expect(result.retryCount).toBe(5);
	});

	test("deleteSyncedItems removes synced items", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["del1", "del2"]);
		await markSyncItemSynced(db, "del1", TEST_USER_ID);

		const deleted = await deleteSyncedItems(db, TEST_USER_ID);
		expect(deleted).toBe(1);
	});

	test("getSyncQueueStats returns correct counts", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["s1", "s2", "s3"]);
		await markSyncItemSynced(db, "s1", TEST_USER_ID);
		await markSyncItemFailed(db, "s2", TEST_USER_ID, "Error");

		const stats = await getSyncQueueStats(db, TEST_USER_ID);
		expect(stats.synced).toBe(1);
		expect(stats.pending).toBe(2); // s2 goes back to pending, s3 is still pending
		expect(stats.total).toBe(3);
	});

	test("resetStuckSyncingItems resets old syncing items", async () => {
		await addToSyncQueue(db, TEST_USER_ID, TEST_ACCOUNT_ID, ["stuck1"]);
		const items = await getPendingSyncItems(db, TEST_USER_ID);
		await markSyncItemSyncing(db, [items[0]!.id]);

		// Manually set updatedAt to 10 minutes ago
		await db.execute(`
			UPDATE sync_queue
			SET "updatedAt" = NOW() - INTERVAL '10 minutes'
			WHERE "gmailId" = 'stuck1'
		`);

		const reset = await resetStuckSyncingItems(db, TEST_USER_ID);
		expect(reset).toBe(1);

		const pending = await getPendingSyncItems(db, TEST_USER_ID);
		expect(pending).toHaveLength(1);
	});
});

describe("Batch Operations", () => {
	test("markEmailsArchived archives multiple emails", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_archive1",
				labels: ["INBOX"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_archive2",
				labels: ["INBOX"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		await markEmailsArchived(
			db,
			emails.map((e) => e.id)
		);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated.every((e) => e.archived)).toBe(true);
	});

	test("markEmailsRead marks multiple as read", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_read1",
				labels: ["INBOX", "UNREAD"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_read2",
				labels: ["INBOX", "UNREAD"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		await markEmailsRead(
			db,
			emails.map((e) => e.id)
		);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated.every((e) => !e.unread)).toBe(true);
	});

	test("markEmailsUnread marks multiple as unread", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_unread1",
				labels: ["INBOX"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_unread2",
				labels: ["INBOX"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);
		await markEmailsUnread(
			db,
			emails.map((e) => e.id)
		);

		const updated = await findEmailsByUserId(db, TEST_USER_ID);
		expect(updated.every((e) => e.unread)).toBe(true);
	});

	test("markLabelsApplied updates multiple classifications", async () => {
		await upsertEmails(db, [
			{
				accountId: TEST_ACCOUNT_ID,
				body: "1",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_label1",
				labels: ["INBOX"],
				snippet: "1",
				subject: "1",
				threadId: "t1",
				to: "to@test.com",
				userId: TEST_USER_ID
			},
			{
				accountId: TEST_ACCOUNT_ID,
				body: "2",
				date: new Date(),
				from: "from@test.com",
				gmailId: "batch_label2",
				labels: ["INBOX"],
				snippet: "2",
				subject: "2",
				threadId: "t2",
				to: "to@test.com",
				userId: TEST_USER_ID
			}
		]);

		const emails = await findEmailsByUserId(db, TEST_USER_ID);

		for (const email of emails) {
			await upsertEmailClassification(db, {
				accountId: TEST_ACCOUNT_ID,
				classifierId: "clf_1",
				classifierName: "Test",
				confidence: 0.9,
				emailId: email.id,
				gmailId: email.gmailId,
				labelApplied: false,
				labelName: "Test",
				reasoning: "",
				userId: TEST_USER_ID
			});
		}

		await markLabelsApplied(
			db,
			emails.map((e) => e.id)
		);

		const classifications = await findClassificationsByEmailIds(
			db,
			emails.map((e) => e.id)
		);
		expect(
			Array.from(classifications.values()).every((c) => c.labelApplied)
		).toBe(true);
	});
});

describe("Constants", () => {
	test("NO_MATCH constants are defined", () => {
		expect(NO_MATCH_CLASSIFIER_ID).toBe("__NO_MATCH__");
		expect(NO_MATCH_CLASSIFIER_NAME).toBe("No Match");
	});
});
