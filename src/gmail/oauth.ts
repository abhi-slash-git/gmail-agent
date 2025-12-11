import { createServer } from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";
import invariant from "tiny-invariant";
import { withRetry } from "../utils/retry.js";

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.labels",
	"https://www.googleapis.com/auth/gmail.modify"
];

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: Date;
}

export async function startOAuthFlow(config: {
	clientId: string;
	clientSecret: string;
	onAuthUrl?: (url: string) => void;
}): Promise<OAuthTokens> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		let timer: NodeJS.Timeout | null = null;

		server.listen(3000, "localhost", async () => {
			const address = server.address();
			const port = typeof address === "object" ? address?.port : 3000;
			const redirectUri = `http://localhost:${port}/callback`;

			const oauth2Client = new google.auth.OAuth2(
				config.clientId,
				config.clientSecret,
				redirectUri
			);

			const authUrl = oauth2Client.generateAuthUrl({
				access_type: "offline",
				prompt: "consent",
				scope: SCOPES
			});

			// Notify caller of the auth URL (for UI display)
			config.onAuthUrl?.(authUrl);

			// Open browser (cross-platform)
			const open = await import("open");
			await open.default(authUrl);

			server.on("request", async (req, res) => {
				invariant(req.url, "Request URL should exist");
				const url = new URL(req.url, `http://localhost:${port}`);

				if (url.pathname === "/callback") {
					const code = url.searchParams.get("code");
					const error = url.searchParams.get("error");

					if (error) {
						res.writeHead(400, { "Content-Type": "text/html" });
						res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
						server.close();
						reject(new Error(`OAuth error: ${error}`));
						return;
					}

					if (code) {
						try {
							const { tokens } = await oauth2Client.getToken(code);

							res.writeHead(200, { "Content-Type": "text/html" });
							res.end(
								"<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>"
							);

							server.close();

							invariant(tokens.access_token, "Access token should exist");
							invariant(tokens.expiry_date, "Expiry date should exist");
							invariant(tokens.refresh_token, "Refresh token should exist");

							resolve({
								accessToken: tokens.access_token,
								expiresAt: new Date(tokens.expiry_date),
								refreshToken: tokens.refresh_token
							});
						} catch (err) {
							res.writeHead(500, { "Content-Type": "text/html" });
							res.end(
								"<h1>Authorization failed</h1><p>Could not exchange code for tokens.</p>"
							);
							server.close();
							reject(err);
						} finally {
							timer && clearTimeout(timer);
						}
					} else {
						res.writeHead(400, { "Content-Type": "text/html" });
						res.end(
							"<h1>Authorization failed</h1><p>No authorization code received.</p>"
						);
						server.close();
						reject(new Error("No authorization code received"));
					}
				}
			});
		});

		// Timeout after 5 minutes
		timer = setTimeout(
			() => {
				server.close();
				reject(new Error("OAuth flow timed out after 5 minutes"));
			},
			5 * 60 * 1000
		);
	});
}

export async function refreshAccessToken(config: {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: Date }> {
	const oauth2Client = new google.auth.OAuth2(
		config.clientId,
		config.clientSecret
	);

	oauth2Client.setCredentials({
		refresh_token: config.refreshToken
	});

	const { result } = await withRetry(() => oauth2Client.refreshAccessToken(), {
		maxRetries: 3
	});

	invariant(result.credentials.access_token, "Access token should exist");
	invariant(result.credentials.expiry_date, "Expiry date should exist");

	return {
		accessToken: result.credentials.access_token,
		expiresAt: new Date(result.credentials.expiry_date)
	};
}
