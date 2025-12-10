import type { PGliteOptions } from "@electric-sql/pglite";
import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";
import dataPath from "./pglite-assets/pglite.data" with { type: "file" };
import wasmPath from "./pglite-assets/pglite.wasm" with { type: "file" };

export async function createPGlite(
	dataDir: string,
	options?: PGliteOptions
): Promise<PGlite> {
	// Read the embedded files
	const [wasmBuffer, dataBuffer] = await Promise.all([
		Bun.file(wasmPath).arrayBuffer(),
		Bun.file(dataPath).arrayBuffer()
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
