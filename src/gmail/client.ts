import { type gmail_v1, google } from "googleapis";
import invariant from "tiny-invariant";
import TurndownService from "turndown";
import { withRetry } from "../utils/retry.js";

const turndown = new TurndownService({
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
	headingStyle: "atx"
});

// Remove tables, images, and other layout elements that don't render well
turndown.remove(["table", "style", "script", "img", "figure", "picture"]);

// Clean up the converted markdown
function cleanMarkdown(md: string): string {
	return (
		md
			// Remove excessive newlines
			.replace(/\n{3,}/g, "\n\n")
			// Remove lines that are only whitespace or special chars
			.replace(/^\s*[│┌┐└┘├┤┬┴┼─|]+\s*$/gm, "")
			// Remove empty links
			.replace(/\[\s*\]\([^)]*\)/g, "")
			// Remove image placeholders
			.replace(/!\[\s*\]\([^)]*\)/g, "")
			// Clean up multiple spaces
			.replace(/[ \t]+/g, " ")
			// Trim lines
			.split("\n")
			.map((line) => line.trim())
			.join("\n")
			// Remove excessive newlines again after cleanup
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

export interface Email {
	id: string;
	threadId: string;
	subject: string;
	from: string;
	to: string;
	date: Date;
	snippet: string;
	body: string;
	labels: string[];
}

export interface ListEmailsOptions {
	maxResults?: number;
	query?: string;
	labelIds?: string[];
}

export interface UserProfile {
	email: string;
	name: string | null;
}

export class GmailClient {
	private gmail: gmail_v1.Gmail;
	private auth: InstanceType<typeof google.auth.OAuth2>;

	constructor(accessToken: string) {
		const auth = new google.auth.OAuth2();
		auth.setCredentials({ access_token: accessToken });
		this.auth = auth;
		this.gmail = google.gmail({ auth, version: "v1" });
	}

	async getProfile(): Promise<UserProfile> {
		const { result: response } = await withRetry(
			() => this.gmail.users.getProfile({ userId: "me" }),
			{ maxRetries: 3 }
		);

		const email = response.data.emailAddress ?? "";

		// Try to get the display name from People API
		let name: string | null = null;
		try {
			const people = google.people({ auth: this.auth, version: "v1" });
			const { data } = await people.people.get({
				personFields: "names",
				resourceName: "people/me"
			});
			name = data.names?.[0]?.displayName ?? null;
		} catch {
			// People API might not be enabled, that's okay
		}

		return { email, name };
	}

	async listEmails(options: ListEmailsOptions = {}): Promise<Email[]> {
		const { result: response } = await withRetry(
			() =>
				this.gmail.users.messages.list({
					labelIds: options.labelIds,
					maxResults: options.maxResults ?? 50,
					q: options.query,
					userId: "me"
				}),
			{ maxRetries: 3 }
		);

		const messages = response.data.messages ?? [];

		const emails: Email[] = [];
		for (const msg of messages) {
			if (msg.id) {
				const email = await this.getEmail(msg.id);
				emails.push(email);
			}
		}

		return emails;
	}

	async getEmail(messageId: string): Promise<Email> {
		const { result: response } = await withRetry(
			() =>
				this.gmail.users.messages.get({
					format: "full",
					id: messageId,
					userId: "me"
				}),
			{ maxRetries: 3 }
		);

		const message = response.data;
		const headers = message.payload?.headers ?? [];

		const getHeader = (name: string) =>
			headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
				?.value ?? "";

		invariant(message.id, "Message ID should exist");
		invariant(message.threadId, "Thread ID should exist");

		return {
			body: this.extractBody(message.payload),
			date: new Date(getHeader("date") || Date.now()),
			from: getHeader("from"),
			id: message.id,
			labels: message.labelIds ?? [],
			snippet: message.snippet ?? "",
			subject: getHeader("subject"),
			threadId: message.threadId,
			to: getHeader("to")
		};
	}

