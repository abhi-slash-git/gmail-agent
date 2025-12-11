import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGliteOptions } from "@electric-sql/pglite";
import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";

// Resolve paths relative to the script location (works in both Bun and Node.js)
const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, "pglite-assets/pglite.wasm");
const dataPath = join(__dirname, "pglite-assets/pglite.data");

export async function createPGlite(
	dataDir: string,
	options?: PGliteOptions
): Promise<PGlite> {
	// Read the embedded files using Node.js fs
	const [wasmBuffer, dataBuffer] = await Promise.all([
		readFile(wasmPath),
		readFile(dataPath)
	]);

	// Compile the WASM module
	const wasmModule = await WebAssembly.compile(wasmBuffer);

	// Create a Blob for the fs bundle
	const fsBundle = new Blob([dataBuffer]);

	// Create PGlite instance with pre-loaded modules
	const db = await PGlite.create(dataDir, {
		...options,
		extensions: { live },
		fsBundle,
		wasmModule
	});

	return db;
}
