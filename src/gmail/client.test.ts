import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GmailClient } from "./client";

// Mock the retry module to avoid actual delays
mock.module("../utils/retry.js", () => ({
	withRetry: mock(async (fn: () => Promise<unknown>) => ({
		attempts: 1,
		result: await fn(),
		totalDelayMs: 0
	}))
}));

// Mock googleapis
const mockGmailApi = {
	users: {
		getProfile: mock(() =>
			Promise.resolve({ data: { emailAddress: "test@example.com" } })
		),
		labels: {
			create: mock(() => Promise.resolve({ data: { id: "label123" } })),
			list: mock(() =>
				Promise.resolve({
					data: {
						labels: [
							{ id: "INBOX", name: "INBOX" },
							{ id: "SENT", name: "SENT" },
							{ id: "label1", name: "Work" }
						]
					}
				})
			)
		},
		messages: {
			batchModify: mock(() => Promise.resolve({})),
			// biome-ignore lint/suspicious/noExplicitAny: mock needs flexible typing
			get: mock((_opts?: any) =>
				Promise.resolve({
					data: {
						id: "msg123",
						labelIds: ["INBOX", "UNREAD"],
						payload: {
							body: { data: Buffer.from("Test body").toString("base64") },
							headers: [
								{ name: "Subject", value: "Test Subject" },
								{ name: "From", value: "sender@example.com" },
								{ name: "To", value: "recipient@example.com" },
								{ name: "Date", value: "2024-01-01T12:00:00Z" }
							]
						},
						snippet: "Test snippet",
						threadId: "thread123"
					}
				})
			),
			list: mock(() =>
				Promise.resolve({
					data: {
						messages: [{ id: "msg1" }, { id: "msg2" }]
					}
				})
			),
			modify: mock(() => Promise.resolve({})),
			trash: mock(() => Promise.resolve({}))
		}
	}
};

const mockPeopleApi = {
	people: {
		get: mock(() =>
			Promise.resolve({
				data: { names: [{ displayName: "Test User" }] }
			})
		)
	}
};

mock.module("googleapis", () => ({
	google: {
		auth: {
			OAuth2: class MockOAuth2 {
				setCredentials() {}
			}
		},
		gmail: () => mockGmailApi,
		people: () => mockPeopleApi
	}
}));

