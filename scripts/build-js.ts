#!/usr/bin/env bun
/**
 * Builds the project to a single cli.js file that runs on Node.js.
 * Output structure:
 *   dist/
 *     cli.js          - Main bundled JavaScript
 *     pglite.data     - PGlite data file
 *     pglite.wasm     - PGlite WebAssembly module
 */

import {
	access,
	chmod,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile
} from "node:fs/promises";
import { join } from "node:path";
import externalsPlugin from "../plugins/externals-plugin";
import reactCompilerPlugin from "../plugins/react-compiler-plugin";

async function main() {
	const verbose =
		process.argv.includes("-v") || process.argv.includes("--verbose");

	console.log("\n📦 Building cli.js for Node.js\n");

	const outdir = join(process.cwd(), "dist");

	// Clean previous build
	const outdirExists = await access(outdir)
		.then(() => true)
		.catch(() => false);
	if (outdirExists) {
		if (verbose) console.log("Cleaning previous build...");
		await rm(outdir, { force: true, recursive: true });
	}
	await mkdir(outdir, { recursive: true });

	const start = performance.now();

	const result = await Bun.build({
		define: {
			"process.env.NODE_ENV": JSON.stringify("production")
		},
		entrypoints: ["index.tsx"],
		minify: true,
		outdir,
		plugins: [externalsPlugin(), reactCompilerPlugin()],
		target: "node"
	});

	if (!result.success) {
		console.error("Build failed:");
		for (const log of result.logs) {
			console.error(log);
		}
		process.exit(1);
	}

	// Rename output files to consistent names and track original names
	const files = await readdir(outdir);
	let originalWasmName: string | null = null;
	let originalDataName: string | null = null;

	for (const file of files) {
		const filePath = join(outdir, file);

		if (file === "index.js") {
			await rename(filePath, join(outdir, "cli.js"));
		} else if (file.endsWith(".wasm") && file.startsWith("pglite-")) {
			originalWasmName = file;
			await rename(filePath, join(outdir, "pglite.wasm"));
		} else if (file.endsWith(".data") && file.startsWith("pglite-")) {
			originalDataName = file;
			await rename(filePath, join(outdir, "pglite.data"));
		}
	}

	// Update cli.js: fix shebang and update asset references
	const cliPath = join(outdir, "cli.js");
	let content = await readFile(cliPath, "utf-8");
	content = content
		.replace(/^#!\/usr\/bin\/env bun\n?/, "#!/usr/bin/env node\n")
		.replace(/^\/\/ @bun\n?/m, "");

	// Replace hashed filenames with consistent names
	if (originalWasmName) {
		content = content.replaceAll(originalWasmName, "pglite.wasm");
	}
	if (originalDataName) {
		content = content.replaceAll(originalDataName, "pglite.data");
	}

	await writeFile(cliPath, content);
	await chmod(cliPath, 0o755);

	const end = performance.now();
	const buildTime = ((end - start) / 1000).toFixed(2);

	console.log(`✅ Build completed in ${buildTime}s\n`);

	// List output files
	const outputFiles = await readdir(outdir);
	let totalSize = 0;

	console.log("Output files:");
	for (const file of outputFiles.sort()) {
		const stat = await Bun.file(join(outdir, file)).size;
		const sizeMB = (stat / 1024 / 1024).toFixed(2);
		totalSize += stat;
		console.log(`  ${file} (${sizeMB} MB)`);
	}

	console.log(`\nTotal: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
	console.log("\nTo test: node dist/cli.js --version\n");
}

main().catch((error) => {
	console.error("Build error:", error);
	process.exit(1);
});
