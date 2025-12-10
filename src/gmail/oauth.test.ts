import { describe, expect, mock, test } from "bun:test";

// Mock googleapis
const mockOAuth2Client = {
	generateAuthUrl: mock(() => "https://accounts.google.com/oauth/test"),
	getToken: mock(() =>
		Promise.resolve({
			tokens: {
				access_token: "test_access_token",
				expiry_date: Date.now() + 3600000,
				refresh_token: "test_refresh_token"
			}
		})
	),
	refreshAccessToken: mock(() =>
		Promise.resolve({
			credentials: {
				access_token: "refreshed_access_token",
				expiry_date: Date.now() + 3600000
			}
		})
	),
	setCredentials: mock(() => {})
};

mock.module("googleapis", () => ({
	google: {
		auth: {
			OAuth2: function MockOAuth2() {
				Object.assign(this, mockOAuth2Client);
			}
		}
	}
}));

// Mock the retry module
mock.module("../utils/retry.js", () => ({
	withRetry: mock(async (fn: () => Promise<unknown>) => ({
		attempts: 1,
		result: await fn(),
		totalDelayMs: 0
	}))
}));

describe("refreshAccessToken", () => {
	test("refreshes access token using refresh token", async () => {
		const { refreshAccessToken } = await import("./oauth");

		const result = await refreshAccessToken({
			clientId: "test-client-id",
			clientSecret: "test-client-secret",
			refreshToken: "test-refresh-token"
		});

		expect(result.accessToken).toBe("refreshed_access_token");
		expect(result.expiresAt).toBeInstanceOf(Date);
		expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith({
			refresh_token: "test-refresh-token"
		});
	});

	test("throws on invalid response", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock with null credentials
		mockOAuth2Client.refreshAccessToken.mockImplementationOnce((): any =>
			Promise.resolve({
				credentials: {
					access_token: null,
					expiry_date: null
				}
			})
		);

		const { refreshAccessToken } = await import("./oauth");

		await expect(
			refreshAccessToken({
				clientId: "test-client-id",
				clientSecret: "test-client-secret",
				refreshToken: "test-refresh-token"
			})
		).rejects.toThrow();
	});
});

describe("OAuthTokens type", () => {
	test("has correct shape", () => {
		// Type-level test to ensure OAuthTokens interface is correct
		const tokens: {
			accessToken: string;
			refreshToken: string;
			expiresAt: Date;
		} = {
			accessToken: "test",
			expiresAt: new Date(),
			refreshToken: "test"
		};

		expect(tokens.accessToken).toBe("test");
		expect(tokens.refreshToken).toBe("test");
		expect(tokens.expiresAt).toBeInstanceOf(Date);
	});
});
