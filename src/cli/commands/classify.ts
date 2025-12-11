import { parseArgs } from "node:util";
import { classifyEmailsParallel } from "../../ai/parallel-classifier";
import {
	countEmailsByUserId,
	createClassificationRun,
	findClassifiersByUserId,
	findEmailsByUserId,
	findUnclassifiedEmails,
	getAccountId,
	getDatabase,
	getUserProfile,
	NO_MATCH_CLASSIFIER_ID,
	NO_MATCH_CLASSIFIER_NAME,
	updateClassificationRun,
	upsertEmailClassification
} from "../../database/connection";
import { getEnv } from "../../env";

export default async function classify(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			force: { default: false, short: "f", type: "boolean" },
			"max-emails": { default: "50", type: "string" }
		}
	});

	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	// Get enabled classifiers
	const classifiers = await findClassifiersByUserId(db, env.USER_ID);
	const enabledClassifiers = classifiers.filter((c) => c.enabled);

	if (enabledClassifiers.length === 0) {
		console.error("No classifiers configured or enabled.");
		console.log("");
		console.log('Run "gmail-agent classifier add" to create a classifier.');
		process.exit(1);
	}

	console.log(`Found ${enabledClassifiers.length} active classifier(s):`);
	for (const c of enabledClassifiers) {
		console.log(`  • ${c.name} → "${c.labelName}"`);
	}
	console.log("");

	// Check if we have any synced emails
	const totalEmails = await countEmailsByUserId(db, env.USER_ID);
	if (totalEmails === 0) {
		console.error("No emails synced. Run 'gmail-agent sync' first.");
		process.exit(1);
	}

	// Get accountId for foreign key
	const accountId = await getAccountId(db, env.USER_ID);
	if (!accountId) {
		console.error("No account found. Run 'gmail-agent auth connect' first.");
		process.exit(1);
	}

	// Create classification run record
	const run = await createClassificationRun(db, {
		accountId,
		status: "running",
		userId: env.USER_ID
	});

	if (!run) {
		console.error("Failed to create classification run record.");
		process.exit(1);
	}

	try {
		const maxEmails = parseInt(values["max-emails"] ?? "50", 10);

		// Fetch emails - use efficient query when not forcing reclassification
		// Always exclude sent emails from classification
		console.log(`Loading emails from local database...`);
		const emails = values.force
			? await findEmailsByUserId(db, env.USER_ID, {
					excludeSent: true,
					limit: maxEmails
				})
			: await findUnclassifiedEmails(db, env.USER_ID, { limit: maxEmails });

		if (emails.length === 0) {
			console.log(
				values.force
					? "No emails in database."
					: "All emails have already been classified."
			);
			await updateClassificationRun(db, run.id, {
				completedAt: new Date(),
				emailsClassified: 0,
				emailsProcessed: 0,
				status: "completed"
			});
			return;
		}

		console.log(`Classifying ${emails.length} email(s).\n`);

		// Transform DB emails to classifier input format
		const emailInputs = emails.map((e) => ({
			body: e.body,
			date: e.date,
			from: e.from,
			id: e.gmailId,
			snippet: e.snippet,
			subject: e.subject
		}));

		// Get user profile for context
		const userProfile = await getUserProfile(db, env.USER_ID);

		// Run AI classification
		console.log("Running AI classification...");
		let lastReported = 0;
		const results = await classifyEmailsParallel(
			emailInputs,
			enabledClassifiers,
			{
				onBatchComplete: (completed, total) => {
					if (completed > lastReported) {
						process.stdout.write(
							`\rClassifying... ${completed}/${total} emails`
						);
						lastReported = completed;
					}
				},
				userContext: userProfile ?? undefined
			}
		);
		console.log("\n");

		// Process results - save locally only, don't apply Gmail labels
		let classified = 0;
		let noMatch = 0;

		for (const result of results) {
			// Find email by gmailId (which was used as id in classifier input)
			const email = emails.find((e) => e.gmailId === result.emailId);
			if (!email) continue;

			if (result.classifierId && result.confidence >= 0.7) {
				const classifier = enabledClassifiers.find(
					(c) => c.id === result.classifierId
				);

				if (classifier) {
					const confidencePercent = (result.confidence * 100).toFixed(0);
					const subject = email.subject || "(no subject)";
					const truncatedSubject =
						subject.length > 50 ? `${subject.slice(0, 47)}...` : subject;

					console.log(`[${confidencePercent}%] "${truncatedSubject}"`);
					console.log(
						`       → ${classifier.name} (label: "${classifier.labelName}")`
					);
					console.log("");

					// Save the classification to database (labelApplied = false)
					await upsertEmailClassification(db, {
						accountId,
						classifierId: classifier.id,
						classifierName: classifier.name,
						confidence: result.confidence,
						emailId: email.id,
						gmailId: email.gmailId,
						labelApplied: false,
						labelName: classifier.labelName,
						reasoning: "",
						runId: run.id,
						userId: env.USER_ID
					});

					classified++;
				}
			} else {
				// Save "no match" record to prevent re-processing
				await upsertEmailClassification(db, {
					accountId,
					classifierId: NO_MATCH_CLASSIFIER_ID,
					classifierName: NO_MATCH_CLASSIFIER_NAME,
					confidence: 0,
					emailId: email.id,
					gmailId: email.gmailId,
					labelApplied: false,
					labelName: "",
					reasoning: "",
					runId: run.id,
					userId: env.USER_ID
				});
				noMatch++;
			}
		}

		// Update run record
		await updateClassificationRun(db, run.id, {
			completedAt: new Date(),
			emailsClassified: classified,
			emailsProcessed: emails.length,
			status: "completed"
		});

		// Summary
		console.log("─".repeat(50));
		console.log("Classification complete! (saved locally)");
		console.log(`  Processed:    ${emails.length} email(s)`);
		console.log(`  Classified:   ${classified} email(s)`);
		console.log(`  No match:     ${noMatch} email(s)`);
	} catch (error) {
		await updateClassificationRun(db, run.id, {
			completedAt: new Date(),
			status: "failed"
		});
		console.error("\nClassification failed:");
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
