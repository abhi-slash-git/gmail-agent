#!/usr/bin/env bun

import { render } from "ink";
import {
	closeDatabase,
	type Database,
	getDatabase
} from "./src/database/connection.js";
import { getEnv } from "./src/env.js";
import { App } from "./src/ui/App.js";

const VERSION = "1.0.0";

const commands = {
	auth: () => import("./src/cli/commands/auth.js"),
	classifier: () => import("./src/cli/commands/classifier.js"),
	classify: () => import("./src/cli/commands/classify.js"),
	sync: () => import("./src/cli/commands/sync.js")
};

async function bootstrap(): Promise<Database> {
	const env = getEnv();
	console.log("Initializing database...");
	const db = await getDatabase(env.DATABASE_URL);
	console.log("Database ready.");
	return db;
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	const subArgs = args.slice(1);

	// Help command (no db needed)
	if (command === "help" || command === "--help" || command === "-h") {
		printHelp();
		return;
	}

	// Version command (no db needed)
	if (command === "version" || command === "--version" || command === "-v") {
		console.log(`gmail-agent v${VERSION}`);
		return;
	}

	// Bootstrap database first
	let db: Database;
	try {
		db = await bootstrap();
	} catch (error) {
		console.error("Failed to initialize database:", error);
		process.exit(1);
	}

	// If no command or explicit UI command, launch the TUI
	if (!command || command === "ui") {
		// Clear the bootstrap messages before starting UI
		console.clear();
		const { waitUntilExit } = render(
			<App db={db} onExit={() => process.exit(0)} />
		);
		await waitUntilExit();
		return;
	}

	// CLI mode for specific commands
	if (!(command in commands)) {
		console.error(`Unknown command: ${command}`);
		console.log("");
		printHelp();
		await closeDatabase();
		process.exit(1);
	}

	try {
		const commandModule = await commands[command as keyof typeof commands]();
		await commandModule.default(subArgs);
	} finally {
		await closeDatabase();
	}
}

function printHelp() {
	console.log(`
gmail-agent - AI-powered email classification

Usage:
  gmail-agent              Launch interactive TUI
  gmail-agent <command>    Run a specific command

Commands:
  (no command)    Launch interactive terminal UI
  ui              Launch interactive terminal UI

  auth            Manage Gmail authentication
    login         Connect Gmail account via OAuth
    logout        Disconnect Gmail account
    status        Show current authentication status

  classifier      Manage email classifiers
    add           Add a new email classifier
    list          List all classifiers
    remove        Remove a classifier
    enable        Enable a classifier
    disable       Disable a classifier

  classify        Run classification on locally synced emails (saves locally)
    --max-emails <n>   Maximum emails to process (default: 50)
    -f, --force        Reclassify emails even if already classified

  sync            Sync emails from Gmail to local database
    --max-emails <n>   Maximum emails to sync (default: 500)
    -q, --query <q>    Gmail search query

Options:
  --help, -h      Show this help message
  --version, -v   Show version number

Examples:
  # Launch interactive UI
  gmail-agent

  # CLI: Connect Gmail account
  gmail-agent auth login

  # CLI: Add classifiers
  gmail-agent classifier add -n "Jobs" -d "Job applications, recruiter emails" -l "Jobs"

  # CLI: Run classification
  gmail-agent classify --max-emails 100

Environment Variables:
  GOOGLE_CLIENT_ID      Google OAuth client ID (required)
  GOOGLE_CLIENT_SECRET  Google OAuth client secret (required)
  ANTHROPIC_API_KEY     Anthropic API key for AI classification (required)
  DATABASE_URL          Path to database directory (default: ~/.gmail-agent/data)
  USER_ID               User identifier (default: "default_user")
`);
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
