CREATE TABLE "sync_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"gmailId" text NOT NULL,
	"userId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retryCount" bigint DEFAULT 0 NOT NULL,
	"lastError" text,
	"syncedAt" timestamp,
	CONSTRAINT "sync_queue_gmailId_userId_unique" UNIQUE("gmailId","userId")
);
--> statement-breakpoint
CREATE INDEX "sync_queue_user_status_idx" ON "sync_queue" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "sync_queue_gmail_id_idx" ON "sync_queue" USING btree ("gmailId");