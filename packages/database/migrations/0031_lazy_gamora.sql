CREATE TABLE "content_final_choice_candidates" (
	"revision_id" uuid NOT NULL,
	"answer_item_version_id" uuid NOT NULL,
	"candidate_item_version_id" uuid NOT NULL,
	"role" text NOT NULL,
	"score" real NOT NULL,
	"match_keys" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"mismatch_keys" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"rank" smallint NOT NULL,
	"algorithm_version" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_final_choice_candidate_unique" UNIQUE("answer_item_version_id","candidate_item_version_id","algorithm_version"),
	CONSTRAINT "content_final_choice_distinct_items_check" CHECK ("content_final_choice_candidates"."answer_item_version_id" <> "content_final_choice_candidates"."candidate_item_version_id"),
	CONSTRAINT "content_final_choice_role_check" CHECK ("content_final_choice_candidates"."role" in ('categorical','numeric','balanced'))
);
--> statement-breakpoint
CREATE TABLE "game_final_choices" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"candidate_item_version_ids" uuid[] NOT NULL,
	"display_keys" text[] NOT NULL,
	"candidate_snapshot" jsonb NOT NULL,
	"selected_item_version_id" uuid,
	"outcome" text,
	"generation_source" text NOT NULL,
	"algorithm_version" integer NOT NULL,
	"resolution_idempotency_key" uuid,
	"resolution_response" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "game_final_choice_candidates_count_check" CHECK (cardinality("game_final_choices"."candidate_item_version_ids") = 4),
	CONSTRAINT "game_final_choice_display_keys_count_check" CHECK (cardinality("game_final_choices"."display_keys") = 3),
	CONSTRAINT "game_final_choice_outcome_check" CHECK ("game_final_choices"."outcome" is null or "game_final_choices"."outcome" in ('correct','incorrect','revealed')),
	CONSTRAINT "game_final_choice_generation_source_check" CHECK ("game_final_choices"."generation_source" in ('bank','runtime'))
);
--> statement-breakpoint
ALTER TABLE "game_sessions" DROP CONSTRAINT "game_session_status_check";--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "completion_type" text;--> statement-breakpoint
UPDATE "game_sessions"
SET "completion_type" = CASE
	WHEN "status" = 'won' THEN 'direct_win'
	WHEN "status" = 'lost' THEN 'attempts_exhausted'
	WHEN "status" = 'expired' THEN 'expired'
	ELSE NULL
END;--> statement-breakpoint
ALTER TABLE "user_mode_stats" ADD COLUMN "final_choice_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_final_choice_candidates" ADD CONSTRAINT "content_final_choice_candidates_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_final_choice_candidates" ADD CONSTRAINT "content_final_choice_candidates_answer_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("answer_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_final_choice_candidates" ADD CONSTRAINT "content_final_choice_candidates_candidate_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("candidate_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_final_choices" ADD CONSTRAINT "game_final_choices_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_final_choices" ADD CONSTRAINT "game_final_choices_selected_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("selected_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_final_choice_answer_role_rank_idx" ON "content_final_choice_candidates" USING btree ("answer_item_version_id","role","rank");--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_completion_check" CHECK (("game_sessions"."status" in ('playing','final_choice') and "game_sessions"."completion_type" is null and "game_sessions"."completed_at" is null) or ("game_sessions"."status" in ('won','lost','expired') and "game_sessions"."completion_type" is not null and "game_sessions"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_completion_type_check" CHECK ("game_sessions"."completion_type" is null or "game_sessions"."completion_type" in ('direct_win','final_choice_win','final_choice_loss','answer_revealed','attempts_exhausted','expired'));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_status_check" CHECK ("game_sessions"."status" in ('playing','final_choice','won','lost','expired'));
