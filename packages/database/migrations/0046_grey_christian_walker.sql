CREATE TABLE "analytics_event_daily" (
	"activity_date" date NOT NULL,
	"event_name" text NOT NULL,
	"entry_source" text DEFAULT 'unknown' NOT NULL,
	"search_engine" text DEFAULT '' NOT NULL,
	"entry_path" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"events_count" integer DEFAULT 0 NOT NULL,
	"users_count" integer DEFAULT 0 NOT NULL,
	"acquisitions_count" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_daily_activity_date_event_name_entry_source_search_engine_entry_path_mode_pk" PRIMARY KEY("activity_date","event_name","entry_source","search_engine","entry_path","mode")
);
--> statement-breakpoint
CREATE INDEX "analytics_event_daily_source_date_idx" ON "analytics_event_daily" USING btree ("entry_source","activity_date");
--> statement-breakpoint
CREATE INDEX "analytics_event_daily_event_date_idx" ON "analytics_event_daily" USING btree ("event_name","activity_date");