describe("GmailClient", () => {
	let client: GmailClient;

	beforeEach(() => {
		client = new GmailClient("test-access-token");
		// Reset all mocks
		mockGmailApi.users.getProfile.mockClear();
		mockGmailApi.users.labels.create.mockClear();
		mockGmailApi.users.labels.list.mockClear();
		mockGmailApi.users.messages.batchModify.mockClear();
		mockGmailApi.users.messages.get.mockClear();
		mockGmailApi.users.messages.list.mockClear();
		mockGmailApi.users.messages.modify.mockClear();
		mockGmailApi.users.messages.trash.mockClear();
		mockPeopleApi.people.get.mockClear();
	});

	describe("getProfile", () => {
		test("returns user profile with email and name", async () => {
			const profile = await client.getProfile();
			expect(profile.email).toBe("test@example.com");
			expect(profile.name).toBe("Test User");
		});

		test("returns null name when People API fails", async () => {
			mockPeopleApi.people.get.mockImplementationOnce(() =>
				Promise.reject(new Error("API not enabled"))
			);

			const profile = await client.getProfile();
			expect(profile.email).toBe("test@example.com");
			expect(profile.name).toBeNull();
		});
	});

	describe("listEmails", () => {
		test("lists emails with default options", async () => {
			// Mock getEmail calls for each message
			mockGmailApi.users.messages.get.mockImplementation(
				(opts: { id: string }) =>
					Promise.resolve({
						data: {
							id: opts.id,
							labelIds: ["INBOX"],
							payload: {
								body: { data: Buffer.from("Body").toString("base64") },
								headers: [
									{ name: "Subject", value: `Subject ${opts.id}` },
									{ name: "From", value: "sender@test.com" },
									{ name: "To", value: "to@test.com" },
									{ name: "Date", value: "2024-01-01T12:00:00Z" }
								]
							},
							snippet: "Snippet",
							threadId: "thread1"
						}
					})
			);

			const emails = await client.listEmails();
			expect(emails).toHaveLength(2);
			expect(mockGmailApi.users.messages.list).toHaveBeenCalledTimes(1);
		});

		test("passes options to Gmail API", async () => {
			mockGmailApi.users.messages.list.mockImplementationOnce(() =>
				Promise.resolve({ data: { messages: [] } })
			);

			await client.listEmails({
				labelIds: ["INBOX"],
				maxResults: 10,
				query: "is:unread"
			});

			expect(mockGmailApi.users.messages.list).toHaveBeenCalledWith({
				labelIds: ["INBOX"],
				maxResults: 10,
				q: "is:unread",
				userId: "me"
			});
		});
	});

	describe("getEmail", () => {
		test("retrieves and parses email", async () => {
			// Reset the mock to default implementation
			mockGmailApi.users.messages.get.mockImplementation(() =>
				Promise.resolve({
					data: {
						id: "msg123",
						labelIds: ["INBOX", "UNREAD"],
						payload: {
							body: { data: Buffer.from("Test body").toString("base64") },
							headers: [
								{ name: "Subject", value: "Test Subject" },
								{ name: "From", value: "sender@example.com" },
								{ name: "To", value: "recipient@example.com" },
								{ name: "Date", value: "2024-01-01T12:00:00Z" }
							]
						},
						snippet: "Test snippet",
						threadId: "thread123"
					}
				})
			);

			const email = await client.getEmail("msg123");

			expect(email.id).toBe("msg123");
			expect(email.threadId).toBe("thread123");
			expect(email.subject).toBe("Test Subject");
			expect(email.from).toBe("sender@example.com");
			expect(email.to).toBe("recipient@example.com");
			expect(email.snippet).toBe("Test snippet");
			expect(email.labels).toContain("INBOX");
			expect(email.labels).toContain("UNREAD");
		});

		test("extracts plain text body from parts", async () => {
			// biome-ignore lint/suspicious/noExplicitAny: mock with different payload structure
			mockGmailApi.users.messages.get.mockImplementationOnce((): any =>
				Promise.resolve({
					data: {
						id: "msg456",
						labelIds: [],
						payload: {
							headers: [
								{ name: "Subject", value: "Test" },
								{ name: "From", value: "test@test.com" },
								{ name: "To", value: "to@test.com" },
								{ name: "Date", value: "2024-01-01" }
							],
							parts: [
								{
									body: { data: Buffer.from("Plain text").toString("base64") },
									mimeType: "text/plain"
								},
								{
									body: {
										data: Buffer.from("<html>HTML content</html>").toString(
											"base64"
										)
									},
									mimeType: "text/html"
								}
							]
						},
						snippet: "Snippet",
						threadId: "thread456"
					}
				})
			);

			const email = await client.getEmail("msg456");
			expect(email.body).toBe("Plain text");
		});

		test("converts HTML to markdown when no plain text", async () => {
			// biome-ignore lint/suspicious/noExplicitAny: mock with different payload structure
			mockGmailApi.users.messages.get.mockImplementationOnce((): any =>
				Promise.resolve({
					data: {
						id: "msg789",
						labelIds: [],
						payload: {
							headers: [
								{ name: "Subject", value: "Test" },
								{ name: "From", value: "test@test.com" },
								{ name: "To", value: "to@test.com" },
								{ name: "Date", value: "2024-01-01" }
							],
							parts: [
								{
									body: {
										data: Buffer.from(
											"<html><body><h1>Hello</h1><p>World</p></body></html>"
										).toString("base64")
									},
									mimeType: "text/html"
								}
							]
						},
						snippet: "Snippet",
						threadId: "thread789"
					}
				})
			);

			const email = await client.getEmail("msg789");
			expect(email.body).toContain("Hello");
			expect(email.body).toContain("World");
		});
	});

	describe("label operations", () => {
		test("addLabel calls modify with addLabelIds", async () => {
			await client.addLabel("msg123", "label456");

			expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
				id: "msg123",
				requestBody: { addLabelIds: ["label456"] },
				userId: "me"
			});
		});

		test("removeLabel calls modify with removeLabelIds", async () => {
			await client.removeLabel("msg123", "label456");

			expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
				id: "msg123",
				requestBody: { removeLabelIds: ["label456"] },
				userId: "me"
			});
		});

		test("listLabels returns filtered labels", async () => {
			const labels = await client.listLabels();

			expect(labels).toHaveLength(3);
			expect(labels[0]).toEqual({ id: "INBOX", name: "INBOX" });
		});

		test("createLabel creates new label", async () => {
			const labelId = await client.createLabel("NewLabel");

			expect(labelId).toBe("label123");
			expect(mockGmailApi.users.labels.create).toHaveBeenCalledWith({
				requestBody: {
					labelListVisibility: "labelShow",
					messageListVisibility: "show",
					name: "NewLabel"
				},
				userId: "me"
			});
		});

		test("getOrCreateLabel returns existing label", async () => {
			const labelId = await client.getOrCreateLabel("Work");

			expect(labelId).toBe("label1");
			expect(mockGmailApi.users.labels.create).not.toHaveBeenCalled();
		});

		test("getOrCreateLabel creates new label if not exists", async () => {
			const labelId = await client.getOrCreateLabel("NewCategory");

			expect(labelId).toBe("label123");
			expect(mockGmailApi.users.labels.create).toHaveBeenCalled();
		});
	});

	describe("email actions", () => {
		test("trashEmail calls trash API", async () => {
			await client.trashEmail("msg123");

			expect(mockGmailApi.users.messages.trash).toHaveBeenCalledWith({
				id: "msg123",
				userId: "me"
			});
		});

		test("trashEmails calls batchModify with TRASH label", async () => {
			await client.trashEmails(["msg1", "msg2"]);

			expect(mockGmailApi.users.messages.batchModify).toHaveBeenCalledWith({
				requestBody: {
					addLabelIds: ["TRASH"],
					ids: ["msg1", "msg2"]
				},
				userId: "me"
			});
		});

		test("archiveEmail removes INBOX label", async () => {
			await client.archiveEmail("msg123");

			expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
				id: "msg123",
				requestBody: { removeLabelIds: ["INBOX"] },
				userId: "me"
			});
		});

		test("archiveEmails batch removes INBOX label", async () => {
			await client.archiveEmails(["msg1", "msg2"]);

			expect(mockGmailApi.users.messages.batchModify).toHaveBeenCalledWith({
				requestBody: {
					ids: ["msg1", "msg2"],
					removeLabelIds: ["INBOX"]
				},
				userId: "me"
			});
		});

		test("markAsRead removes UNREAD label", async () => {
			await client.markAsRead("msg123");

			expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
				id: "msg123",
				requestBody: { removeLabelIds: ["UNREAD"] },
				userId: "me"
			});
		});

		test("markAsUnread adds UNREAD label", async () => {
			await client.markAsUnread("msg123");

			expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
				id: "msg123",
				requestBody: { addLabelIds: ["UNREAD"] },
				userId: "me"
			});
		});

		test("markEmailsAsRead batch removes UNREAD label", async () => {
			await client.markEmailsAsRead(["msg1", "msg2"]);

			expect(mockGmailApi.users.messages.batchModify).toHaveBeenCalledWith({
				requestBody: {
					ids: ["msg1", "msg2"],
					removeLabelIds: ["UNREAD"]
				},
				userId: "me"
			});
		});

		test("markEmailsAsUnread batch adds UNREAD label", async () => {
			await client.markEmailsAsUnread(["msg1", "msg2"]);

			expect(mockGmailApi.users.messages.batchModify).toHaveBeenCalledWith({
				requestBody: {
					addLabelIds: ["UNREAD"],
					ids: ["msg1", "msg2"]
				},
				userId: "me"
			});
		});
	});
});
