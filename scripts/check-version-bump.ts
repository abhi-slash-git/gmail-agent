#!/usr/bin/env bun

/**
 * Pre-push hook script to check if version has been bumped before pushing to main.
 * Called from .husky/pre-push
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function getLocalVersion(): string {
	const packageJson = JSON.parse(
		readFileSync(join(ROOT, "package.json"), "utf-8")
	);
	return packageJson.version;
}

function getRemoteVersion(remote: string): string | null {
	const result = Bun.spawnSync([
		"git",
		"show",
		`${remote}/main:package.json`
	]);

	if (result.exitCode !== 0) {
		return null;
	}

	try {
		const packageJson = JSON.parse(result.stdout.toString());
		return packageJson.version;
	} catch {
		return null;
	}
}

function getCurrentBranch(): string {
	const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
	return result.stdout.toString().trim();
}

function main(): void {
	const branch = getCurrentBranch();

	// Only check when pushing to main
	if (branch !== "main") {
		process.exit(0);
	}

	// Get remote from args (passed by git)
	const remote = process.argv[2] || "origin";

	const localVersion = getLocalVersion();
	const remoteVersion = getRemoteVersion(remote);

	if (remoteVersion === null) {
		console.log("✅ First push or new repo - skipping version check");
		process.exit(0);
	}

	if (localVersion === remoteVersion) {
		console.log("");
		console.log("⚠️  Version not bumped!");
		console.log("");
		console.log(`   Local version:  ${localVersion}`);
		console.log(`   Remote version: ${remoteVersion}`);
		console.log("");
		console.log("   To bump version, update package.json and commit.");
		console.log("   To skip this check, use: git push --no-verify");
		console.log("");
		process.exit(1);
	}

	console.log(`✅ Version bumped: ${remoteVersion} → ${localVersion}`);
	process.exit(0);
}

main();