	async addLabel(messageId: string, labelId: string): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.modify({
					id: messageId,
					requestBody: {
						addLabelIds: [labelId]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async removeLabel(messageId: string, labelId: string): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.modify({
					id: messageId,
					requestBody: {
						removeLabelIds: [labelId]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async trashEmail(messageId: string): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.trash({
					id: messageId,
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async trashEmails(messageIds: string[]): Promise<void> {
		// Batch trash using batchModify
		await withRetry(
			() =>
				this.gmail.users.messages.batchModify({
					requestBody: {
						addLabelIds: ["TRASH"],
						ids: messageIds
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async archiveEmail(messageId: string): Promise<void> {
		// Archive = remove INBOX label
		await withRetry(
			() =>
				this.gmail.users.messages.modify({
					id: messageId,
					requestBody: {
						removeLabelIds: ["INBOX"]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async archiveEmails(messageIds: string[]): Promise<void> {
		// Batch archive using batchModify
		await withRetry(
			() =>
				this.gmail.users.messages.batchModify({
					requestBody: {
						ids: messageIds,
						removeLabelIds: ["INBOX"]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async markAsRead(messageId: string): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.modify({
					id: messageId,
					requestBody: {
						removeLabelIds: ["UNREAD"]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async markAsUnread(messageId: string): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.modify({
					id: messageId,
					requestBody: {
						addLabelIds: ["UNREAD"]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async markEmailsAsRead(messageIds: string[]): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.batchModify({
					requestBody: {
						ids: messageIds,
						removeLabelIds: ["UNREAD"]
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async markEmailsAsUnread(messageIds: string[]): Promise<void> {
		await withRetry(
			() =>
				this.gmail.users.messages.batchModify({
					requestBody: {
						addLabelIds: ["UNREAD"],
						ids: messageIds
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
	}

	async createLabel(name: string): Promise<string> {
		const { result: response } = await withRetry(
			() =>
				this.gmail.users.labels.create({
					requestBody: {
						labelListVisibility: "labelShow",
						messageListVisibility: "show",
						name
					},
					userId: "me"
				}),
			{ maxRetries: 3 }
		);
		invariant(response.data.id, "Label ID should exist");
		return response.data.id;
	}

	async listLabels(): Promise<Array<{ id: string; name: string }>> {
		const { result: response } = await withRetry(
			() => this.gmail.users.labels.list({ userId: "me" }),
			{ maxRetries: 3 }
		);
		return (response.data.labels ?? [])
			.filter((l): l is gmail_v1.Schema$Label & { id: string; name: string } =>
				Boolean(l.id && l.name)
			)
			.map((l) => ({ id: l.id, name: l.name }));
	}

	async getOrCreateLabel(name: string): Promise<string> {
		const labels = await this.listLabels();
		const existing = labels.find(
			(l) => l.name.toLowerCase() === name.toLowerCase()
		);

		if (existing) {
			return existing.id;
		}

		return this.createLabel(name);
	}

	private extractBody(
		payload: gmail_v1.Schema$MessagePart | undefined
	): string {
		if (!payload) return "";

		// Direct body data
		if (payload.body?.data) {
			return Buffer.from(payload.body.data, "base64").toString("utf-8");
		}

		// Check parts for text/plain first, then text/html
		if (payload.parts) {
			for (const part of payload.parts) {
				if (part.mimeType === "text/plain" && part.body?.data) {
					return Buffer.from(part.body.data, "base64").toString("utf-8");
				}
			}
			// Fallback to HTML if no plain text - convert to markdown
			for (const part of payload.parts) {
				if (part.mimeType === "text/html" && part.body?.data) {
					const html = Buffer.from(part.body.data, "base64").toString("utf-8");
					const markdown = turndown.turndown(html);
					return cleanMarkdown(markdown);
				}
			}
			// Recursively check nested parts
			for (const part of payload.parts) {
				if (part.parts) {
					const body = this.extractBody(part);
					if (body) return body;
				}
			}
		}

		return "";
	}
}
