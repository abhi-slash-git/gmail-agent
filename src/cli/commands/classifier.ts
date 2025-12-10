import { parseArgs } from "node:util";
import {
	createClassifier,
	deleteClassifier,
	findClassifiersByUserId,
	getDatabase,
	updateClassifier
} from "../../database/connection";
import { getEnv } from "../../env";

export default async function classifier(args: string[]) {
	const subcommand = args[0];
	const subArgs = args.slice(1);

	switch (subcommand) {
		case "add":
			await add(subArgs);
			break;
		case "list":
			await list();
			break;
		case "remove":
			await remove(subArgs);
			break;
		case "enable":
			await toggle(subArgs, true);
			break;
		case "disable":
			await toggle(subArgs, false);
			break;
		default:
			printHelp();
	}
}

function printHelp() {
	console.log("Usage: gmail-agent classifier <command> [options]");
	console.log("");
	console.log("Commands:");
	console.log("  add       Add a new email classifier");
	console.log("  list      List all classifiers");
	console.log("  remove    Remove a classifier");
	console.log("  enable    Enable a classifier");
	console.log("  disable   Disable a classifier");
	console.log("");
	console.log("Examples:");
	console.log(
		'  gmail-agent classifier add -n "Jobs" -d "Job applications and recruiter emails" -l "Jobs"'
	);
	console.log("  gmail-agent classifier list");
	console.log("  gmail-agent classifier remove --id clf_abc123");
}

async function add(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			description: { short: "d", type: "string" },
			label: { short: "l", type: "string" },
			name: { short: "n", type: "string" },
			priority: { short: "p", type: "string" }
		}
	});

	if (!values.name || !values.description || !values.label) {
		console.error("Error: Missing required options");
		console.log("");
		console.log("Usage: gmail-agent classifier add [options]");
		console.log("");
		console.log("Required options:");
		console.log(
			"  -n, --name <name>              Classifier name (e.g., 'Jobs')"
		);
		console.log(
			"  -d, --description <desc>       Natural language description for AI classification"
		);
		console.log(
			"  -l, --label <label>            Gmail label to apply when matched"
		);
		console.log("");
		console.log("Optional:");
		console.log(
			"  -p, --priority <number>        Priority (higher runs first, default: 0)"
		);
		console.log("");
		console.log("Example:");
		console.log(
			'  gmail-agent classifier add -n "Jobs" -d "Job applications, recruiter emails, interview scheduling" -l "Jobs"'
		);
		process.exit(1);
	}

	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const created = await createClassifier(db, {
		description: values.description,
		labelName: values.label,
		name: values.name,
		priority: values.priority ? parseInt(values.priority, 10) : 0,
		userId: env.USER_ID
	});

	if (!created) {
		console.error("Failed to create classifier");
		process.exit(1);
	}

	console.log("✓ Classifier created successfully!");
	console.log("");
	console.log(`  ID:          ${created.id}`);
	console.log(`  Name:        ${created.name}`);
	console.log(`  Description: ${created.description}`);
	console.log(`  Gmail Label: ${created.labelName}`);
	console.log(`  Priority:    ${created.priority}`);
	console.log(`  Enabled:     ${created.enabled ? "Yes" : "No"}`);
}

async function list() {
	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const classifiers = await findClassifiersByUserId(db, env.USER_ID);

	if (classifiers.length === 0) {
		console.log("No classifiers configured.");
		console.log("");
		console.log(
			'Run "gmail-agent classifier add" to create your first classifier.'
		);
		return;
	}

	console.log(`Found ${classifiers.length} classifier(s):\n`);

	for (const c of classifiers) {
		const status = c.enabled ? "✓" : "○";
		console.log(`${status} ${c.name}`);
		console.log(`  ID:          ${c.id}`);
		console.log(`  Description: ${c.description}`);
		console.log(`  Gmail Label: ${c.labelName}`);
		console.log(`  Priority:    ${c.priority}`);
		console.log(`  Enabled:     ${c.enabled ? "Yes" : "No"}`);
		console.log("");
	}
}

async function remove(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			id: { type: "string" }
		}
	});

	if (!values.id) {
		console.error("Error: --id is required");
		console.log("");
		console.log("Usage: gmail-agent classifier remove --id <classifier_id>");
		console.log("");
		console.log('Run "gmail-agent classifier list" to see all classifier IDs.');
		process.exit(1);
	}

	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const deleted = await deleteClassifier(db, env.USER_ID, values.id);

	if (deleted) {
		console.log(`✓ Classifier ${values.id} removed.`);
	} else {
		console.error("Classifier not found or could not be deleted.");
		process.exit(1);
	}
}

async function toggle(args: string[], enabled: boolean) {
	const { values } = parseArgs({
		args,
		options: {
			id: { type: "string" }
		}
	});

	if (!values.id) {
		console.error("Error: --id is required");
		console.log("");
		console.log(
			`Usage: gmail-agent classifier ${enabled ? "enable" : "disable"} --id <classifier_id>`
		);
		console.log("");
		console.log('Run "gmail-agent classifier list" to see all classifier IDs.');
		process.exit(1);
	}

	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const updated = await updateClassifier(db, env.USER_ID, values.id, {
		enabled
	});

	if (updated) {
		console.log(
			`✓ Classifier ${values.id} ${enabled ? "enabled" : "disabled"}.`
		);
	} else {
		console.error("Classifier not found or could not be updated.");
		process.exit(1);
	}
}
