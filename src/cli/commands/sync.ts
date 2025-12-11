import { parseArgs } from "node:util";
import {
	countEmailsByUserId,
	getAccountId,
	getDatabase,
	getLatestEmailDate,
	upsertEmails
} from "../../database/connection";
import { getEnv } from "../../env";
import { GmailClient } from "../../gmail/client";
import { ensureValidToken } from "./auth";

export default async function sync(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"max-emails": { default: "500", type: "string" },
			new: { default: false, short: "n", type: "boolean" },
			query: { short: "q", type: "string" }
		}
	});

	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	// Ensure we have a valid Gmail token
	let accessToken: string;
	try {
		accessToken = await ensureValidToken();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}

	const gmail = new GmailClient(accessToken);

	// Get accountId for foreign key
	const accountId = await getAccountId(db, env.USER_ID);
	if (!accountId) {
		console.error("No account found. Run 'gmail-agent auth connect' first.");
		process.exit(1);
	}

	const maxEmails = parseInt(values["max-emails"] ?? "500", 10);
	const syncNew = values.new;
	let query = values.query ?? "";

	// If --new flag is set, get the latest email date and build query
	let afterDate: Date | null = null;
	if (syncNew) {
		afterDate = await getLatestEmailDate(db, env.USER_ID);
		if (afterDate) {
			// Add 1 second to avoid re-fetching the same email
			const afterTimestamp = Math.floor(afterDate.getTime() / 1000) + 1;
			const dateQuery = `after:${afterTimestamp}`;
			query = query ? `${query} ${dateQuery}` : dateQuery;
			console.log(`Syncing emails newer than ${afterDate.toLocaleString()}...`);
		} else {
			console.log("No existing emails found. Syncing recent emails...");
		}
	} else {
		console.log(`Syncing up to ${maxEmails} emails from Gmail...`);
	}

	if (query && !syncNew) {
		console.log(`Query: "${query}"`);
	}
	console.log("");

	const startTime = Date.now();
	const beforeCount = await countEmailsByUserId(db, env.USER_ID);

	// Fetch emails from Gmail
	const emails = await gmail.listEmails({
		maxResults: maxEmails,
		query: query || undefined
	});

	if (emails.length === 0) {
		console.log("No emails found matching the query.");
		return;
	}

	console.log(`Found ${emails.length} email(s) to sync.`);
	console.log("");

	// Convert Gmail emails to database format and upsert
	const emailsToUpsert = emails.map((e) => ({
		accountId,
		body: e.body,
		date: e.date,
		from: e.from,
		gmailId: e.id,
		labels: e.labels,
		snippet: e.snippet,
		subject: e.subject,
		threadId: e.threadId,
		to: e.to,
		userId: env.USER_ID
	}));

	let synced = 0;
	const batchSize = 50;

	for (let i = 0; i < emailsToUpsert.length; i += batchSize) {
		const batch = emailsToUpsert.slice(i, i + batchSize);
		const count = await upsertEmails(db, batch);
		synced += count;

		const progress = Math.min(i + batchSize, emailsToUpsert.length);
		process.stdout.write(`\rSyncing... ${progress}/${emailsToUpsert.length}`);
	}

	console.log("");
	console.log("");

	const afterCount = await countEmailsByUserId(db, env.USER_ID);
	const newEmails = afterCount - beforeCount;
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

	console.log("─".repeat(50));
	console.log("Sync complete!");
	console.log(`  Processed: ${emails.length} email(s)`);
	console.log(`  New:       ${newEmails} email(s)`);
	console.log(`  Updated:   ${synced - newEmails} email(s)`);
	console.log(`  Total:     ${afterCount} email(s) in database`);
	console.log(`  Time:      ${elapsed}s`);
}
