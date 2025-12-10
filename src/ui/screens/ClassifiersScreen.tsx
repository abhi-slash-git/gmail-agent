import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useMemo, useState } from "react";
import {
	type Classifier,
	deleteClassifier,
	updateClassifier
} from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { Header } from "../components/Header.js";
import { Spinner } from "../components/Spinner.js";
import { useApp } from "../context.js";
import { useLiveQuery } from "../hooks/useLiveQuery.js";

type EditField = "name" | "description" | "label" | "priority";

export function ClassifiersScreen() {
	const { db, sql, setScreen } = useApp();
	const [selectedClassifier, setSelectedClassifier] =
		useState<Classifier | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [editField, setEditField] = useState<EditField | null>(null);
	const [editValue, setEditValue] = useState("");

	const env = getEnv();

	// Live query for classifiers
	const { rows: rawClassifiers, loading: isLoading } = useLiveQuery<{
		id: string;
		createdAt: Date;
		updatedAt: Date;
		description: string;
		enabled: boolean;
		labelName: string;
		name: string;
		priority: number | null;
		userId: string;
	}>(
		sql,
		`SELECT * FROM classifier WHERE "userId" = $1 ORDER BY priority DESC`,
		[env.USER_ID]
	);

	// Transform to Classifier type
	const classifiers: Classifier[] = useMemo(() => {
		return rawClassifiers.map((row) => ({
			createdAt: row.createdAt,
			description: row.description,
			enabled: row.enabled,
			id: row.id,
			labelName: row.labelName,
			name: row.name,
			priority: row.priority,
			updatedAt: row.updatedAt,
			userId: row.userId
		}));
	}, [rawClassifiers]);

	useInput((_input, key) => {
		if (key.escape) {
			if (editField) {
				setEditField(null);
			} else if (confirmDelete) {
				setConfirmDelete(false);
			} else if (selectedClassifier) {
				setSelectedClassifier(null);
			} else {
				setScreen("home");
			}
		}
	});

	const handleDelete = async (classifier: Classifier) => {
		await deleteClassifier(db, env.USER_ID, classifier.id);
		// Live query will auto-update
		setSelectedClassifier(null);
		setConfirmDelete(false);
	};

	const handleToggle = async (classifier: Classifier) => {
		await updateClassifier(db, env.USER_ID, classifier.id, {
			enabled: !classifier.enabled
		});
		// Live query will auto-update
		setSelectedClassifier({ ...classifier, enabled: !classifier.enabled });
	};

	const startEdit = (field: EditField) => {
		if (!selectedClassifier) return;
		setEditField(field);
		switch (field) {
			case "name":
				setEditValue(selectedClassifier.name);
				break;
			case "description":
				setEditValue(selectedClassifier.description);
				break;
			case "label":
				setEditValue(selectedClassifier.labelName);
				break;
			case "priority":
				setEditValue(String(selectedClassifier.priority ?? 0));
				break;
		}
	};

	const handleSaveEdit = async () => {
		if (!selectedClassifier || !editField) return;

		let payload: Parameters<typeof updateClassifier>[3] = {};
		const updatedClassifier = { ...selectedClassifier };

		switch (editField) {
			case "name":
				if (!editValue.trim()) return;
				payload = { name: editValue.trim() };
				updatedClassifier.name = editValue.trim();
				break;
			case "description":
				payload = { description: editValue.trim() };
				updatedClassifier.description = editValue.trim();
				break;
			case "label":
				if (!editValue.trim()) return;
				payload = { labelName: editValue.trim() };
				updatedClassifier.labelName = editValue.trim();
				break;
			case "priority": {
				const newPriority = Math.max(
					0,
					Math.min(10, parseInt(editValue, 10) || 0)
				);
				payload = { priority: newPriority };
				updatedClassifier.priority = newPriority;
				break;
			}
		}

		await updateClassifier(db, env.USER_ID, selectedClassifier.id, payload);
		// Live query will auto-update
		setSelectedClassifier(updatedClassifier);
		setEditField(null);
	};

	if (isLoading) {
		return (
			<Box flexDirection="column">
				<Header title="Classifiers" />
				<Spinner label="Loading classifiers..." />
			</Box>
		);
	}

	if (selectedClassifier) {
		// Field editing
		if (editField) {
			const fieldLabels: Record<EditField, string> = {
				description: "Description",
				label: "Gmail Label",
				name: "Name",
				priority: "Priority"
			};

			const fieldHints: Record<EditField, string> = {
				description: "Describe what kinds of emails this classifier matches.",
				label: "The Gmail label to apply to matching emails.",
				name: "A short name to identify this classifier.",
				priority:
					"Enter priority (0-10). Higher priority classifiers are checked first."
			};

			const fieldPlaceholders: Record<EditField, string> = {
				description: "e.g., Marketing and promotional emails",
				label: "e.g., Newsletters",
				name: "e.g., Newsletter Classifier",
				priority: "0-10"
			};

			return (
				<Box flexDirection="column">
					<Header title={`Edit ${fieldLabels[editField]}`} />

					<Box marginBottom={1}>
						<Text dimColor>{fieldHints[editField]}</Text>
					</Box>

					<Box>
						<Text color="cyan">{">"} </Text>
						<TextInput
							onChange={setEditValue}
							onSubmit={() => void handleSaveEdit()}
							placeholder={fieldPlaceholders[editField]}
							value={editValue}
						/>
					</Box>

					<Box marginTop={1}>
						<Text dimColor>Press Enter to save, Esc to cancel</Text>
					</Box>
				</Box>
			);
		}

		// Delete confirmation dialog
		if (confirmDelete) {
			const confirmItems = [
				{ label: "Yes, delete", value: "confirm" },
				{ label: "Cancel", value: "cancel" }
			];

			return (
				<Box flexDirection="column">
					<Header title="Delete Classifier" />

					<Box flexDirection="column" marginBottom={1}>
						<Text color="yellow">
							Are you sure you want to delete "{selectedClassifier.name}"?
						</Text>
						<Text dimColor>This action cannot be undone.</Text>
					</Box>

					<SelectInput
						items={confirmItems}
						onSelect={(item) => {
							if (item.value === "confirm") {
								void handleDelete(selectedClassifier);
							} else {
								setConfirmDelete(false);
							}
						}}
					/>

					<Box marginTop={1}>
						<Text dimColor>Press Esc to cancel</Text>
					</Box>
				</Box>
			);
		}

		const items = [
			{
				label: selectedClassifier.enabled ? "Disable" : "Enable",
				value: "toggle"
			},
			{ label: "Edit Name", value: "edit-name" },
			{ label: "Edit Description", value: "edit-description" },
			{ label: "Edit Label", value: "edit-label" },
			{ label: "Edit Priority", value: "edit-priority" },
			{ label: "Delete", value: "delete" },
			{ label: "Back", value: "back" }
		];

		return (
			<Box flexDirection="column">
				<Header
					subtitle={selectedClassifier.description}
					title={selectedClassifier.name}
				/>

				<Box flexDirection="column" marginBottom={1}>
					<Text>
						<Text dimColor>Label: </Text>
						<Text>{selectedClassifier.labelName}</Text>
					</Text>
					<Text>
						<Text dimColor>Priority: </Text>
						<Text>{String(selectedClassifier.priority ?? 0)}</Text>
					</Text>
					<Text>
						<Text dimColor>Status: </Text>
						{selectedClassifier.enabled ? (
							<Text color="green">Enabled</Text>
						) : (
							<Text color="yellow">Disabled</Text>
						)}
					</Text>
				</Box>

				<SelectInput
					items={items}
					onSelect={(item) => {
						if (item.value === "back") {
							setSelectedClassifier(null);
						} else if (item.value === "toggle") {
							void handleToggle(selectedClassifier);
						} else if (item.value === "edit-name") {
							startEdit("name");
						} else if (item.value === "edit-description") {
							startEdit("description");
						} else if (item.value === "edit-label") {
							startEdit("label");
						} else if (item.value === "edit-priority") {
							startEdit("priority");
						} else if (item.value === "delete") {
							setConfirmDelete(true);
						}
					}}
				/>

				<Box marginTop={1}>
					<Text dimColor>Press Esc to go back</Text>
				</Box>
			</Box>
		);
	}

	const items = [
		{ label: "+ Add New Classifier", value: "add" },
		...classifiers.map((c) => ({
			label: `${c.enabled ? "[x]" : "[ ]"} ${c.name} -> ${c.labelName}`,
			value: c.id
		})),
		{ label: "Back", value: "back" }
	];

	return (
		<Box flexDirection="column">
			<Header
				subtitle={`${classifiers.length} classifier(s) configured`}
				title="Classifiers"
			/>

			{classifiers.length === 0 && (
				<Box marginBottom={1}>
					<Text dimColor>No classifiers yet. Add one to get started.</Text>
				</Box>
			)}

			<SelectInput
				items={items}
				onSelect={(item) => {
					if (item.value === "back") {
						setScreen("home");
					} else if (item.value === "add") {
						setScreen("classifier-add");
					} else {
						const classifier = classifiers.find((c) => c.id === item.value);
						if (classifier) {
							setSelectedClassifier(classifier);
						}
					}
				}}
			/>

			<Box marginTop={1}>
				<Text dimColor>Press Esc to go back</Text>
			</Box>
		</Box>
	);
}
