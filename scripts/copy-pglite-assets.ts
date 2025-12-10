import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function copyAssets() {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);

	const assets = ["pglite.wasm", "pglite.data"];
	const srcDir = join(__dirname, "../node_modules/@electric-sql/pglite/dist");
	const destDir = join(__dirname, "../src/pglite-assets");

	console.log("📦 Copying pglite assets...");
	// 🧹 Remove old assets if they exist
	await rm(destDir, { force: true, recursive: true });
	await mkdir(destDir, { recursive: true });
	for (const asset of assets) {
		const srcPath = join(srcDir, asset);
		const destPath = join(destDir, asset);
		await cp(srcPath, destPath);
		console.log(`✅ Copied ${asset} to ${destDir}`);
	}
}

copyAssets().catch((err) => {
	console.error("❌ Failed to copy pglite assets:", err);
	process.exit(1);
});
