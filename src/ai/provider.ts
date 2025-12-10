import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { getEnv } from "../env.js";

// Lazy initialization of the Bedrock provider
let _bedrock: ReturnType<typeof createAmazonBedrock> | null = null;

export function getBedrock() {
	if (!_bedrock) {
		const env = getEnv();
		_bedrock = createAmazonBedrock({
			accessKeyId: env.AMAZON_BEDROCK_ACCESS_KEY_ID,
			region: env.AMAZON_BEDROCK_REGION,
			secretAccessKey: env.AMAZON_BEDROCK_SECRET_ACCESS_KEY
		});
	}
	return _bedrock;
}

// Model configurations - using the same Claude models via Bedrock
export const MODELS = {
	// Fast model for classification
	haiku: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
	// Most capable model
	opus: "global.anthropic.claude-opus-4-5-20251101-v1:0",
	// More capable model if needed
	sonnet: "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
} as const;

// Get a configured model instance
export function getModel(modelName: keyof typeof MODELS = "haiku") {
	const bedrock = getBedrock();
	return bedrock(MODELS[modelName]);
}
