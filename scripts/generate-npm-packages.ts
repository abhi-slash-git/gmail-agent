#!/usr/bin/env bun

/**
 * Generates npm packages for distribution.
 *
 * This creates:
 * 1. Platform-specific packages
 * 2. The main gmail-agent package that depends on them
 *
 * Usage:
 *   bun scripts/generate-npm-packages.ts
 *
 * This should be run after `bun run build:all` to package the built binaries.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.0.0";

interface PlatformConfig {
	npm: string; // npm platform name (darwin, linux, win32)
	arch: string; // npm arch name (arm64, x64)
	binaryName: string; // name of the built binary
	ext: string; // file extension
}

const PLATFORMS: PlatformConfig[] = [
	{
		arch: "arm64",
		binaryName: "gmail-agent-darwin-arm64",
		ext: "",
		npm: "darwin"
	},
	{ arch: "x64", binaryName: "gmail-agent-darwin-x64", ext: "", npm: "darwin" },
	{
		arch: "arm64",
		binaryName: "gmail-agent-linux-arm64",
		ext: "",
		npm: "linux"
	},
	{ arch: "x64", binaryName: "gmail-agent-linux-x64", ext: "", npm: "linux" },
	{
		arch: "x64",
		binaryName: "gmail-agent-windows-x64",
		ext: ".exe",
		npm: "win32"
	}
];

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, "dist");
const NPM_DIR = join(ROOT, "npm");

function generatePlatformPackage(platform: PlatformConfig): void {
	const packageName = `gmail-agent-${platform.npm}-${platform.arch}`;
	const packageDir = join(NPM_DIR, packageName);
	const binDir = join(packageDir, "bin");

	console.log(`  Creating ${packageName}...`);

	// Clean and create directories
	if (existsSync(packageDir)) {
		rmSync(packageDir, { recursive: true });
	}
	mkdirSync(binDir, { recursive: true });

	// Copy binary
	const sourceBinary = join(DIST_DIR, `${platform.binaryName}${platform.ext}`);
	const targetBinary = join(
		binDir,
		platform.npm === "win32" ? "gmail-agent.exe" : "gmail-agent"
	);

	if (!existsSync(sourceBinary)) {
		console.error(`    ⚠ Binary not found: ${sourceBinary}`);
		return;
	}

	cpSync(sourceBinary, targetBinary);

	// Generate package.json
	const packageJson = {
		bin: {
			"gmail-agent":
				platform.npm === "win32" ? "bin/gmail-agent.exe" : "bin/gmail-agent"
		},
		cpu: [platform.arch],
		description: `gmail-agent binary for ${platform.npm} ${platform.arch}`,
		files: ["bin"],
		license: "MIT",
		name: packageName,
		os: [platform.npm],
		publishConfig: {
			access: "public"
		},
		repository: {
			type: "git",
			url: "https://github.com/anthropics/gmail-agent.git"
		},
		version: VERSION
	};

	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify(packageJson, null, 2)
	);

	// Generate README
	const readme = `# ${packageName}

This package contains the gmail-agent binary for ${platform.npm} ${platform.arch}.

This is not meant to be installed directly. Instead, install the main package:

\`\`\`bash
npm install -g gmail-agent
\`\`\`

The correct binary for your platform will be selected automatically.
`;

	writeFileSync(join(packageDir, "README.md"), readme);

	console.log(`    ✓ ${packageName}`);
}

function generateMainPackage(): void {
	console.log("  Creating main gmail-agent package...");

	const packageDir = join(NPM_DIR, "gmail-agent");
	const binDir = join(packageDir, "bin");

	// Clean and create directories
	if (existsSync(packageDir)) {
		rmSync(packageDir, { recursive: true });
	}
	mkdirSync(binDir, { recursive: true });

	// Generate optionalDependencies
	const optionalDependencies: Record<string, string> = {};
	for (const platform of PLATFORMS) {
		const pkgName = `gmail-agent-${platform.npm}-${platform.arch}`;
		optionalDependencies[pkgName] = VERSION;
	}

	// Generate package.json
	const packageJson = {
		author: "Anthropic",
		bin: {
			"gmail-agent": "bin/gmail-agent"
		},
		description: "AI-powered email classification CLI tool",
		engines: {
			node: ">=18"
		},
		keywords: [
			"gmail",
			"email",
			"ai",
			"classification",
			"cli",
			"anthropic",
			"claude"
		],
		license: "MIT",
		name: "gmail-agent",
		optionalDependencies,
		publishConfig: {
			access: "public"
		},
		repository: {
			type: "git",
			url: "https://github.com/anthropics/gmail-agent.git"
		},
		scripts: {
			postinstall: "node install.js"
		},
		version: VERSION
	};

	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify(packageJson, null, 2)
	);

	// Copy install.js (already exists from earlier)
	const installScript = `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PLATFORMS = {
	"darwin-arm64": "gmail-agent-darwin-arm64",
	"darwin-x64": "gmail-agent-darwin-x64",
	"linux-arm64": "gmail-agent-linux-arm64",
	"linux-x64": "gmail-agent-linux-x64",
	"win32-x64": "gmail-agent-win32-x64"
};

function getPlatformPackage() {
	const platform = process.platform;
	const arch = process.arch;
	const key = \`\${platform}-\${arch}\`;

	const pkg = PLATFORMS[key];
	if (!pkg) {
		console.error(\`gmail-agent: Unsupported platform: \${key}\`);
		console.error(\`Supported platforms: \${Object.keys(PLATFORMS).join(", ")}\`);
		process.exit(1);
	}

	return pkg;
}

function findBinary(packageName) {
	const possiblePaths = [
		path.join(__dirname, "node_modules", packageName, "bin", "gmail-agent"),
		path.join(__dirname, "..", packageName, "bin", "gmail-agent"),
		path.join(__dirname, "node_modules", packageName, "bin", "gmail-agent.exe"),
		path.join(__dirname, "..", packageName, "bin", "gmail-agent.exe")
	];

	for (const p of possiblePaths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}

	return null;
}

function main() {
	const packageName = getPlatformPackage();
	const binaryPath = findBinary(packageName);

	if (!binaryPath) {
		console.error(\`gmail-agent: Could not find binary for \${packageName}\`);
		console.error("Try reinstalling: npm install -g gmail-agent");
		process.exit(1);
	}

	const binDir = path.join(__dirname, "bin");
	if (!fs.existsSync(binDir)) {
		fs.mkdirSync(binDir, { recursive: true });
	}

	const isWindows = process.platform === "win32";
	const targetName = isWindows ? "gmail-agent.exe" : "gmail-agent";
	const targetPath = path.join(binDir, targetName);

	if (fs.existsSync(targetPath)) {
		fs.unlinkSync(targetPath);
	}

	if (isWindows) {
		fs.copyFileSync(binaryPath, targetPath);
	} else {
		fs.symlinkSync(binaryPath, targetPath);
		fs.chmodSync(targetPath, 0o755);
	}
}

main();
`;

	writeFileSync(join(packageDir, "install.js"), installScript);

	// Create placeholder bin script
	const binPlaceholder = `#!/usr/bin/env node
console.error("gmail-agent: binary not installed correctly");
console.error("Please try reinstalling: npm install -g gmail-agent");
process.exit(1);
`;
	writeFileSync(join(binDir, "gmail-agent"), binPlaceholder);

	// Generate README
	const readme = `# gmail-agent

AI-powered email classification CLI tool.

## Installation

\`\`\`bash
npm install -g gmail-agent
\`\`\`

## Usage

\`\`\`bash
# Launch interactive TUI
gmail-agent

# Show help
gmail-agent --help

# Show version
gmail-agent --version
\`\`\`

## Documentation

See the full documentation at: https://github.com/anthropics/gmail-agent

## License

MIT
`;

	writeFileSync(join(packageDir, "README.md"), readme);

	console.log("    ✓ gmail-agent");
}

function main() {
	console.log("\n📦 Generating npm packages\n");

	// Check if dist directory exists
	if (!existsSync(DIST_DIR)) {
		console.error("Error: dist/ directory not found.");
		console.error("Run 'bun run build:all' first to build the binaries.");
		process.exit(1);
	}

	// Clean and create npm directory
	if (existsSync(NPM_DIR)) {
		rmSync(NPM_DIR, { recursive: true });
	}
	mkdirSync(NPM_DIR, { recursive: true });

	console.log("Creating platform-specific packages:\n");

	// Generate platform packages
	for (const platform of PLATFORMS) {
		generatePlatformPackage(platform);
	}

	console.log("\nCreating main package:\n");

	// Generate main package
	generateMainPackage();

	console.log("\n✅ npm packages generated in ./npm/");
	console.log("\nTo publish:");
	console.log(
		"  cd npm/gmail-agent-darwin-arm64 && npm publish --access public"
	);
	console.log("  cd npm/gmail-agent-darwin-x64 && npm publish --access public");
	console.log(
		"  cd npm/gmail-agent-linux-arm64 && npm publish --access public"
	);
	console.log("  cd npm/gmail-agent-linux-x64 && npm publish --access public");
	console.log("  cd npm/gmail-agent-win32-x64 && npm publish --access public");
	console.log("  cd npm/gmail-agent && npm publish --access public");
	console.log("");
}

main();
