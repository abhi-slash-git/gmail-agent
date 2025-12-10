import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

async function compileMigrations() {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);

	console.log("🔎 Reading migration files...");
	const migrations = readMigrationFiles({
		migrationsFolder: "./src/drizzle"
	});

	console.log("💾 Writing migrations JSON file...");
	await writeFile(
		join(__dirname, "../src/drizzle/migrations.json"),
		JSON.stringify(migrations, null, 2),
		"utf8"
	);

	console.log("✅ Migrations compiled successfully!");
}

compileMigrations().catch((err) => {
	console.error("❌ Failed to compile migrations:", err);
	process.exit(1);
});
