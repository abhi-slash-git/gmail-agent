import { Box, Text } from "ink";
import type { Database } from "../database/connection.js";
import { StatusBar } from "./components/StatusBar.js";
import { AppProvider, useApp } from "./context.js";
import { AuthScreen } from "./screens/AuthScreen.js";
import { ClassifierAddScreen } from "./screens/ClassifierAddScreen.js";
import { ClassifiersScreen } from "./screens/ClassifiersScreen.js";
import { ClassifyScreen } from "./screens/ClassifyScreen.js";
import { EmailsScreen } from "./screens/EmailsScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SyncScreen } from "./screens/SyncScreen.js";

function ScreenContent() {
	const { screen } = useApp();

	switch (screen) {
		case "home":
			return <HomeScreen />;
		case "auth":
			return <AuthScreen />;
		case "classifiers":
			return <ClassifiersScreen />;
		case "classifier-add":
			return <ClassifierAddScreen />;
		case "sync":
			return <SyncScreen />;
		case "classify":
			return <ClassifyScreen />;
		case "emails":
			return <EmailsScreen />;
		default:
			return <HomeScreen />;
	}
}

function Router() {
	const { error } = useApp();

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red">Error: {error}</Text>
			</Box>
		);
	}

	return (
		<>
			<StatusBar />
			<ScreenContent />
		</>
	);
}

interface AppProps {
	db: Database;
	onExit: () => void;
}

export function App({ db, onExit }: AppProps) {
	return (
		<AppProvider db={db} onExit={onExit}>
			<Box flexDirection="column" padding={1}>
				<Router />
			</Box>
		</AppProvider>
	);
}
