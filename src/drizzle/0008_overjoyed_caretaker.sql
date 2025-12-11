ALTER TABLE "account" ADD COLUMN "defaultClassifiersSeeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_run" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "classifier" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_classification" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_run" ADD CONSTRAINT "classification_run_accountId_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifier" ADD CONSTRAINT "classifier_accountId_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email" ADD CONSTRAINT "email_accountId_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_classification" ADD CONSTRAINT "email_classification_accountId_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_accountId_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;