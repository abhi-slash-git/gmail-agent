import { homedir } from "node:os";
import { join } from "node:path";
import invariant from "tiny-invariant";
import { z } from "zod";

const defaultDbPath = join(homedir(), ".gmail-agent", "data");

export const EnvSchema = z.object({
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

let _env: GmailAgentEnv | null = null;

export class EnvValidationError extends Error {
	constructor(public issues: Array<{ path: string; message: string }>) {
		super(
			`Missing environment variables: ${issues.map((i) => i.path).join(", ")}`
		);
		this.name = "EnvValidationError";
	}
}

export function parseEnv(
	env: Record<string, string | undefined>
): GmailAgentEnv {
	const parsed = EnvSchema.safeParse(env);

	if (!parsed.success) {
		throw new EnvValidationError(
			parsed.error.issues.map((issue) => ({
				message: issue.message,
				path: issue.path.join(".")
			}))
		);
	}

	invariant(parsed.data, "Invalid environment variables");
	return parsed.data;
}

export function getEnv(): GmailAgentEnv {
	if (_env) {
		return _env;
	}

	try {
		_env = parseEnv(process.env);
		return _env;
	} catch (error) {
		if (error instanceof EnvValidationError) {
			console.error("Missing environment variables:");
			for (const issue of error.issues) {
				console.error(`  - ${issue.path}: ${issue.message}`);
			}
			process.exit(1);
		}
		throw error;
	}
}

export function resetEnv(): void {
	_env = null;
}
