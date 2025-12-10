import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resetEnv } from "../env";

// Mock the env module
mock.module("../env.js", () => ({
	getEnv: () => ({
		AMAZON_BEDROCK_ACCESS_KEY_ID: "test-key",
		AMAZON_BEDROCK_REGION: "us-east-1",
		AMAZON_BEDROCK_SECRET_ACCESS_KEY: "test-secret",
		DATABASE_URL: "/tmp/test",
		GOOGLE_CLIENT_ID: "test-client",
		GOOGLE_CLIENT_SECRET: "test-secret",
		USER_ID: "test-user"
	})
}));

// Mock the AI SDK
const mockBedrockProvider = mock(() => "mocked-model");
mock.module("@ai-sdk/amazon-bedrock", () => ({
	createAmazonBedrock: mock(() => mockBedrockProvider)
}));

describe("AI Provider", () => {
	beforeEach(() => {
		resetEnv();
	});

	test("MODELS contains correct model IDs", async () => {
		// Import after mocks are set up
		const { MODELS } = await import("./provider");

		expect(MODELS.haiku).toBe(
			"global.anthropic.claude-haiku-4-5-20251001-v1:0"
		);
		expect(MODELS.sonnet).toBe(
			"global.anthropic.claude-sonnet-4-5-20250929-v1:0"
		);
		expect(MODELS.opus).toBe("global.anthropic.claude-opus-4-5-20251101-v1:0");
	});

	test("getBedrock creates provider with credentials", async () => {
		const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
		const { getBedrock } = await import("./provider");

		getBedrock();

		expect(createAmazonBedrock).toHaveBeenCalledWith({
			accessKeyId: "test-key",
			region: "us-east-1",
			secretAccessKey: "test-secret"
		});
	});

	test("getModel returns model instance", async () => {
		const { getModel } = await import("./provider");

		const model = getModel("haiku");
		expect(model).toBeDefined();
	});

	test("getModel defaults to haiku", async () => {
		const { getModel } = await import("./provider");

		const model = getModel();
		expect(model).toBeDefined();
		expect(mockBedrockProvider).toHaveBeenCalledWith(
			"global.anthropic.claude-haiku-4-5-20251001-v1:0"
		);
	});
});
