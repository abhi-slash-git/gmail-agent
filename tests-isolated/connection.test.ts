/**
 * Tests for DatabaseConnection class in connection.ts
 *
 * IMPORTANT: This test file must be run in ISOLATION because it mocks
 * the pglite-wrapper module which would interfere with other tests.
 *
 * Run with: bun test tests-isolated/connection.test.ts
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Mock PGlite instance
const mockPGlite = {
	close: mock(() => Promise.resolve()),
	execute: mock(() => Promise.resolve({ rows: [] })),
	query: mock(() => Promise.resolve({ rows: [] }))
};

// Mock createPGlite
const mockCreatePGlite = mock(() => Promise.resolve(mockPGlite));

mock.module("../src/pglite-wrapper", () => ({
	createPGlite: mockCreatePGlite
}));

// Mock node:fs/promises to prevent actual filesystem operations
mock.module("node:fs/promises", () => ({
	mkdir: mock(() => Promise.resolve())
}));

// Mock migrations - empty array means no migrations to run
mock.module("../src/database/migrations", () => ({
	migrations: []
}));

describe("DatabaseConnection", () => {
	beforeEach(() => {
		mockCreatePGlite.mockClear();
		mockPGlite.close.mockClear();
		mockPGlite.execute.mockClear();
		mockPGlite.query.mockClear();
	});

	afterEach(async () => {
		// Clean up singleton
		const { closeDatabase } = await import("../src/database/connection");
		await closeDatabase();
	});

	test("DatabaseConnection.instance creates a connection", async () => {
		const { DatabaseConnection } = await import("../src/database/connection");

		const conn = await DatabaseConnection.instance("/test/db/path");

		expect(mockCreatePGlite).toHaveBeenCalledWith("/test/db/path");
		expect(conn.sql).toBe(mockPGlite);
		expect(conn.db).toBeDefined();
	});

	test("migrate runs without error", async () => {
		const { DatabaseConnection } = await import("../src/database/connection");

		const conn = await DatabaseConnection.instance("/test/db/path");

		// migrate should complete without throwing
		await conn.migrate();

		// waitForMigrations should also resolve
		await conn.waitForMigrations();

		expect(true).toBe(true);
	});

	test("close calls sql.close", async () => {
		const { DatabaseConnection } = await import("../src/database/connection");

		const conn = await DatabaseConnection.instance("/test/db/path");
		await conn.close();

		expect(mockPGlite.close).toHaveBeenCalled();
	});

	test("waitForMigrations resolves after migrate completes", async () => {
		const { DatabaseConnection } = await import("../src/database/connection");

		const conn = await DatabaseConnection.instance("/test/db/path");

		// Start migration (will resolve the promise)
		const migratePromise = conn.migrate();

		// Wait should resolve after migrate
		await Promise.all([migratePromise, conn.waitForMigrations()]);

		// No assertion needed - if it doesn't hang, it works
		expect(true).toBe(true);
	});
});

describe("getDatabase", () => {
	afterEach(async () => {
		const { closeDatabase } = await import("../src/database/connection");
		await closeDatabase();
	});

	test("returns database instance", async () => {
		const { getDatabase } = await import("../src/database/connection");

		const db = await getDatabase("/test/db/path");

		expect(db).toBeDefined();
		expect(mockCreatePGlite).toHaveBeenCalledWith("/test/db/path");
	});

	test("returns cached database on second call", async () => {
		const { getDatabase } = await import("../src/database/connection");

		const db1 = await getDatabase("/test/db/path");
		const callCount = mockCreatePGlite.mock.calls.length;

		const db2 = await getDatabase("/test/db/path");

		expect(db1).toBe(db2);
		expect(mockCreatePGlite.mock.calls.length).toBe(callCount); // No additional calls
	});
});

describe("getPGlite", () => {
	afterEach(async () => {
		const { closeDatabase } = await import("../src/database/connection");
		await closeDatabase();
	});

	test("returns null when no connection", async () => {
		const { getPGlite } = await import("../src/database/connection");

		const result = getPGlite();

		expect(result).toBeNull();
	});

	test("returns PGlite instance after getDatabase is called", async () => {
		const { getDatabase, getPGlite } = await import(
			"../src/database/connection"
		);

		await getDatabase("/test/db/path");
		const result = getPGlite();

		expect(result).toBe(mockPGlite);
	});
});

describe("closeDatabase", () => {
	test("closes and clears connection", async () => {
		const { closeDatabase, getDatabase, getPGlite } = await import(
			"../src/database/connection"
		);

		await getDatabase("/test/db/path");
		expect(getPGlite()).not.toBeNull();

		await closeDatabase();

		expect(mockPGlite.close).toHaveBeenCalled();
		expect(getPGlite()).toBeNull();
	});

	test("does nothing when no connection exists", async () => {
		mockPGlite.close.mockClear();

		const { closeDatabase } = await import("../src/database/connection");
		await closeDatabase();

		expect(mockPGlite.close).not.toHaveBeenCalled();
	});
});
