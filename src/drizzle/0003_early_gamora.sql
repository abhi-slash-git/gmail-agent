CREATE INDEX "account_user_provider_idx" ON "account" USING btree ("userId","providerId");--> statement-breakpoint
CREATE INDEX "classifier_user_idx" ON "classifier" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "email_user_date_idx" ON "email" USING btree ("userId","date");--> statement-breakpoint
CREATE INDEX "email_gmail_id_idx" ON "email" USING btree ("gmailId");--> statement-breakpoint
CREATE INDEX "email_classification_email_idx" ON "email_classification" USING btree ("emailId");--> statement-breakpoint
CREATE INDEX "email_classification_user_idx" ON "email_classification" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "email_classification_gmail_idx" ON "email_classification" USING btree ("gmailId");