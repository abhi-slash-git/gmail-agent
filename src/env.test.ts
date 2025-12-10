import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { EnvValidationError, getEnv, parseEnv, resetEnv } from "./env";

const validEnv = {
	AMAZON_BEDROCK_ACCESS_KEY_ID: "test-access-key",
	AMAZON_BEDROCK_REGION: "us-east-1",
	AMAZON_BEDROCK_SECRET_ACCESS_KEY: "test-secret-key",
	GOOGLE_CLIENT_ID: "test-client-id",
	GOOGLE_CLIENT_SECRET: "test-client-secret"
};

describe("parseEnv", () => {
	afterEach(() => {
		resetEnv();
	});

	test("parses valid environment variables", () => {
		const result = parseEnv(validEnv);

		expect(result.AMAZON_BEDROCK_ACCESS_KEY_ID).toBe("test-access-key");
		expect(result.AMAZON_BEDROCK_REGION).toBe("us-east-1");
		expect(result.AMAZON_BEDROCK_SECRET_ACCESS_KEY).toBe("test-secret-key");
		expect(result.GOOGLE_CLIENT_ID).toBe("test-client-id");
		expect(result.GOOGLE_CLIENT_SECRET).toBe("test-client-secret");
	});

	test("applies default values", () => {
		const result = parseEnv(validEnv);

		expect(result.DATABASE_URL).toBe(join(homedir(), ".gmail-agent", "data"));
		expect(result.USER_ID).toBe("default_user");
	});

	test("allows overriding default values", () => {
		const result = parseEnv({
			...validEnv,
			DATABASE_URL: "/custom/db/path",
			USER_ID: "custom_user"
		});

		expect(result.DATABASE_URL).toBe("/custom/db/path");
		expect(result.USER_ID).toBe("custom_user");
	});

	test("throws EnvValidationError for missing required variables", () => {
		expect(() => parseEnv({})).toThrow(EnvValidationError);
	});

	test("includes all missing variables in error", () => {
		try {
			parseEnv({});
		} catch (error) {
			expect(error).toBeInstanceOf(EnvValidationError);
			const envError = error as EnvValidationError;
			const paths = envError.issues.map((i) => i.path);
			expect(paths).toContain("AMAZON_BEDROCK_ACCESS_KEY_ID");
			expect(paths).toContain("AMAZON_BEDROCK_REGION");
			expect(paths).toContain("AMAZON_BEDROCK_SECRET_ACCESS_KEY");
			expect(paths).toContain("GOOGLE_CLIENT_ID");
			expect(paths).toContain("GOOGLE_CLIENT_SECRET");
		}
	});

	test("throws for partial env", () => {
		expect(() =>
			parseEnv({
				AMAZON_BEDROCK_ACCESS_KEY_ID: "test"
			})
		).toThrow(EnvValidationError);
	});
});

describe("EnvValidationError", () => {
	test("has correct name", () => {
		const error = new EnvValidationError([
			{ message: "required", path: "TEST" }
		]);
		expect(error.name).toBe("EnvValidationError");
	});

	test("includes paths in message", () => {
		const error = new EnvValidationError([
			{ message: "required", path: "VAR1" },
			{ message: "required", path: "VAR2" }
		]);
		expect(error.message).toContain("VAR1");
		expect(error.message).toContain("VAR2");
	});

	test("exposes issues array", () => {
		const issues = [
			{ message: "required", path: "VAR1" },
			{ message: "invalid", path: "VAR2" }
		];
		const error = new EnvValidationError(issues);
		expect(error.issues).toEqual(issues);
	});
});

describe("getEnv", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		resetEnv();
	});

	afterEach(() => {
		// Restore original env
		process.env = { ...originalEnv };
		resetEnv();
	});

	test("returns cached env on second call", () => {
		// Set valid env vars
		process.env = {
			...process.env,
			...validEnv
		};

		const env1 = getEnv();
		const env2 = getEnv();

		expect(env1).toBe(env2); // Same object reference
	});

	test("parses process.env successfully with valid vars", () => {
		process.env = {
			...process.env,
			...validEnv
		};

		const env = getEnv();

		expect(env.AMAZON_BEDROCK_ACCESS_KEY_ID).toBe("test-access-key");
		expect(env.GOOGLE_CLIENT_ID).toBe("test-client-id");
	});
});

describe("resetEnv", () => {
	test("clears cached env", () => {
		const originalEnv = { ...process.env };
		process.env = { ...process.env, ...validEnv };

		const env1 = getEnv();
		resetEnv();

		// After reset, getEnv should re-parse
		const env2 = getEnv();

		// Restore
		process.env = originalEnv;
		resetEnv();

		// They should be equal in value but could be different objects
		expect(env1.AMAZON_BEDROCK_ACCESS_KEY_ID).toBe(
			env2.AMAZON_BEDROCK_ACCESS_KEY_ID
		);
	});
});
