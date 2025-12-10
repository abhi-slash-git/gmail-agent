CREATE TABLE "email_classification" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"classifierId" text NOT NULL,
	"classifierName" text NOT NULL,
	"confidence" double precision NOT NULL,
	"emailId" text NOT NULL,
	"gmailId" text NOT NULL,
	"labelApplied" boolean DEFAULT false NOT NULL,
	"labelName" text NOT NULL,
	"reasoning" text NOT NULL,
	"runId" text,
	"userId" text NOT NULL,
	CONSTRAINT "email_classification_emailId_classifierId_unique" UNIQUE("emailId","classifierId")
);
