import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useState } from "react";
import {
	type GeneratedClassifier,
	generateClassifierFromPrompt
} from "../../ai/classifier-generator.js";
import { createClassifier, getAccountId } from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { Header } from "../components/Header.js";
import { Spinner } from "../components/Spinner.js";
import { useApp } from "../context.js";

type State =
	| "prompt"
	| "generating"
	| "review"
	| "editing"
	| "saving"
	| "success"
	| "error";
type EditField = "name" | "description" | "label" | "priority";

export function ClassifierAddScreen() {
	const { db, setScreen } = useApp();
	const [state, setState] = useState<State>("prompt");
	const [prompt, setPrompt] = useState("");
	const [generated, setGenerated] = useState<GeneratedClassifier | null>(null);
	const [editField, setEditField] = useState<EditField | null>(null);
	const [editValue, setEditValue] = useState("");
	const [error, setError] = useState<string | null>(null);

	useInput((_input, key) => {
		if (key.escape) {
			if (editField) {
				setEditField(null);
			} else if (state === "review") {
				setState("prompt");
				setGenerated(null);
			} else if (state !== "generating" && state !== "saving") {
				setScreen("classifiers");
			}
		}
	});

	const handleGenerate = async () => {
		if (!prompt.trim()) return;

		setState("generating");
		setError(null);

		try {
			const result = await generateClassifierFromPrompt(prompt.trim());
			setGenerated(result);
			setState("review");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	const handleSave = async () => {
		if (!generated) return;

		setState("saving");

		try {
			const env = getEnv();
			const accountId = await getAccountId(db, env.USER_ID);
			if (!accountId) {
				throw new Error("No account found. Please connect Gmail first.");
			}
			await createClassifier(db, {
				accountId,
				description: generated.description,
				labelName: generated.labelName,
				name: generated.name,
				priority: generated.priority,
				userId: env.USER_ID
			});
			setState("success");
			setTimeout(() => setScreen("classifiers"), 1500);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	const startEdit = (field: EditField) => {
		if (!generated) return;
		setEditField(field);
		switch (field) {
			case "name":
				setEditValue(generated.name);
				break;
			case "description":
				setEditValue(generated.description);
				break;
			case "label":
				setEditValue(generated.labelName);
				break;
			case "priority":
				setEditValue(String(generated.priority));
				break;
		}
	};

	const handleEditSubmit = () => {
		if (!generated || !editField) return;

		const updated = { ...generated };
		switch (editField) {
			case "name":
				updated.name = editValue;
				break;
			case "description":
				updated.description = editValue;
				break;
			case "label":
				updated.labelName = editValue;
				break;
			case "priority":
				updated.priority = parseInt(editValue, 10) || 0;
				break;
		}
		setGenerated(updated);
		setEditField(null);
	};

	// Prompt input
	if (state === "prompt") {
		return (
			<Box flexDirection="column">
				<Header
					subtitle="Describe what emails you want to classify"
					title="Add Classifier"
				/>

				<Box marginBottom={1}>
					<Text dimColor>
						Examples: "newsletters and marketing emails", "job applications and
						recruiter messages", "receipts and invoices"
					</Text>
				</Box>

				<Box>
					<Text color="cyan">{"> "}</Text>
					<TextInput
						onChange={setPrompt}
						onSubmit={handleGenerate}
						placeholder="Describe the emails you want to classify..."
						value={prompt}
					/>
				</Box>

				<Box marginTop={1}>
					<Text dimColor>
						Press Enter to generate classifier, esc to cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// Generating
	if (state === "generating") {
		return (
			<Box flexDirection="column">
				<Header title="Add Classifier" />
				<Spinner label="Generating classifier with AI..." />
			</Box>
		);
	}

	// Review generated classifier
	if (state === "review" && generated) {
		// Editing a specific field
		if (editField) {
			const fieldLabels: Record<EditField, string> = {
				description: "Description",
				label: "Gmail Label",
				name: "Name",
				priority: "Priority"
			};

			return (
				<Box flexDirection="column">
					<Header title={`Edit ${fieldLabels[editField]}`} />

					<Box>
						<Text color="cyan">{"> "}</Text>
						<TextInput
							onChange={setEditValue}
							onSubmit={handleEditSubmit}
							value={editValue}
						/>
					</Box>

					<Box marginTop={1}>
						<Text dimColor>Press Enter to save, esc to cancel</Text>
					</Box>
				</Box>
			);
		}

		// Review view
		const items = [
			{ label: "Save Classifier", value: "save" },
			{ label: "Edit Name", value: "edit-name" },
			{ label: "Edit Description", value: "edit-description" },
			{ label: "Edit Label", value: "edit-label" },
			{ label: "Edit Priority", value: "edit-priority" },
			{ label: "Regenerate", value: "regenerate" },
			{ label: "Cancel", value: "cancel" }
		];

		return (
			<Box flexDirection="column">
				<Header
					subtitle="Review and edit the generated classifier"
					title="Add Classifier"
				/>

				<Box marginBottom={1}>
					<Text dimColor>Generated from: </Text>
					<Text color="cyan">"{prompt}"</Text>
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					<Box>
						<Text bold>Name: </Text>
						<Text>{generated.name}</Text>
					</Box>
					<Box>
						<Text bold>Description: </Text>
						<Text>{generated.description}</Text>
					</Box>
					<Box>
						<Text bold>Gmail Label: </Text>
						<Text>{generated.labelName}</Text>
					</Box>
					<Box>
						<Text bold>Priority: </Text>
						<Text>{String(generated.priority)}</Text>
					</Box>
				</Box>

				<SelectInput
					items={items}
					onSelect={(item) => {
						switch (item.value) {
							case "save":
								void handleSave();
								break;
							case "edit-name":
								startEdit("name");
								break;
							case "edit-description":
								startEdit("description");
								break;
							case "edit-label":
								startEdit("label");
								break;
							case "edit-priority":
								startEdit("priority");
								break;
							case "regenerate":
								void handleGenerate();
								break;
							case "cancel":
								setScreen("classifiers");
								break;
						}
					}}
				/>

				<Box marginTop={1}>
					<Text dimColor>Press esc to go back to prompt</Text>
				</Box>
			</Box>
		);
	}

	// Saving
	if (state === "saving") {
		return (
			<Box flexDirection="column">
				<Header title="Add Classifier" />
				<Spinner label="Saving classifier..." />
			</Box>
		);
	}

	// Success
	if (state === "success") {
		return (
			<Box flexDirection="column">
				<Header title="Add Classifier" />
				<Text color="green">Classifier created successfully!</Text>
			</Box>
		);
	}

	// Error
	if (state === "error") {
		return (
			<Box flexDirection="column">
				<Header title="Add Classifier" />
				<Text color="red">Error: {error}</Text>
				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
