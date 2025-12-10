#!/usr/bin/env bun
import { exists, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import externalsPlugin from "./plugins/externals-plugin";
import reactCompilerPlugin from "./plugins/react-compiler-plugin";

type Platform = "linux" | "darwin" | "windows";
type Arch = "x64" | "arm64";

interface BuildTarget {
	platform: Platform;
	arch: Arch;
	name: string;
	ext: string;
}

const ALL_TARGETS: BuildTarget[] = [
	{ arch: "x64", ext: "", name: "gmail-agent-linux-x64", platform: "linux" },
	{
		arch: "arm64",
		ext: "",
		name: "gmail-agent-linux-arm64",
		platform: "linux"
	},
	{ arch: "x64", ext: "", name: "gmail-agent-darwin-x64", platform: "darwin" },
	{
		arch: "arm64",
		ext: "",
		name: "gmail-agent-darwin-arm64",
		platform: "darwin"
	},
	{
		arch: "x64",
		ext: ".exe",
		name: "gmail-agent-windows-x64",
		platform: "windows"
	}
];

function getCurrentTarget(): BuildTarget {
	const platform = process.platform as Platform;
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const ext = platform === "windows" ? ".exe" : "";
	return {
		arch,
		ext,
		name: `gmail-agent-${platform}-${arch}`,
		platform
	};
}

function parseArgs(): { targets: BuildTarget[]; verbose: boolean } {
	const args = process.argv.slice(2);
	let verbose = false;
	const targetNames: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--all") {
			return { targets: ALL_TARGETS, verbose };
		}
		if (arg === "--verbose" || arg === "-v") {
			verbose = true;
			continue;
		}
		if (arg === "--target" || arg === "-t") {
			const target = args[++i];
			if (target) targetNames.push(target);
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
	}

	if (targetNames.length === 0) {
		// Default: build for current platform only
		return { targets: [getCurrentTarget()], verbose };
	}

	// Parse target names like "linux-x64", "darwin-arm64", etc.
	const targets: BuildTarget[] = [];
	for (const name of targetNames) {
		const [platform, arch] = name.split("-") as [Platform, Arch];
		const target = ALL_TARGETS.find(
			(t) => t.platform === platform && t.arch === arch
		);
		if (!target) {
			console.error(`Unknown target: ${name}`);
			console.error(
				"Available targets:",
				ALL_TARGETS.map((t) => `${t.platform}-${t.arch}`).join(", ")
			);
			process.exit(1);
		}
		targets.push(target);
	}

	return { targets, verbose };
}

function printHelp() {
	console.log(`
gmail-agent build script

Usage:
  bun run build              Build for current platform
  bun run build --all        Build for all platforms
  bun run build -t <target>  Build for specific target(s)

Options:
  --all              Build for all supported platforms
  -t, --target       Specify target platform (can be used multiple times)
  -v, --verbose      Show detailed build output
  -h, --help         Show this help message

Available targets:
  linux-x64          Linux x86_64
  linux-arm64        Linux ARM64
  darwin-x64         macOS Intel
  darwin-arm64       macOS Apple Silicon
  windows-x64        Windows x86_64

Examples:
  bun run build                           # Build for current platform
  bun run build --all                     # Build for all platforms
  bun run build -t darwin-arm64           # Build for macOS Apple Silicon
  bun run build -t linux-x64 -t linux-arm64   # Build for Linux only
`);
}

async function ensurePgliteAssets() {
	const pgliteAssetsDir = join(process.cwd(), "src/pglite-assets");
	if (!(await exists(join(pgliteAssetsDir, "pglite.wasm")))) {
		console.log("PGLite assets not found, running postinstall...\n");
		const proc = Bun.spawn(["bun", "run", "postinstall"], {
			cwd: process.cwd(),
			stdio: ["inherit", "inherit", "inherit"]
		});
		await proc.exited;
	}
}

async function buildTarget(
	target: BuildTarget,
	outdir: string,
	verbose: boolean
): Promise<boolean> {
	const targetStr = `${target.platform}-${target.arch}`;
	console.log(`  Building for ${targetStr}...`);

	const start = performance.now();

	const result = await Bun.build({
		compile: true,
		define: {
			"process.env.NODE_ENV": JSON.stringify("production")
		},
		entrypoints: ["index.tsx"],
		minify: true,
		outdir,
		plugins: [externalsPlugin(), reactCompilerPlugin()],
		target: `bun-${target.platform}-${target.arch}`
	});

	if (!result.success) {
		console.error(`  ✗ Build failed for ${targetStr}:`);
		for (const log of result.logs) {
			console.error(`    ${log}`);
		}
		return false;
	}

	// Rename output from "index" to target name
	const oldPath = join(outdir, `index${target.ext}`);
	const newPath = join(outdir, `${target.name}${target.ext}`);
	if (await exists(oldPath)) {
		await rename(oldPath, newPath);
	}

	const end = performance.now();
	const buildTime = ((end - start) / 1000).toFixed(2);

	if (verbose) {
		console.log(`  ✓ ${target.name}${target.ext} (${buildTime}s)`);
	} else {
		console.log(`  ✓ ${targetStr} (${buildTime}s)`);
	}

	return true;
}

async function main() {
	const { targets, verbose } = parseArgs();

	console.log("\n📦 gmail-agent build\n");

	const outdir = join(process.cwd(), "dist");

	// Clean previous build
	if (await exists(outdir)) {
		console.log("Cleaning previous build...");
		await rm(outdir, { force: true, recursive: true });
	}
	await mkdir(outdir, { recursive: true });

	// Ensure pglite assets exist
	await ensurePgliteAssets();

	const totalStart = performance.now();
	console.log(
		`\nBuilding ${targets.length} target${targets.length > 1 ? "s" : ""}:\n`
	);

	let successCount = 0;
	const failedTargets: string[] = [];

	for (const target of targets) {
		const success = await buildTarget(target, outdir, verbose);
		if (success) {
			successCount++;
		} else {
			failedTargets.push(`${target.platform}-${target.arch}`);
		}
	}

	const totalEnd = performance.now();
	const totalTime = ((totalEnd - totalStart) / 1000).toFixed(2);

	console.log(`\n${"─".repeat(40)}`);

	if (failedTargets.length > 0) {
		console.log(
			`\n⚠️  Build completed with errors (${successCount}/${targets.length} succeeded)`
		);
		console.log(`   Failed: ${failedTargets.join(", ")}`);
	} else {
		console.log(`\n✅ Build completed successfully in ${totalTime}s`);
	}

	console.log(`\n📁 Output directory: ${outdir}`);

	// List built files
	const files = await Array.fromAsync(
		new Bun.Glob("gmail-agent-*").scan(outdir)
	);
	if (files.length > 0) {
		console.log("\n   Built executables:");
		for (const file of files.sort()) {
			const stat = await Bun.file(join(outdir, file)).size;
			const sizeMB = (stat / 1024 / 1024).toFixed(1);
			console.log(`   • ${file} (${sizeMB} MB)`);
		}
	}

	console.log("");

	if (failedTargets.length > 0) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("Build error:", error);
	process.exit(1);
});
