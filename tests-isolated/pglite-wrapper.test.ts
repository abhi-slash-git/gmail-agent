/**
 * Tests for pglite-wrapper.ts
 *
 * IMPORTANT: This test file must be run in ISOLATION because it mocks
 * @electric-sql/pglite which would interfere with other tests.
 *
 * Run with: bun run test:pglite
 *
 * This file is in a separate directory and excluded from the main test run.
 */
import {
	afterAll,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test
} from "bun:test";

// Set up mocks for pglite
const mockPGliteInstance = {
	close: mock(() => Promise.resolve()),
	exec: mock(() => Promise.resolve()),
	query: mock(() => Promise.resolve({ rows: [] }))
};

const mockPGliteCreate = mock(() => Promise.resolve(mockPGliteInstance));

mock.module("@electric-sql/pglite", () => ({
	PGlite: {
		create: mockPGliteCreate
	}
}));

mock.module("@electric-sql/pglite/live", () => ({
	live: { name: "live" }
}));

mock.module("../src/pglite-assets/pglite.data", () => ({
	default: "/mock/path/pglite.data"
}));

mock.module("../src/pglite-assets/pglite.wasm", () => ({
	default: "/mock/path/pglite.wasm"
}));

const mockArrayBuffer = new ArrayBuffer(8);
const mockWasmModule = { exports: {} };
const originalCompile = WebAssembly.compile;

describe("pglite-wrapper", () => {
	beforeEach(() => {
		mockPGliteCreate.mockClear();

		spyOn(Bun, "file").mockImplementation(
			() =>
				({
					arrayBuffer: () => Promise.resolve(mockArrayBuffer)
				}) as unknown as ReturnType<typeof Bun.file>
		);

		WebAssembly.compile = mock(() =>
			Promise.resolve(mockWasmModule as WebAssembly.Module)
		);
	});

	afterAll(() => {
		WebAssembly.compile = originalCompile;
	});

	test("createPGlite creates a PGlite instance", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		const db = await createPGlite("/test/db/path");

		expect(db).toBe(mockPGliteInstance);
		expect(mockPGliteCreate).toHaveBeenCalledTimes(1);
	});

	test("createPGlite reads wasm and data files via Bun.file", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		const callsBefore = (Bun.file as ReturnType<typeof mock>).mock.calls.length;

		await createPGlite("/test/db/path");

		const callsAfter = (Bun.file as ReturnType<typeof mock>).mock.calls.length;
		expect(callsAfter - callsBefore).toBe(2);
	});

	test("createPGlite passes dataDir to PGlite.create", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		await createPGlite("/custom/data/dir");

		expect(mockPGliteCreate).toHaveBeenCalledWith(
			"/custom/data/dir",
			expect.objectContaining({
				extensions: expect.any(Object),
				fsBundle: expect.any(Blob),
				wasmModule: mockWasmModule
			})
		);
	});

	test("createPGlite merges custom options", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		await createPGlite("/test/path", { debug: 1 });

		expect(mockPGliteCreate).toHaveBeenCalledWith(
			"/test/path",
			expect.objectContaining({
				debug: 1,
				extensions: expect.any(Object)
			})
		);
	});

	test("createPGlite compiles WebAssembly module", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		await createPGlite("/test/path");

		expect(WebAssembly.compile).toHaveBeenCalledWith(mockArrayBuffer);
	});

	test("createPGlite creates Blob from data buffer for fsBundle", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		await createPGlite("/test/path");

		const call = mockPGliteCreate.mock.calls[0] as [
			string,
			Record<string, unknown>
		];
		expect(call[1].fsBundle).toBeInstanceOf(Blob);
	});

	test("createPGlite includes live extension", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		await createPGlite("/test/path");

		const call = mockPGliteCreate.mock.calls[0] as [
			string,
			Record<string, unknown>
		];
		expect(call[1].extensions).toHaveProperty("live");
	});

	test("createPGlite returns PGlite instance from create", async () => {
		const { createPGlite } = await import("../src/pglite-wrapper");
		const result = await createPGlite("/test/path");

		expect(result).toEqual(mockPGliteInstance);
	});
});
