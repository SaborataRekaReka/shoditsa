CREATE TABLE "danetki_ai_call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"job_id" uuid,
	"attempt_number" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider_response_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"status" "danetki_ai_call_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"response_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "danetki_ai_attempt_call_number_unique" UNIQUE("call_id","attempt_number"),
	CONSTRAINT "danetki_ai_attempt_number_check" CHECK ("danetki_ai_call_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "background_jobs" DROP CONSTRAINT "background_job_type_check";--> statement-breakpoint
ALTER TABLE "game_sessions" DROP CONSTRAINT "game_session_status_check";--> statement-breakpoint
ALTER TABLE "danetki_ai_calls" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "danetki_ai_call_attempts" ADD CONSTRAINT "danetki_ai_call_attempts_call_id_danetki_ai_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."danetki_ai_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danetki_ai_call_attempts" ADD CONSTRAINT "danetki_ai_call_attempts_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "danetki_ai_attempt_job_unique" ON "danetki_ai_call_attempts" USING btree ("job_id") WHERE "danetki_ai_call_attempts"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "danetki_ai_attempt_call_started_idx" ON "danetki_ai_call_attempts" USING btree ("call_id","started_at");--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_job_type_check" CHECK ("background_jobs"."type" in ('content_revision_build','content_release_import','content_quality_check','music_pipeline','movie_pipeline','anime_pipeline','normalization_pipeline','event_export','user_export','media_check','client_event_retention','danetki_ai_reply','danetki_guess_evaluate','danetki_room_expire','commerce_reconcile','game_lifecycle_cleanup','content_retention'));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_status_check" CHECK ("game_sessions"."status" in ('playing','won','lost','expired'));--> statement-breakpoint
INSERT INTO "danetki_ai_call_attempts" (
	"call_id",
	"attempt_number",
	"model",
	"prompt_version",
	"provider_response_id",
	"input_tokens",
	"output_tokens",
	"latency_ms",
	"status",
	"error_code",
	"response_json",
	"started_at",
	"finished_at"
)
SELECT
	"id",
	1,
	"model",
	"prompt_version",
	"provider_response_id",
	"input_tokens",
	"output_tokens",
	"latency_ms",
	"status",
	"error_code",
	"response_json",
	"created_at",
	CASE WHEN "status" IN ('success', 'error') THEN "created_at" ELSE NULL END
FROM "danetki_ai_calls";
