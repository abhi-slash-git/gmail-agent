import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useEffect, useState } from "react";
import {
	deleteGmailTokens,
	getGmailTokens,
	saveGmailTokens
} from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { startOAuthFlow } from "../../gmail/oauth.js";
import { Header } from "../components/Header.js";
import { Spinner } from "../components/Spinner.js";
import { useApp } from "../context.js";

type AuthState = "idle" | "connecting" | "success" | "error";

export function AuthScreen() {
	const { db, isAuthenticated, setScreen, refreshAuth } = useApp();
	const [state, setState] = useState<AuthState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [tokenExpiry, setTokenExpiry] = useState<Date | null>(null);

	useEffect(() => {
		const checkToken = async () => {
			const env = getEnv();
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (tokens?.expiresAt) {
				setTokenExpiry(tokens.expiresAt);
			}
		};
		void checkToken();
	}, [db]);

	const handleConnect = async () => {
		setState("connecting");
		setError(null);

		try {
			const env = getEnv();
			const tokens = await startOAuthFlow({
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET
			});

			await saveGmailTokens(db, env.USER_ID, {
				accessToken: tokens.accessToken,
				expiresAt: tokens.expiresAt,
				refreshToken: tokens.refreshToken
			});

			await refreshAuth();
			setState("success");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	const handleDisconnect = async () => {
		const env = getEnv();
		await deleteGmailTokens(db, env.USER_ID);
		await refreshAuth();
		setTokenExpiry(null);
	};

	useInput((input, key) => {
		if (key.escape || input === "b") {
			setScreen("home");
		}
	});

	const items = isAuthenticated
		? [
				{ label: "Disconnect Gmail", value: "disconnect" },
				{ label: "Back", value: "back" }
			]
		: [
				{ label: "Connect Gmail", value: "connect" },
				{ label: "Back", value: "back" }
			];

	const handleSelect = (item: { value: string }) => {
		if (item.value === "back") {
			setScreen("home");
		} else if (item.value === "connect") {
			void handleConnect();
		} else if (item.value === "disconnect") {
			void handleDisconnect();
		}
	};

	return (
		<Box flexDirection="column">
			<Header
				subtitle="Connect your Gmail account"
				title="Gmail Authentication"
			/>

			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>Status: </Text>
					{isAuthenticated ? (
						<Text color="green">Connected</Text>
					) : (
						<Text color="yellow">Not Connected</Text>
					)}
				</Box>

				{tokenExpiry && (
					<Box>
						<Text dimColor>Token expires: {tokenExpiry.toLocaleString()}</Text>
					</Box>
				)}
			</Box>

			{state === "connecting" && (
				<Box marginBottom={1}>
					<Spinner label="Opening browser for authentication..." />
				</Box>
			)}

			{state === "success" && (
				<Box marginBottom={1}>
					<Text color="green">Successfully connected!</Text>
				</Box>
			)}

			{state === "error" && error && (
				<Box marginBottom={1}>
					<Text color="red">Error: {error}</Text>
				</Box>
			)}

			{state === "idle" && (
				<SelectInput items={items} onSelect={handleSelect} />
			)}

			<Box marginTop={1}>
				<Text dimColor>Press b or Esc to go back</Text>
			</Box>
		</Box>
	);
}
