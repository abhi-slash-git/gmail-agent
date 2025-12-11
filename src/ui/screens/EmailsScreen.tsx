import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useMemo, useState } from "react";
import { classifyEmailsParallel } from "../../ai/parallel-classifier.js";
import {
	type ClassifierFilterOption,
	deleteEmailClassification,
	deleteEmailsByIds,
	type Email,
	type EmailClassification,
	findClassifiersByUserId,
	getAccountId,
	getGmailTokens,
	getUserProfile,
	markEmailArchived,
	markEmailRead,
	markEmailsArchived,
	markEmailsRead,
	markEmailsUnread,
	markEmailUnread,
	markLabelApplied,
	markLabelsApplied,
	NO_MATCH_CLASSIFIER_ID,
	upsertEmailClassification
} from "../../database/connection.js";
import { getEnv } from "../../env.js";
import { GmailClient } from "../../gmail/client.js";
import { Header } from "../components/Header.js";
import { Markdown } from "../components/Markdown";
import { Spinner } from "../components/Spinner.js";
import { useApp } from "../context.js";
import { useLiveQuery } from "../hooks/useLiveQuery.js";

type ViewState =
	| "list"
	| "search"
	| "detail"
	| "classifying"
	| "filter"
	| "confirm-delete"
	| "confirm-archive"
	| "confirm-sync-labels"
	| "processing";

const PAGE_SIZE = 100;
const VISIBLE_ROWS = 20; // Number of email rows visible at once

interface EmailWithClassification extends Email {
	classification?: EmailClassification;
}

type ViewMode = "all" | "inbox" | "unread" | "archived";

