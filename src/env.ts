import { homedir } from "node:os";
import { join } from "node:path";
import invariant from "tiny-invariant";
import { z } from "zod";

const defaultDbPath = join(homedir(), ".gmail-agent", "data");

const EnvSchema = z.object({
	// AWS Bedrock Configuration (Required for AI classification)
	AMAZON_BEDROCK_ACCESS_KEY_ID: z.string(),
	AMAZON_BEDROCK_REGION: z.string(),
	AMAZON_BEDROCK_SECRET_ACCESS_KEY: z.string(),

	// Database connection (defaults to ~/.gmail-agent/data)
	DATABASE_URL: z.string().default(defaultDbPath),

	// Google OAuth credentials
	GOOGLE_CLIENT_ID: z.string(),
	GOOGLE_CLIENT_SECRET: z.string(),

	// User identification (for multi-user support)
	USER_ID: z.string().default("default_user")
});

export type GmailAgentEnv = z.infer<typeof EnvSchema>;

let _env: GmailAgentEnv;

export function getEnv(): GmailAgentEnv {
	if (_env) {
		return _env;
	}

	const parsed = EnvSchema.safeParse(process.env);

	if (!parsed.success) {
		console.error("Missing environment variables:");
		for (const issue of parsed.error.issues) {
			console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
		}
		process.exit(1);
	}

	invariant(parsed.data, "Invalid environment variables");

	_env = parsed.data;
	return _env;
}
