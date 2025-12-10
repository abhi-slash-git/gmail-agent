import {
	deleteGmailTokens,
	getDatabase,
	getGmailTokens,
	getUserProfile,
	saveGmailTokens,
	saveUserProfile
} from "../../database/connection";
import { getEnv } from "../../env";
import { GmailClient } from "../../gmail/client";
import { refreshAccessToken, startOAuthFlow } from "../../gmail/oauth";

export default async function auth(args: string[]) {
	const subcommand = args[0];

	switch (subcommand) {
		case "login":
			await login();
			break;
		case "logout":
			await logout();
			break;
		case "status":
			await status();
			break;
		default:
			console.log("Usage: gmail-agent auth <login|logout|status>");
			console.log("");
			console.log("Commands:");
			console.log("  login   Connect your Gmail account via OAuth");
			console.log("  logout  Disconnect your Gmail account");
			console.log("  status  Show current authentication status");
	}
}

async function login() {
	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	// Check if already logged in
	const existingTokens = await getGmailTokens(db, env.USER_ID);
	if (existingTokens) {
		console.log("You are already logged in to Gmail.");
		console.log('Run "gmail-agent auth logout" first to disconnect.');
		return;
	}

	console.log("Starting Gmail OAuth flow...\n");

	try {
		const tokens = await startOAuthFlow({
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET
		});

		await saveGmailTokens(db, env.USER_ID, {
			accessToken: tokens.accessToken,
			expiresAt: tokens.expiresAt,
			refreshToken: tokens.refreshToken
		});

		// Fetch and save user profile
		console.log("Fetching user profile...");
		const gmail = new GmailClient(tokens.accessToken);
		const profile = await gmail.getProfile();
		await saveUserProfile(db, env.USER_ID, profile);

		console.log(`\n✓ Gmail account connected successfully!`);
		if (profile.email) {
			console.log(
				`  Logged in as: ${profile.name ? `${profile.name} <${profile.email}>` : profile.email}`
			);
		}
		console.log(
			'Run "gmail-agent classifier add" to create your first classifier.'
		);
	} catch (error) {
		console.error("\n✗ Failed to connect Gmail account:");
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

async function logout() {
	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const existingTokens = await getGmailTokens(db, env.USER_ID);
	if (!existingTokens) {
		console.log("You are not logged in to Gmail.");
		return;
	}

	await deleteGmailTokens(db, env.USER_ID);
	console.log("✓ Gmail account disconnected.");
}

async function status() {
	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const tokens = await getGmailTokens(db, env.USER_ID);

	if (!tokens) {
		console.log("Gmail: Not connected");
		console.log("");
		console.log('Run "gmail-agent auth login" to connect your account.');
		return;
	}

	const isExpired = tokens.expiresAt && tokens.expiresAt < new Date();
	const profile = await getUserProfile(db, env.USER_ID);

	console.log("Gmail: Connected");
	if (profile?.email) {
		console.log(
			`Account: ${profile.name ? `${profile.name} <${profile.email}>` : profile.email}`
		);
	}
	console.log(
		`Token status: ${isExpired ? "Expired (will refresh automatically)" : "Valid"}`
	);

	if (tokens.expiresAt) {
		console.log(`Expires: ${tokens.expiresAt.toLocaleString()}`);
	}
}

export interface EnsureValidTokenOptions {
	silent?: boolean;
}

export async function ensureValidToken(
	options: EnsureValidTokenOptions = {}
): Promise<string> {
	const env = getEnv();
	const db = await getDatabase(env.DATABASE_URL);

	const tokens = await getGmailTokens(db, env.USER_ID);
	if (!tokens) {
		throw new Error('Gmail not connected. Run "gmail-agent auth login" first.');
	}

	// Check if token is expired or about to expire (within 5 minutes)
	const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
	const isExpiredOrExpiring =
		tokens.expiresAt && tokens.expiresAt < fiveMinutesFromNow;

	if (isExpiredOrExpiring) {
		if (!options.silent) {
			console.log("Refreshing access token...");
		}
		const newTokens = await refreshAccessToken({
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
			refreshToken: tokens.refreshToken
		});

		await saveGmailTokens(db, env.USER_ID, {
			accessToken: newTokens.accessToken,
			expiresAt: newTokens.expiresAt,
			refreshToken: tokens.refreshToken
		});

		return newTokens.accessToken;
	}

	return tokens.accessToken;
}