export function EmailsScreen() {
	const { db, sql, setScreen } = useApp();
	const [state, setState] = useState<ViewState>("list");
	const [actionError, setActionError] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [page, setPage] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	const [activeQuery, setActiveQuery] = useState("");
	const [selectedClassifierIds, setSelectedClassifierIds] = useState<string[]>(
		[]
	);
	const [filterIndex, setFilterIndex] = useState(0);
	const [viewportStart, setViewportStart] = useState(0);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [processingAction, setProcessingAction] = useState("");
	const [classifyProgress, setClassifyProgress] = useState({
		current: 0,
		total: 0
	});
	const [viewMode, setViewMode] = useState<ViewMode>("inbox");

	const env = getEnv();

	// Build SQL query based on current filters
	const { emailQuery, emailParams } = useMemo(() => {
		const conditions: string[] = [`e."userId" = $1`];
		const params: unknown[] = [env.USER_ID];
		let paramIndex = 2;

		// View mode filters
		if (viewMode === "archived") {
			conditions.push(`e.archived = true`);
		} else if (viewMode === "inbox") {
			conditions.push(`e.archived = false`);
		} else if (viewMode === "unread") {
			conditions.push(`e.unread = true`);
			conditions.push(`e.archived = false`);
		}
		// viewMode === "all" has no additional conditions

		// Search query - use separate params for each field to work around PGlite format() issue
		if (activeQuery) {
			const searchValue = `%${activeQuery}%`;
			conditions.push(`(
				e.subject ILIKE $${paramIndex} OR
				e."from" ILIKE $${paramIndex + 1} OR
				e.snippet ILIKE $${paramIndex + 2}
			)`);
			params.push(searchValue, searchValue, searchValue);
			paramIndex += 3;
		}

		// Classifier filter
		if (selectedClassifierIds.length > 0) {
			const placeholders = selectedClassifierIds
				.map((_, i) => `$${paramIndex + i}`)
				.join(", ");
			conditions.push(`e.id IN (
				SELECT ec."emailId" FROM email_classification ec
				WHERE ec."classifierId" IN (${placeholders})
			)`);
			params.push(...selectedClassifierIds);
			paramIndex += selectedClassifierIds.length;
		}

		const whereClause = conditions.join(" AND ");
		const offset = page * PAGE_SIZE;

		const query = `
			SELECT
				e.*,
				ec.id as classification_id,
				ec."classifierId" as classifier_id,
				ec."classifierName" as classifier_name,
				ec.confidence,
				ec.reasoning,
				ec."labelName" as label_name,
				ec."labelApplied" as label_applied,
				ec."runId" as run_id
			FROM email e
			LEFT JOIN email_classification ec ON e.id = ec."emailId"
			WHERE ${whereClause}
			ORDER BY e.date DESC
			LIMIT ${PAGE_SIZE}
			OFFSET ${offset}
		`;

		return { emailParams: [...params], emailQuery: query };
	}, [env.USER_ID, viewMode, activeQuery, selectedClassifierIds, page]);

	// Live query for emails with classifications
	const {
		rows: rawEmails,
		loading: isLoading,
		error: queryError
	} = useLiveQuery<{
		id: string;
		accountId: string;
		createdAt: Date;
		updatedAt: Date;
		archived: boolean;
		body: string;
		date: Date;
		from: string;
		gmailId: string;
		labels: string[];
		snippet: string;
		subject: string;
		threadId: string;
		to: string;
		unread: boolean;
		userId: string;
		classification_id: string | null;
		classification_accountId: string | null;
		classifier_id: string | null;
		classifier_name: string | null;
		confidence: number | null;
		reasoning: string | null;
		label_name: string | null;
		label_applied: boolean | null;
		run_id: string | null;
	}>(sql, emailQuery, emailParams);

	// Live query for total count
	const { countQuery, countParams } = useMemo(() => {
		const conditions: string[] = [`"userId" = $1`];
		const params: unknown[] = [env.USER_ID];
		let paramIndex = 2;

		if (viewMode === "archived") {
			conditions.push(`archived = true`);
		} else if (viewMode === "inbox") {
			conditions.push(`archived = false`);
		} else if (viewMode === "unread") {
			conditions.push(`unread = true`);
			conditions.push(`archived = false`);
		}

		// Search query - use separate params for each field to work around PGlite format() issue
		if (activeQuery) {
			const searchValue = `%${activeQuery}%`;
			conditions.push(`(
				subject ILIKE $${paramIndex} OR
				"from" ILIKE $${paramIndex + 1} OR
				snippet ILIKE $${paramIndex + 2}
			)`);
			params.push(searchValue, searchValue, searchValue);
			paramIndex += 3;
		}

		if (selectedClassifierIds.length > 0) {
			const placeholders = selectedClassifierIds
				.map((_, i) => `$${paramIndex + i}`)
				.join(", ");
			conditions.push(`id IN (
				SELECT "emailId" FROM email_classification
				WHERE "classifierId" IN (${placeholders})
			)`);
			params.push(...selectedClassifierIds);
		}

		return {
			countParams: [...params],
			countQuery: `SELECT COUNT(*)::int as count FROM email WHERE ${conditions.join(" AND ")}`
		};
	}, [env.USER_ID, viewMode, activeQuery, selectedClassifierIds]);

	const { rows: countRows } = useLiveQuery<{ count: number }>(
		sql,
		countQuery,
		countParams
	);
	const totalCount = countRows[0]?.count ?? 0;

	// Live query for classifier filter options - filtered by current view mode
	const { classifierQuery, classifierParams } = useMemo(() => {
		const conditions: string[] = [`ec."userId" = $1`];
		const params: unknown[] = [env.USER_ID];

		// Filter by view mode
		if (viewMode === "archived") {
			conditions.push(`e.archived = true`);
		} else if (viewMode === "inbox") {
			conditions.push(`e.archived = false`);
		} else if (viewMode === "unread") {
			conditions.push(`e.unread = true`);
			conditions.push(`e.archived = false`);
		}

		return {
			classifierParams: params,
			classifierQuery: `
				SELECT ec."classifierId" as id, ec."classifierName" as name, COUNT(*)::int as count
				FROM email_classification ec
				JOIN email e ON ec."emailId" = e.id
				WHERE ${conditions.join(" AND ")}
				GROUP BY ec."classifierId", ec."classifierName"
				ORDER BY ec."classifierName"
			`
		};
	}, [env.USER_ID, viewMode]);

	const { rows: rawClassifierOptions } = useLiveQuery<{
		id: string;
		name: string;
		count: number;
	}>(sql, classifierQuery, classifierParams);

	// Live query for all classifiers (for filter screen)
	const { rows: allClassifiers } = useLiveQuery<{
		id: string;
		name: string;
	}>(sql, `SELECT id, name FROM classifier WHERE "userId" = $1 ORDER BY name`, [
		env.USER_ID
	]);

	// Transform to ClassifierFilterOption type, including all classifiers
	const classifierOptions: ClassifierFilterOption[] = useMemo(() => {
		// Create a map of classifier counts from classifications
		const countMap = new Map<string, number>();
		for (const row of rawClassifierOptions) {
			countMap.set(row.id, row.count);
		}

		// Include all classifiers, with count of 0 if no classifications
		return allClassifiers.map((classifier) => ({
			count: countMap.get(classifier.id) ?? 0,
			id: classifier.id,
			name: classifier.name
		}));
	}, [rawClassifierOptions, allClassifiers]);

	// Transform raw results to EmailWithClassification
	const emails: EmailWithClassification[] = useMemo(() => {
		return rawEmails.map((row) => ({
			accountId: row.accountId,
			archived: row.archived,
			body: row.body,
			classification:
				row.classification_id &&
				row.classifier_id &&
				row.classifier_name &&
				row.confidence !== null
					? {
							accountId: row.classification_accountId ?? row.accountId,
							classifierId: row.classifier_id,
							classifierName: row.classifier_name,
							confidence: row.confidence,
							createdAt: row.createdAt,
							emailId: row.id,
							gmailId: row.gmailId,
							id: row.classification_id,
							labelApplied: row.label_applied ?? false,
							labelName: row.label_name ?? "",
							reasoning: row.reasoning ?? "",
							runId: row.run_id,
							updatedAt: row.updatedAt,
							userId: row.userId
						}
					: undefined,
			createdAt: row.createdAt,
			date: row.date,
			from: row.from,
			gmailId: row.gmailId,
			id: row.id,
			labels: row.labels,
			snippet: row.snippet,
			subject: row.subject,
			threadId: row.threadId,
			to: row.to,
			unread: row.unread,
			updatedAt: row.updatedAt,
			userId: row.userId
		}));
	}, [rawEmails]);

	const error = actionError || (queryError?.message ?? null);

	// Keep selection visible in viewport
	const updateViewport = (newIndex: number) => {
		if (newIndex < viewportStart) {
			setViewportStart(newIndex);
		} else if (newIndex >= viewportStart + VISIBLE_ROWS) {
			setViewportStart(newIndex - VISIBLE_ROWS + 1);
		}
	};

	const handleResetClassification = async () => {
		const email = emails[selectedIndex];
		if (!email?.classification) return;

		await deleteEmailClassification(db, email.id);
		// Live query will auto-update
	};

	const isSentEmail = (email: EmailWithClassification) => {
		return email.labels.includes("SENT");
	};

	const isNoMatchClassification = (email: EmailWithClassification) => {
		return email.classification?.classifierId === NO_MATCH_CLASSIFIER_ID;
	};

	const canClassify = (email: EmailWithClassification) => {
		// Can classify if: not sent AND (no classification OR has "no match" classification)
		return (
			!isSentEmail(email) &&
			(!email.classification || isNoMatchClassification(email))
		);
	};

	const toggleSelection = (emailId: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(emailId)) {
				next.delete(emailId);
			} else {
				next.add(emailId);
			}
			return next;
		});
	};

	const clearSelection = () => {
		setSelectedIds(new Set());
	};

	const selectAll = () => {
		setSelectedIds(new Set(emails.map((e) => e.id)));
	};

	const selectNone = () => {
		setSelectedIds(new Set());
	};

	const allSelected =
		emails.length > 0 && emails.every((e) => selectedIds.has(e.id));

	const handleDeleteSingle = async () => {
		const email = emails[selectedIndex];
		if (!email) return;

		setProcessingAction("Deleting email...");
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("detail");
				return;
			}

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.trashEmail(email.gmailId);
			await deleteEmailsByIds(db, [email.id]);

			// Live query will auto-update
			setState("list");

			// Adjust selected index if needed
			if (selectedIndex >= emails.length - 1) {
				setSelectedIndex(Math.max(0, selectedIndex - 1));
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("detail");
		}
	};

	const handleArchiveSingle = async () => {
		const email = emails[selectedIndex];
		if (!email) return;

		setProcessingAction("Archiving email...");
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("detail");
				return;
			}

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.archiveEmail(email.gmailId);

			// Mark as archived locally
			await markEmailArchived(db, email.id);

			// Live query will auto-update
			setState("list");

			// Adjust selected index if needed
			if (selectedIndex >= emails.length - 1) {
				setSelectedIndex(Math.max(0, selectedIndex - 1));
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("detail");
		}
	};

	const handleBulkDelete = async () => {
		if (selectedIds.size === 0) return;

		setProcessingAction(`Deleting ${selectedIds.size} emails...`);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("list");
				return;
			}

			const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
			const gmailIds = selectedEmails.map((e) => e.gmailId);
			const emailIds = selectedEmails.map((e) => e.id);

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.trashEmails(gmailIds);
			await deleteEmailsByIds(db, emailIds);

			// Live query will auto-update
			clearSelection();
			setState("list");
			setSelectedIndex(0);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	const handleBulkArchive = async () => {
		if (selectedIds.size === 0) return;

		setProcessingAction(`Archiving ${selectedIds.size} emails...`);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("list");
				return;
			}

			const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
			const gmailIds = selectedEmails.map((e) => e.gmailId);
			const emailIds = selectedEmails.map((e) => e.id);

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.archiveEmails(gmailIds);

			// Mark as archived locally
			await markEmailsArchived(db, emailIds);

			// Live query will auto-update
			clearSelection();
			setState("list");
			setSelectedIndex(0);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	const handleToggleReadSingle = async () => {
		const email = emails[selectedIndex];
		if (!email) return;

		const markingAsRead = email.unread;
		setProcessingAction(
			markingAsRead ? "Marking as read..." : "Marking as unread..."
		);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("detail");
				return;
			}

			const gmail = new GmailClient(tokens.accessToken);
			if (markingAsRead) {
				await gmail.markAsRead(email.gmailId);
				await markEmailRead(db, email.id);
			} else {
				await gmail.markAsUnread(email.gmailId);
				await markEmailUnread(db, email.id);
			}

			// Live query will auto-update
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("detail");
		}
	};

	const handleBulkMarkRead = async () => {
		if (selectedIds.size === 0) return;

		setProcessingAction(`Marking ${selectedIds.size} emails as read...`);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("list");
				return;
			}

			const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
			const gmailIds = selectedEmails.map((e) => e.gmailId);
			const emailIds = selectedEmails.map((e) => e.id);

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.markEmailsAsRead(gmailIds);
			await markEmailsRead(db, emailIds);

			// Live query will auto-update
			clearSelection();
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	const handleBulkMarkUnread = async () => {
		if (selectedIds.size === 0) return;

		setProcessingAction(`Marking ${selectedIds.size} emails as unread...`);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("list");
				return;
			}

			const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
			const gmailIds = selectedEmails.map((e) => e.gmailId);
			const emailIds = selectedEmails.map((e) => e.id);

			const gmail = new GmailClient(tokens.accessToken);
			await gmail.markEmailsAsUnread(gmailIds);
			await markEmailsUnread(db, emailIds);

			// Live query will auto-update
			clearSelection();
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	const canSyncLabel = (email: EmailWithClassification) => {
		// Can sync if has classification, not "No Match", and label not already applied
		return (
			email.classification &&
			!isNoMatchClassification(email) &&
			!email.classification.labelApplied
		);
	};

	const handleSyncLabelSingle = async () => {
		const email = emails[selectedIndex];
		if (!email || !canSyncLabel(email)) return;

		setProcessingAction("Syncing label to Gmail...");
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("detail");
				return;
			}

			const gmail = new GmailClient(tokens.accessToken);
			if (!email.classification) return;
			const labelId = await gmail.getOrCreateLabel(
				email.classification.labelName
			);
			await gmail.addLabel(email.gmailId, labelId);
			await markLabelApplied(db, email.id);

			// Live query will auto-update
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("detail");
		}
	};

	const handleBulkSyncLabels = async () => {
		const emailsToSync = emails.filter(
			(e) => selectedIds.has(e.id) && canSyncLabel(e)
		);
		if (emailsToSync.length === 0) return;

		setProcessingAction(`Syncing labels for ${emailsToSync.length} emails...`);
		setState("processing");

		try {
			const tokens = await getGmailTokens(db, env.USER_ID);
			if (!tokens) {
				setActionError("Not authenticated with Gmail");
				setState("list");
				return;
			}

			const gmail = new GmailClient(tokens.accessToken);

			// Group by label name to batch apply
			const labelGroups = new Map<string, EmailWithClassification[]>();
			for (const e of emailsToSync) {
				if (!e.classification) continue;
				const labelName = e.classification.labelName;
				const group = labelGroups.get(labelName) ?? [];
				group.push(e);
				labelGroups.set(labelName, group);
			}

			// Apply labels by group
			for (const [labelName, groupEmails] of labelGroups) {
				const labelId = await gmail.getOrCreateLabel(labelName);
				for (const e of groupEmails) {
					await gmail.addLabel(e.gmailId, labelId);
				}
			}

			// Mark all as label applied in database
			const emailIds = emailsToSync.map((e) => e.id);
			await markLabelsApplied(db, emailIds);

			// Live query will auto-update
			clearSelection();
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	const handleClassifySingle = async () => {
		const email = emails[selectedIndex];
		if (!email || !canClassify(email)) return;

		// Delete any existing "no match" classification first
		if (isNoMatchClassification(email)) {
			await deleteEmailClassification(db, email.id);
		}

		setState("classifying");

		try {
			// Get user profile for context
			const userProfile = await getUserProfile(db, env.USER_ID);

			// Get enabled classifiers
			const classifiers = await findClassifiersByUserId(db, env.USER_ID);
			const enabledClassifiers = classifiers.filter((c) => c.enabled);

			if (enabledClassifiers.length === 0) {
				setActionError("No classifiers configured. Add one first.");
				setState("detail");
				return;
			}

			// Transform email to classifier input format
			const emailInput = {
				body: email.body,
				date: email.date,
				from: email.from,
				id: email.gmailId,
				snippet: email.snippet,
				subject: email.subject
			};

			// Run classification
			const results = await classifyEmailsParallel(
				[emailInput],
				enabledClassifiers,
				{ userContext: userProfile ?? undefined }
			);

			const result = results[0];
			if (result?.classifierId && result.confidence >= 0.7) {
				const classifier = enabledClassifiers.find(
					(c) => c.id === result.classifierId
				);

				if (classifier) {
					// Save classification to database
					const accountId = await getAccountId(db, env.USER_ID);
					if (accountId) {
						await upsertEmailClassification(db, {
							accountId,
							classifierId: classifier.id,
							classifierName: classifier.name,
							confidence: result.confidence,
							emailId: email.id,
							gmailId: email.gmailId,
							labelApplied: false,
							labelName: classifier.labelName,
							reasoning: "",
							userId: env.USER_ID
						});
					}
					// Live query will auto-update
				}
			}

			setState("detail");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("detail");
		}
	};

	const handleBulkClassify = async () => {
		// Get selected emails that can be classified
		const emailsToClassify = emails.filter(
			(e) => selectedIds.has(e.id) && canClassify(e)
		);
		if (emailsToClassify.length === 0) return;

		setState("classifying");
		setClassifyProgress({ current: 0, total: emailsToClassify.length });

		try {
			// Get user profile for context
			const userProfile = await getUserProfile(db, env.USER_ID);

			// Get enabled classifiers
			const classifiers = await findClassifiersByUserId(db, env.USER_ID);
			const enabledClassifiers = classifiers.filter((c) => c.enabled);

			if (enabledClassifiers.length === 0) {
				setActionError("No classifiers configured. Add one first.");
				setState("list");
				return;
			}

			// Delete any existing "no match" classifications first
			for (const email of emailsToClassify) {
				if (isNoMatchClassification(email)) {
					await deleteEmailClassification(db, email.id);
				}
			}

			// Transform emails to classifier input format
			const emailInputs = emailsToClassify.map((email) => ({
				body: email.body,
				date: email.date,
				from: email.from,
				id: email.gmailId,
				snippet: email.snippet,
				subject: email.subject
			}));

			// Run classification in parallel
			const results = await classifyEmailsParallel(
				emailInputs,
				enabledClassifiers,
				{ userContext: userProfile ?? undefined }
			);

			// Save classifications
			let _classified = 0;
			const accountId = await getAccountId(db, env.USER_ID);
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const email = emailsToClassify[i];

				if (email && result?.classifierId && result.confidence >= 0.7) {
					const classifier = enabledClassifiers.find(
						(c) => c.id === result.classifierId
					);

					if (classifier && accountId) {
						await upsertEmailClassification(db, {
							accountId,
							classifierId: classifier.id,
							classifierName: classifier.name,
							confidence: result.confidence,
							emailId: email.id,
							gmailId: email.gmailId,
							labelApplied: false,
							labelName: classifier.labelName,
							reasoning: "",
							userId: env.USER_ID
						});
						_classified++;
					}
				}

				setClassifyProgress({ current: i + 1, total: emailsToClassify.length });
			}

			clearSelection();
			setState("list");
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
			setState("list");
		}
	};

	useInput((input, key) => {
		// Ignore input while classifying or processing
		if (state === "classifying" || state === "processing") {
			return;
		}

		// Confirmation dialogs
		if (state === "confirm-delete") {
			if (input === "y" || input === "Y") {
				void handleBulkDelete();
			} else if (input === "n" || input === "N" || key.escape) {
				setState("list");
			}
			return;
		}

		if (state === "confirm-archive") {
			if (input === "y" || input === "Y") {
				void handleBulkArchive();
			} else if (input === "n" || input === "N" || key.escape) {
				setState("list");
			}
			return;
		}

		if (state === "confirm-sync-labels") {
			if (input === "y" || input === "Y") {
				void handleBulkSyncLabels();
			} else if (input === "n" || input === "N" || key.escape) {
				setState("list");
			}
			return;
		}

		if (state === "search") {
			if (key.escape) {
				setState("list");
				setSearchQuery("");
			}
			return;
		}

		if (state === "filter") {
			if (key.escape) {
				setState("list");
				setFilterIndex(0);
			} else if (key.upArrow) {
				setFilterIndex((i) => Math.max(0, i - 1));
			} else if (key.downArrow) {
				setFilterIndex((i) => Math.min(classifierOptions.length - 1, i + 1));
			} else if (input === " ") {
				// Space toggles selection
				const option = classifierOptions[filterIndex];
				if (option) {
					setSelectedClassifierIds((prev) =>
						prev.includes(option.id)
							? prev.filter((id) => id !== option.id)
							: [...prev, option.id]
					);
				}
			} else if (key.return) {
				// Enter applies filter and goes back to list
				setPage(0);
				setSelectedIndex(0);
				setViewportStart(0);
				setState("list");
			} else if (input === "c") {
				// Clear all selections
				setSelectedClassifierIds([]);
			}
			return;
		}

		if (state === "detail") {
			const currentEmail = emails[selectedIndex];
			if (key.escape) {
				setState("list");
			} else if (
				input === "R" &&
				currentEmail?.classification &&
				!isNoMatchClassification(currentEmail)
			) {
				void handleResetClassification();
			} else if (input === "c" && currentEmail && canClassify(currentEmail)) {
				void handleClassifySingle();
			} else if (input === "d" && currentEmail) {
				void handleDeleteSingle();
			} else if (input === "a" && currentEmail) {
				void handleArchiveSingle();
			} else if (input === "l" && currentEmail && canSyncLabel(currentEmail)) {
				void handleSyncLabelSingle();
			} else if (input === "r" && currentEmail) {
				void handleToggleReadSingle();
			}
			return;
		}

		// List state navigation
		if (key.escape) {
			setScreen("home");
			return;
		}

		if (input === "/") {
			setState("search");
			return;
		}

		if (input === "f") {
			setFilterIndex(0);
			setState("filter");
			return;
		}

		if (key.upArrow) {
			const newIndex = Math.max(0, selectedIndex - 1);
			setSelectedIndex(newIndex);
			updateViewport(newIndex);
		}

		if (key.downArrow) {
			const newIndex = Math.min(emails.length - 1, selectedIndex + 1);
			setSelectedIndex(newIndex);
			updateViewport(newIndex);
		}

		if (key.return) {
			if (emails[selectedIndex]) {
				setState("detail");
			}
		}

		if (key.rightArrow) {
			// Only allow next page if there are more emails
			// For search results (totalCount === -1), check if current page is full
			const hasMore =
				totalCount === -1
					? emails.length === PAGE_SIZE
					: (page + 1) * PAGE_SIZE < totalCount;
			if (hasMore) {
				setPage(page + 1);
				setSelectedIndex(0);
				setViewportStart(0);
				// Live query auto-updates with new page
			}
		}

		if (key.leftArrow) {
			if (page > 0) {
				setPage(page - 1);
				setSelectedIndex(0);
				setViewportStart(0);
				// Live query auto-updates with new page
			}
		}

		if (input === "z") {
			setActiveQuery("");
			setSearchQuery("");
			setSelectedClassifierIds([]);
			setPage(0);
			setSelectedIndex(0);
			setViewportStart(0);
			// Live query auto-updates with cleared filters
		}

		// Toggle view mode (all -> inbox -> unread -> archived -> all)
		if (input === "v") {
			const modes: ViewMode[] = ["all", "inbox", "unread", "archived"];
			const currentIndex = modes.indexOf(viewMode);
			const nextMode = modes[(currentIndex + 1) % modes.length] as ViewMode;
			setViewMode(nextMode);
			setPage(0);
			setSelectedIndex(0);
			setViewportStart(0);
			clearSelection();
			// Live query auto-updates with new viewMode
		}

		// Selection toggle with x or space
		if (input === "x" || input === " ") {
			const email = emails[selectedIndex];
			if (email) {
				toggleSelection(email.id);
			}
		}

		// Select all/none with A (shift+a)
		if (input === "A") {
			if (allSelected) {
				selectNone();
			} else {
				selectAll();
			}
		}

		// Bulk actions (require selection)
		if (input === "d") {
			if (selectedIds.size > 0) {
				setState("confirm-delete");
			}
		}

		if (input === "a") {
			if (selectedIds.size > 0) {
				setState("confirm-archive");
			}
		}

		// Sync labels (requires selection with emails that can sync)
		if (input === "l") {
			if (selectedIds.size > 0) {
				const emailsToSync = emails.filter(
					(e) => selectedIds.has(e.id) && canSyncLabel(e)
				);
				if (emailsToSync.length > 0) {
					setState("confirm-sync-labels");
				}
			}
		}

		// Mark as read (r) or unread (u) - bulk operations
		if (input === "r" && selectedIds.size > 0) {
			void handleBulkMarkRead();
		}

		if (input === "u" && selectedIds.size > 0) {
			void handleBulkMarkUnread();
		}

		// Classify selected emails
		if (input === "c" && selectedIds.size > 0 && state === "list") {
			void handleBulkClassify();
			return;
		}

		// Clear selection with Escape when items are selected
		if (key.escape && selectedIds.size > 0) {
			clearSelection();
			return;
		}
	});

	const handleSearch = () => {
		setActiveQuery(searchQuery);
		setPage(0);
		setSelectedIndex(0);
		setViewportStart(0);
		// Live query auto-updates with new activeQuery
		setState("list");
	};

	const formatDate = (date: Date) => {
		const d = new Date(date);
		const month = d.toLocaleDateString([], { month: "short" });
		const day = d.getDate();
		const time = d.toLocaleTimeString([], {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit"
		});
		return `${month} ${day} ${time}`;
	};

	const truncate = (str: string, len: number) => {
		if (str.length <= len) return str;
		return `${str.slice(0, len - 3)}...`;
	};

	if (isLoading && emails.length === 0) {
		return (
			<Box flexDirection="column">
				<Header title="Emails" />
				<Spinner label="Loading emails..." />
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column">
				<Header title="Emails" />
				<Text color="red">Error: {error}</Text>
				<Box marginTop={1}>
					<Text dimColor>Press esc to go back</Text>
				</Box>
			</Box>
		);
	}

	// Processing state (delete/archive in progress)
	if (state === "processing") {
		return (
			<Box flexDirection="column">
				<Header title="Emails" />
				<Spinner label={processingAction} />
			</Box>
		);
	}

	// Confirm delete dialog
	if (state === "confirm-delete") {
		return (
			<Box flexDirection="column">
				<Header title="Confirm Delete" />
				<Box flexDirection="column" marginBottom={1}>
					<Text color="red">
						Are you sure you want to delete {selectedIds.size} email
						{selectedIds.size > 1 ? "s" : ""}?
					</Text>
					<Text dimColor>This will move them to Trash in Gmail.</Text>
				</Box>
				<Box marginTop={1}>
					<Text>
						<Text bold color="green">
							y
						</Text>
						<Text dimColor> - Yes, delete</Text>
						{"  "}
						<Text bold color="red">
							n
						</Text>
						<Text dimColor> - No, cancel</Text>
					</Text>
				</Box>
			</Box>
		);
	}

	// Confirm archive dialog
	if (state === "confirm-archive") {
		return (
			<Box flexDirection="column">
				<Header title="Confirm Archive" />
				<Box flexDirection="column" marginBottom={1}>
					<Text color="yellow">
						Are you sure you want to archive {selectedIds.size} email
						{selectedIds.size > 1 ? "s" : ""}?
					</Text>
					<Text dimColor>This will remove them from your Inbox.</Text>
				</Box>
				<Box marginTop={1}>
					<Text>
						<Text bold color="green">
							y
						</Text>
						<Text dimColor> - Yes, archive</Text>
						{"  "}
						<Text bold color="red">
							n
						</Text>
						<Text dimColor> - No, cancel</Text>
					</Text>
				</Box>
			</Box>
		);
	}

	// Confirm sync labels dialog
	if (state === "confirm-sync-labels") {
		const emailsToSync = emails.filter(
			(e) => selectedIds.has(e.id) && canSyncLabel(e)
		);
		return (
			<Box flexDirection="column">
				<Header title="Confirm Sync Labels" />
				<Box flexDirection="column" marginBottom={1}>
					<Text color="cyan">
						Sync classifier labels to Gmail for {emailsToSync.length} email
						{emailsToSync.length > 1 ? "s" : ""}?
					</Text>
					<Text dimColor>
						This will apply the classifier label to each email in Gmail.
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text>
						<Text bold color="green">
							y
						</Text>
						<Text dimColor> - Yes, sync labels</Text>
						{"  "}
						<Text bold color="red">
							n
						</Text>
						<Text dimColor> - No, cancel</Text>
					</Text>
				</Box>
			</Box>
		);
	}

	// Classifying emails (single or bulk)
	if (state === "classifying") {
		const isBulk = classifyProgress.total > 1;
		return (
			<Box flexDirection="column">
				<Header title={isBulk ? "Classifying Emails" : "Email Detail"} />
				{isBulk ? (
					<Spinner
						label={`Classifying emails... ${classifyProgress.current}/${classifyProgress.total}`}
					/>
				) : (
					<>
						{emails[selectedIndex] && (
							<Box flexDirection="column" marginBottom={1}>
								<Text>
									<Text bold>Subject: </Text>
									{emails[selectedIndex].subject}
								</Text>
							</Box>
						)}
						<Spinner label="Classifying email..." />
					</>
				)}
			</Box>
		);
	}

	// Detail view
	if (state === "detail" && emails[selectedIndex]) {
		const email = emails[selectedIndex];
		return (
			<Box flexDirection="column">
				<Header title="Email Detail" />
				<Box flexDirection="column" marginBottom={1}>
					<Text>
						<Text bold>From: </Text>
						{email.from}
					</Text>
					<Text>
						<Text bold>To: </Text>
						{email.to}
					</Text>
					<Text>
						<Text bold>Date: </Text>
						{new Date(email.date).toLocaleString()}
					</Text>
					<Text>
						<Text bold>Subject: </Text>
						{email.subject}
					</Text>
					{email.labels.length > 0 && (
						<Text>
							<Text bold>Labels: </Text>
							{email.labels.join(", ")}
						</Text>
					)}
					{email.classification && (
						<Box flexDirection="column" marginTop={1}>
							{isNoMatchClassification(email) ? (
								<Text>
									<Text bold color="yellow">
										Classification:{" "}
									</Text>
									<Text color="yellow">No Match</Text>
									<Text dimColor> (press c to retry)</Text>
								</Text>
							) : (
								<>
									<Text>
										<Text bold color="green">
											Classification:{" "}
										</Text>
										<Text color="green">
											{email.classification.classifierName}
										</Text>
										<Text dimColor>
											{" "}
											({(email.classification.confidence * 100).toFixed(0)}%
											confidence)
										</Text>
									</Text>
									<Text>
										<Text bold>Label: </Text>
										{email.classification.labelName}
										{email.classification.labelApplied ? (
											<Text color="green"> (applied)</Text>
										) : (
											<Text dimColor> (not applied)</Text>
										)}
									</Text>
								</>
							)}
						</Box>
					)}
				</Box>
				<Box borderStyle="single" flexDirection="column" paddingX={1}>
					<Markdown>{email.body}</Markdown>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						esc: back | d: delete | a: archive | r:{" "}
						{email.unread ? "read" : "unread"}
						{canSyncLabel(email) ? " | l: sync label" : ""}
						{email.classification && !isNoMatchClassification(email)
							? " | R: reset classification"
							: canClassify(email)
								? " | c: classify"
								: ""}
					</Text>
				</Box>
			</Box>
		);
	}

	// Search input
	if (state === "search") {
		return (
			<Box flexDirection="column">
				<Header title="Search Emails" />
				<Box marginBottom={1}>
					<Text dimColor>Search by subject, sender, or snippet:</Text>
				</Box>
				<Box>
					<Text color="cyan">{">"} </Text>
					<TextInput
						onChange={setSearchQuery}
						onSubmit={handleSearch}
						placeholder="Enter search term..."
						value={searchQuery}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to search, esc to cancel</Text>
				</Box>
			</Box>
		);
	}

	// Filter by classifier
	if (state === "filter") {
		return (
			<Box flexDirection="column">
				<Header title="Filter by Classifier" />
				<Box marginBottom={1}>
					<Text dimColor>Select one or more classifiers to filter emails:</Text>
				</Box>
				{classifierOptions.length === 0 ? (
					<Box marginBottom={1}>
						<Text color="yellow">
							No classifiers configured. Add classifiers first.
						</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginBottom={1}>
						{classifierOptions.map((option, i) => {
							const isSelected = filterIndex === i;
							const isChecked = selectedClassifierIds.includes(option.id);
							return (
								<Box key={option.id}>
									<Text
										bold={isSelected}
										color={isSelected ? "cyan" : undefined}
									>
										{isSelected ? ">" : " "} [{isChecked ? "x" : " "}]{" "}
										{option.name}
										<Text dimColor> ({option.count})</Text>
									</Text>
								</Box>
							);
						})}
						{selectedClassifierIds.length > 0 && (
							<Box marginTop={1}>
								<Text dimColor>{selectedClassifierIds.length} selected</Text>
							</Box>
						)}
					</Box>
				)}
				<Box marginTop={1}>
					<Text dimColor>
						↑/↓: navigate | Space: toggle | Enter: apply | c: clear all | esc:
						cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// List view
	const startIdx = page * PAGE_SIZE + 1;
	const endIdx = startIdx + emails.length - 1;
	const pageInfo =
		totalCount >= 0
			? `${startIdx}-${endIdx} of ${totalCount}`
			: `${startIdx}-${endIdx}${emails.length === PAGE_SIZE ? "+" : ""}`;

	const hasFilters = activeQuery || selectedClassifierIds.length > 0;
	const selectedClassifierNames = classifierOptions
		.filter((o) => selectedClassifierIds.includes(o.id))
		.map((o) => o.name);

	const viewModes: { mode: ViewMode; label: string; color: string }[] = [
		{ color: "cyan", label: "All", mode: "all" },
		{ color: "green", label: "Inbox", mode: "inbox" },
		{ color: "magenta", label: "Unread", mode: "unread" },
		{ color: "yellow", label: "Archived", mode: "archived" }
	];

	return (
		<Box flexDirection="column">
			<Header
				subtitle={
					activeQuery
						? `Search: "${activeQuery}"`
						: `${totalCount} ${viewMode === "all" ? "" : viewMode} emails`
				}
				title="Emails"
			/>

			{/* View mode tabs */}
			<Box marginBottom={1}>
				<Text>View: </Text>
				{viewModes.map((vm, i) => (
					<Text key={vm.mode}>
						{i > 0 && <Text dimColor> | </Text>}
						<Text
							bold={viewMode === vm.mode}
							color={viewMode === vm.mode ? vm.color : "gray"}
							dimColor={viewMode !== vm.mode}
						>
							{vm.label}
						</Text>
					</Text>
				))}
				<Text dimColor> (v)</Text>
			</Box>

			{hasFilters && (
				<Box flexDirection="column" marginBottom={1}>
					{activeQuery && (
						<Text color="yellow">
							Search: <Text bold>{activeQuery}</Text>
						</Text>
					)}
					{selectedClassifierNames.length > 0 && (
						<Text color="magenta">
							Classifiers:{" "}
							<Text bold>{selectedClassifierNames.join(", ")}</Text>
						</Text>
					)}
					<Text dimColor>(press z to clear filters)</Text>
				</Box>
			)}

			{emails.length === 0 ? (
				<Box marginBottom={1}>
					<Text dimColor>
						{hasFilters
							? "No emails match your filters."
							: "No emails synced yet. Use Sync to download emails."}
					</Text>
				</Box>
			) : (
				<Box flexDirection="column" marginBottom={1}>
					{viewportStart > 0 && (
						<Text dimColor> ... {viewportStart} more above</Text>
					)}
					{emails
						.slice(viewportStart, viewportStart + VISIBLE_ROWS)
						.map((email, i) => {
							const actualIndex = viewportStart + i;
							const isCursor = actualIndex === selectedIndex;
							const isChecked = selectedIds.has(email.id);
							const fromPart = email.from.split("<")[0];
							const from = truncate(fromPart?.trim() || email.from, 18);
							const subject = truncate(email.subject || "(no subject)", 32);
							const date = formatDate(email.date);
							const isNoMatch = isNoMatchClassification(email);
							const classifierName = email.classification
								? isNoMatch
									? "No Match"
									: truncate(email.classification.classifierName, 12)
								: "";

							return (
								<Box key={email.id}>
									<Text bold={isCursor} color={isCursor ? "cyan" : undefined}>
										{isCursor ? ">" : " "}
									</Text>
									<Text color={isChecked ? "green" : "gray"}>
										[{isChecked ? "x" : " "}]
									</Text>
									<Text
										color={
											email.unread
												? "magenta"
												: email.archived
													? "yellow"
													: undefined
										}
									>
										{email.unread ? "●" : email.archived ? "○" : " "}
									</Text>
									<Text
										bold={isCursor || email.unread}
										color={isCursor ? "cyan" : undefined}
									>
										{" "}
										<Text dimColor={!isCursor && !email.unread}>
											{date.padEnd(12)}
										</Text>{" "}
										{from.padEnd(18)} {subject.padEnd(30)}{" "}
									</Text>
									{email.classification ? (
										<Text color={isNoMatch ? "yellow" : "green"}>
											{classifierName}
										</Text>
									) : (
										<Text dimColor>-</Text>
									)}
								</Box>
							);
						})}
					{viewportStart + VISIBLE_ROWS < emails.length && (
						<Text dimColor>
							{" "}
							... {emails.length - viewportStart - VISIBLE_ROWS} more below
						</Text>
					)}
				</Box>
			)}

			<Box flexDirection="column">
				<Box>
					<Text dimColor>
						Page {String(page + 1)} ({pageInfo})
					</Text>
					{selectedIds.size > 0 && (
						<Text color="green"> | {selectedIds.size} selected</Text>
					)}
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						↑/↓: navigate | x: select | A: {allSelected ? "deselect" : "select"}{" "}
						all | Enter: view | /: search | f: filter | v: view | ←/→: page |
						esc: back
					</Text>
				</Box>
				{selectedIds.size > 0 && (
					<Box>
						<Text dimColor>
							{emails.some((e) => selectedIds.has(e.id) && canClassify(e)) &&
								"c: classify | "}
							d: delete | a: archive |{" "}
							{emails.some((e) => selectedIds.has(e.id) && canSyncLabel(e)) &&
								"l: sync labels | "}
							r: read | u: unread | esc: clear
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
