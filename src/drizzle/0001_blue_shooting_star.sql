CREATE TABLE "email" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"date" timestamp NOT NULL,
	"from" text NOT NULL,
	"gmailId" text NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"snippet" text NOT NULL,
	"subject" text NOT NULL,
	"threadId" text NOT NULL,
	"to" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "email_gmailId_unique" UNIQUE("gmailId")
);
