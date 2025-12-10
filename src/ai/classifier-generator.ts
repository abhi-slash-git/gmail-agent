import { generateObject } from "ai";
import { z } from "zod";
import { withRetry } from "../utils/retry.js";
import { getModel } from "./provider.js";

const classifierSchema = z.object({
	description: z
		.string()
		.describe(
			"Detailed description of what emails this classifier should match. Be specific about sender patterns, subject keywords, content patterns, etc."
		),
	labelName: z
		.string()
		.describe(
			"Gmail label name to apply (should be same as or similar to name, e.g., 'Jobs', 'Newsletters', 'Receipts')"
		),
	name: z
		.string()
		.describe(
			"Short, concise name for the classifier (1-3 words, e.g., 'Jobs', 'Newsletters', 'Receipts')"
		),
	priority: z
		.number()
		.describe(
			"Priority level 0-10, higher = checked first. Use higher priority for more specific classifiers."
		)
});

export type GeneratedClassifier = z.infer<typeof classifierSchema>;

export async function generateClassifierFromPrompt(
	prompt: string
): Promise<GeneratedClassifier> {
	const { result } = await withRetry(
		() =>
			generateObject({
				model: getModel("haiku"),
				prompt: `You are an email classification expert. Based on the user's request, generate a classifier configuration for automatically categorizing emails.

User request: "${prompt}"

Generate a classifier that:
1. Has a short, clear name (1-3 words)
2. Has a detailed description that captures the intent - include specific patterns like sender domains, subject keywords, or content indicators that would identify matching emails
3. Has an appropriate Gmail label name (usually same as the name)
4. Has an appropriate priority (0 = lowest, 10 = highest; use higher for more specific classifiers)

Be specific in the description so the AI can accurately classify emails. For example:
- Instead of "marketing emails", say "Marketing emails including promotional offers, sales announcements, product launches, and newsletters from companies"
- Instead of "job emails", say "Job-related emails including job applications, recruiter outreach, interview scheduling, offer letters, and communications from job boards like LinkedIn, Indeed, or Glassdoor"`,
				schema: classifierSchema
			}),
		{ maxRetries: 3 }
	);

	return result.object;
}
