CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "content_report_reason_check" CHECK ("content_reports"."reason" in ('wrong_fact','disputed_comparison','title_not_found','bad_hint','other')),
	CONSTRAINT "content_report_status_check" CHECK ("content_reports"."status" in ('open','resolved','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "legacy_imports" DROP CONSTRAINT "legacy_import_device_unique";--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_report_status_created_idx" ON "content_reports" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "content_report_item_idx" ON "content_reports" USING btree ("item_id");--> statement-breakpoint
DELETE FROM "legacy_imports" newer
USING "legacy_imports" older
WHERE newer.ctid > older.ctid
  AND (
    (newer."user_id" = older."user_id" AND newer."schema_version" = older."schema_version")
    OR (newer."device_id" = older."device_id" AND newer."schema_version" = older."schema_version")
  );--> statement-breakpoint
ALTER TABLE "legacy_imports" ADD CONSTRAINT "legacy_import_user_schema_unique" UNIQUE("user_id","schema_version");--> statement-breakpoint
ALTER TABLE "legacy_imports" ADD CONSTRAINT "legacy_import_device_schema_unique" UNIQUE("device_id","schema_version");
