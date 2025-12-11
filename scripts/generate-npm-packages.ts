#!/usr/bin/env bun

/**
 * Generates the npm package for distribution.
 *
 * This creates a single gmail-agent package containing:
 *   - cli.js (bundled JavaScript with node shebang)
 *   - pglite-assets/pglite.wasm
 *   - pglite-assets/pglite.data
 *
 * Usage:
 *   bun scripts/generate-npm-packages.ts
 *
 * This should be run after `bun run build` to package the built files.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, "dist");
const NPM_DIR = join(ROOT, "npm");

// Read version from package.json
const VERSION = packageJson.version;

function generatePackage(): void {
	console.log("\n📦 Generating npm package\n");

	// Check if dist directory exists with required files
	const requiredFiles = [
		"cli.js",
		"pglite-assets/pglite.wasm",
		"pglite-assets/pglite.data"
	];
	for (const file of requiredFiles) {
		if (!existsSync(join(DIST_DIR, file))) {
			console.error(`Error: ${file} not found in dist/`);
			console.error("Run 'bun run build' first.");
			process.exit(1);
		}
	}

	// Clean and create npm directory
	if (existsSync(NPM_DIR)) {
		rmSync(NPM_DIR, { recursive: true });
	}

	const packageDir = join(NPM_DIR, "gmail-agent");
	const pgliteAssetsDir = join(packageDir, "pglite-assets");

	mkdirSync(pgliteAssetsDir, { recursive: true });

	console.log("Copying files...");

	// Copy built files
	cpSync(join(DIST_DIR, "cli.js"), join(packageDir, "cli.js"));
	cpSync(
		join(DIST_DIR, "pglite-assets/pglite.wasm"),
		join(pgliteAssetsDir, "pglite.wasm")
	);
	cpSync(
		join(DIST_DIR, "pglite-assets/pglite.data"),
		join(pgliteAssetsDir, "pglite.data")
	);

	// Generate package.json
	const npmPackageJson = {
		bin: {
			"gmail-agent": "cli.js"
		},
		bugs: {
			url: "https://github.com/abhi-slash-git/gmail-agent/issues"
		},
		description: "AI-powered email classification CLI tool",
		engines: {
			node: ">=18"
		},
		files: ["cli.js", "pglite-assets"],
		homepage: "https://github.com/abhi-slash-git/gmail-agent#readme",
		keywords: ["gmail", "email", "ai", "classification", "cli", "bedrock"],
		license: "MIT",
		name: "gmail-agent",
		publishConfig: {
			access: "public"
		},
		repository: {
			type: "git",
			url: "git+https://github.com/abhi-slash-git/gmail-agent.git"
		},
		version: VERSION
	};

	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify(npmPackageJson, null, 2)
	);

	// Copy README from root
	cpSync(join(ROOT, "README.md"), join(packageDir, "README.md"));

	// Calculate total size
	const files = [
		"cli.js",
		"pglite-assets/pglite.wasm",
		"pglite-assets/pglite.data",
		"package.json",
		"README.md"
	];
	let totalSize = 0;

	console.log("\nPackage contents:");
	for (const file of files) {
		const filePath = join(packageDir, file);
		if (existsSync(filePath)) {
			const stat = Bun.file(filePath).size;
			totalSize += stat;
			const sizeMB =
				stat > 1024 * 1024
					? `${(stat / 1024 / 1024).toFixed(2)} MB`
					: `${(stat / 1024).toFixed(2)} KB`;
			console.log(`  ${file} (${sizeMB})`);
		}
	}

	console.log(`\nTotal: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
	console.log("\n✅ npm package generated in ./npm/gmail-agent/");
	console.log("\nTo publish:");
	console.log("  cd npm/gmail-agent && npm publish");
	console.log("\nTo test locally:");
	console.log("  cd npm/gmail-agent && npm pack");
	console.log("  npm install -g gmail-agent-*.tgz");
	console.log("");
}

generatePackage();
