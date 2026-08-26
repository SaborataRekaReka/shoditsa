ALTER TABLE "auth_events" ADD COLUMN "acquisition_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_events" ADD COLUMN "entry_source" text;--> statement-breakpoint
ALTER TABLE "auth_events" ADD COLUMN "search_engine" text;--> statement-breakpoint
ALTER TABLE "auth_events" ADD COLUMN "entry_path" text;--> statement-breakpoint
ALTER TABLE "auth_events" ADD COLUMN "referrer_host" text;--> statement-breakpoint
CREATE INDEX "auth_event_acquisition_occurred_idx" ON "auth_events" USING btree ("acquisition_id","occurred_at");