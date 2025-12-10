CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"accessToken" text,
	"accessTokenExpiresAt" timestamp,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"refreshToken" text,
	"scope" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_run" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"emailsClassified" bigint DEFAULT 0 NOT NULL,
	"emailsProcessed" bigint DEFAULT 0 NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifier" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"labelName" text NOT NULL,
	"name" text NOT NULL,
	"priority" bigint DEFAULT 0,
	"userId" text NOT NULL
);
