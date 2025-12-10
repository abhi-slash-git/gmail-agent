import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useState } from "react";
import {
	classifyEmailsParallel,
	type EmailProgress,
	type ParallelClassifyOptions
} from "../../ai/parallel-classifier.js";
import {
	countEmailsByUserId,
	createClassificationRun,
	findClassifiersByUserId,
	findUnclassifiedEmails,
	getUserProfile,
	NO_MATCH_CLASSIFIER_ID,
	NO_MATCH_CLASSIFIER_NAME,
	updateClassificationRun,
	upsertEmailClassification
} from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { ClassificationGrid } from "../components/ClassificationGrid.js";
import { Header } from "../components/Header.js";
import { Spinner } from "../components/Spinner.js";
import { useApp } from "../context.js";

type ClassifyState = "idle" | "preparing" | "classifying" | "success" | "error";

interface ClassifyResult {
	processed: number;
	classified: number;
	failed: number;
	elapsed: string;
}

export function ClassifyScreen() {
	const { db, isAuthenticated, setScreen, setBackgroundClassify } = useApp();
	const [state, setState] = useState<ClassifyState>("idle");
	const [emailProgress, setEmailProgress] = useState<
		Map<string, EmailProgress>
	>(new Map());
	const [result, setResult] = useState<ClassifyResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [preparing, setPreparing] = useState("");
	const [_classifiedCount, setClassifiedCount] = useState(0);

	useInput((input, key) => {
		if (state === "idle" || state === "success" || state === "error") {
			if (key.escape || input === "b") {
				setScreen("home");
			}
		}
	});

	const handleClassify = async (maxEmails: number) => {
		if (!isAuthenticated) return;

		setState("preparing");
		setError(null);
		setEmailProgress(new Map());
		setPreparing("Loading classifiers...");

		// Track this task's contribution for delta-based updates (declared outside try for catch access)
		let taskCompleted = 0;
		let taskClassified = 0;
		let taskTotal = 0;

		try {
			const env = getEnv();

			// Get user profile for context
			const userProfile = await getUserProfile(db, env.USER_ID);

			// Get classifiers
			const classifiers = await findClassifiersByUserId(db, env.USER_ID);
			const enabledClassifiers = classifiers.filter((c) => c.enabled);

			if (enabledClassifiers.length === 0) {
				setError("No classifiers configured. Add one first.");
				setState("error");
				return;
			}

			setPreparing("Checking for emails...");

			// Get total count to check if we have emails
			const totalEmails = await countEmailsByUserId(db, env.USER_ID);
			if (totalEmails === 0) {
				setError("No emails synced. Sync emails first.");
				setState("error");
				return;
			}

			setPreparing("Loading unclassified emails...");

			// Get unclassified emails directly from database
			const emails = await findUnclassifiedEmails(db, env.USER_ID, {
				limit: maxEmails
			});

			if (emails.length === 0) {
				setResult({
					classified: 0,
					elapsed: "0s",
					failed: 0,
					processed: 0
				});
				setState("success");
				return;
			}

			// Create run record
			const run = await createClassificationRun(db, {
				status: "running",
				userId: env.USER_ID
			});

			if (!run) {
				throw new Error("Failed to create classification run record.");
			}

			setPreparing(`Preparing to classify ${emails.length} emails...`);
			const startTime = Date.now();

			// Transform DB emails to classifier input format
			const emailInputs = emails.map((e) => ({
				body: e.body,
				date: e.date,
				from: e.from,
				id: e.gmailId,
				snippet: e.snippet,
				subject: e.subject
			}));

			setState("classifying");
			setClassifiedCount(0);

			// Set task total for tracking
			taskTotal = emails.length;

			// Add to background state (merge with existing tasks)
			setBackgroundClassify((prev) => ({
				activeTasks: prev.activeTasks + 1,
				classified: prev.classified,
				completed: prev.completed,
				isRunning: true,
				total: prev.total + taskTotal
			}));

			// Set up progress tracking
			const progressMap = new Map<string, EmailProgress>();

			const options: ParallelClassifyOptions = {
				onBatchComplete: (completed) => {
					// Count how many have been classified so far
					const classifiedSoFar = Array.from(progressMap.values()).filter(
						(p) => p.status === "completed" && p.classifier
					).length;

					// Calculate deltas from this task
					const completedDelta = completed - taskCompleted;
					const classifiedDelta = classifiedSoFar - taskClassified;

					// Update tracking
					taskCompleted = completed;
					taskClassified = classifiedSoFar;

					setClassifiedCount(classifiedSoFar);
					setBackgroundClassify((prev) => ({
						activeTasks: prev.activeTasks,
						classified: prev.classified + classifiedDelta,
						completed: prev.completed + completedDelta,
						isRunning: true,
						total: prev.total
					}));
				},
				onEmailProgress: (progress) => {
					progressMap.set(progress.emailId, progress);
					// Create a new Map to trigger re-render
					setEmailProgress(new Map(progressMap));
				},
				userContext: userProfile ?? undefined
			};

			// Run parallel classification
			const results = await classifyEmailsParallel(
				emailInputs,
				enabledClassifiers,
				options
			);

			// Process results and save to database
			let classified = 0;
			let noMatch = 0;

			for (const res of results) {
				const email = emails.find((e) => e.gmailId === res.emailId);
				if (!email) continue;

				if (res.classifierId && res.confidence >= 0.7) {
					const classifier = enabledClassifiers.find(
						(c) => c.id === res.classifierId
					);

					if (classifier) {
						// Save classification to database
						await upsertEmailClassification(db, {
							classifierId: classifier.id,
							classifierName: classifier.name,
							confidence: res.confidence,
							emailId: email.id,
							gmailId: email.gmailId,
							labelApplied: false,
							labelName: classifier.labelName,
							reasoning: "",
							runId: run.id,
							userId: env.USER_ID
						});

						classified++;
					}
				} else {
					// Save "no match" record to prevent re-processing
					await upsertEmailClassification(db, {
						classifierId: NO_MATCH_CLASSIFIER_ID,
						classifierName: NO_MATCH_CLASSIFIER_NAME,
						confidence: 0,
						emailId: email.id,
						gmailId: email.gmailId,
						labelApplied: false,
						labelName: "",
						reasoning: "",
						runId: run.id,
						userId: env.USER_ID
					});
					noMatch++;
				}
			}

			await updateClassificationRun(db, run.id, {
				completedAt: new Date(),
				emailsClassified: classified,
				emailsProcessed: emails.length,
				status: "completed"
			});

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

			// Update background state - decrement this task's contribution
			setBackgroundClassify((prev) => {
				const newActiveTasks = prev.activeTasks - 1;
				// If this was the last task, fully reset
				if (newActiveTasks <= 0) {
					return {
						activeTasks: 0,
						classified: 0,
						completed: 0,
						isRunning: false,
						total: 0
					};
				}
				// Otherwise, subtract this task's contribution
				return {
					activeTasks: newActiveTasks,
					classified: prev.classified - taskClassified,
					completed: prev.completed - taskCompleted,
					isRunning: true,
					total: prev.total - taskTotal
				};
			});

			setResult({
				classified,
				elapsed: `${elapsed}s`,
				failed: noMatch,
				processed: emails.length
			});
			setState("success");
		} catch (err) {
			// Update background state on error - decrement this task's contribution
			setBackgroundClassify((prev) => {
				const newActiveTasks = prev.activeTasks - 1;
				// If this was the last task, fully reset
				if (newActiveTasks <= 0) {
					return {
						activeTasks: 0,
						classified: 0,
						completed: 0,
						isRunning: false,
						total: 0
					};
				}
				// Otherwise, subtract this task's contribution
				return {
					activeTasks: newActiveTasks,
					classified: prev.classified - taskClassified,
					completed: prev.completed - taskCompleted,
					isRunning: true,
					total: prev.total - taskTotal
				};
			});
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	const handleEscape = () => {
		if (state === "classifying") {
			// Could implement cancellation here
			setState("idle");
		}
	};

	if (!isAuthenticated) {
		return (
			<Box flexDirection="column">
				<Header title="Classify Emails" />
				<Text color="yellow">Please connect Gmail first.</Text>
				<Box marginTop={1}>
					<Text dimColor>Press b or Esc to go back</Text>
				</Box>
			</Box>
		);
	}

	if (state === "preparing") {
		return (
			<Box flexDirection="column">
				<Header title="Classify Emails" />
				<Box marginBottom={1}>
					<Spinner label={preparing} />
				</Box>
			</Box>
		);
	}

	if (state === "classifying") {
		return (
			<Box flexDirection="column">
				<Header
					subtitle="AI-powered email classification"
					title="Classify Emails"
				/>
				<ClassificationGrid
					emailProgress={emailProgress}
					onEscape={handleEscape}
				/>
			</Box>
		);
	}

	if (state === "success" && result) {
		return (
			<Box flexDirection="column">
				<Header title="Classification Complete" />

				<Box flexDirection="column" marginBottom={1} marginTop={1}>
					<Text color="green">✓ Classification finished successfully!</Text>

					<Box flexDirection="column" marginTop={1}>
						<Text>
							<Text dimColor>Total Processed: </Text>
							<Text bold>{String(result.processed)}</Text> email(s)
						</Text>
						<Text>
							<Text dimColor>Successfully Classified: </Text>
							<Text bold color="green">
								{String(result.classified)}
							</Text>{" "}
							email(s)
						</Text>
						<Text>
							<Text dimColor>No Match: </Text>
							<Text bold color="blue">
								{String(result.processed - result.classified - result.failed)}
							</Text>{" "}
							email(s)
						</Text>
						{result.failed > 0 && (
							<Text>
								<Text dimColor>Failed: </Text>
								<Text bold color="red">
									{String(result.failed)}
								</Text>{" "}
								email(s)
							</Text>
						)}
						<Text>
							<Text dimColor>Time Elapsed: </Text>
							<Text bold>{result.elapsed}</Text>
						</Text>
					</Box>

					{/* Show classification summary from emailProgress */}
					{emailProgress.size > 0 && (
						<Box flexDirection="column" marginTop={1}>
							<Text bold>Classification Details:</Text>
							<Box flexDirection="column" marginTop={1}>
								{Array.from(emailProgress.values())
									.filter((p) => p.status === "completed" && p.classifier)
									.slice(0, 5)
									.map((p) => (
										<Box key={p.emailId}>
											<Text>
												<Text color="cyan">
													[{((p.confidence || 0) * 100).toFixed(0)}%]
												</Text>{" "}
												{p.subject.length > 30
													? `${p.subject.slice(0, 27)}...`
													: p.subject}
											</Text>
											<Text dimColor>
												{" -> "}
												{p.classifier}
											</Text>
										</Box>
									))}
								{Array.from(emailProgress.values()).filter(
									(p) => p.status === "completed" && p.classifier
								).length > 5 && (
									<Box marginTop={1}>
										<Text dimColor>
											...and{" "}
											{Array.from(emailProgress.values()).filter(
												(p) => p.status === "completed" && p.classifier
											).length - 5}{" "}
											more
										</Text>
									</Box>
								)}
							</Box>
						</Box>
					)}
				</Box>

				<Box marginTop={1}>
					<Text dimColor>Press b or Esc to go back</Text>
				</Box>
			</Box>
		);
	}

	if (state === "error" && error) {
		return (
			<Box flexDirection="column">
				<Header title="Classification Error" />
				<Box marginBottom={1}>
					<Text color="red">Error: {error}</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Press b or Esc to go back</Text>
				</Box>
			</Box>
		);
	}

	const items = [
		{ label: "Classify 10 emails", value: "10" },
		{ label: "Classify 25 emails", value: "25" },
		{ label: "Classify 50 emails", value: "50" },
		{ label: "Classify 100 emails", value: "100" },
		{ label: "Classify 250 emails", value: "250" },
		{ label: "Classify 500 emails", value: "500" },
		{ label: "Classify 1000 emails", value: "1000" },
		{ label: "Back", value: "back" }
	];

	return (
		<Box flexDirection="column">
			<Header
				subtitle="AI-powered email classification with live progress"
				title="Classify Emails"
			/>

			<Box marginBottom={1}>
				<Text dimColor>Select how many emails to classify:</Text>
			</Box>

			<SelectInput
				items={items}
				onSelect={async (item) => {
					if (item.value === "back") {
						setScreen("home");
					} else {
						await handleClassify(parseInt(item.value, 10));
					}
				}}
			/>

			<Box marginTop={1}>
				<Text dimColor>Press b or Esc to go back</Text>
			</Box>
		</Box>
	);
}
