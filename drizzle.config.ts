import type { Config } from "drizzle-kit";

export default {
	casing: "camelCase",
	dbCredentials: {
		url: "idb://gmail-agent"
	},
	dialect: "postgresql",
	driver: "pglite",
	out: "./src/drizzle",
	schema: "./src/database/schema.ts"
} satisfies Config;
