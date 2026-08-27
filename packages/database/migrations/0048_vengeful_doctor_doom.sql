ALTER TYPE "public"."content_mode" ADD VALUE 'territory';--> statement-breakpoint
CREATE TABLE "territory_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"duel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territory_answer_duel_user_unique" UNIQUE("duel_id","user_id"),
	CONSTRAINT "territory_answer_room_user_idempotency_unique" UNIQUE("room_id","user_id","idempotency_key"),
	CONSTRAINT "territory_answer_elapsed_check" CHECK ("territory_answers"."elapsed_ms" between 0 and 60000),
	CONSTRAINT "territory_answer_option_check" CHECK (char_length("territory_answers"."option_id") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "territory_duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"content_item_version_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"category_id" text NOT NULL,
	"category_label" text NOT NULL,
	"difficulty" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option_id" text NOT NULL,
	"explanation" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"result" text,
	"winner_user_id" uuid,
	"captured_cell_id" text,
	"previous_owner_user_id" uuid,
	"capture_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territory_duel_match_position_unique" UNIQUE("match_id","position"),
	CONSTRAINT "territory_duel_capture_idempotency_unique" UNIQUE("match_id","capture_idempotency_key"),
	CONSTRAINT "territory_duel_position_check" CHECK ("territory_duels"."position" between 1 and 20),
	CONSTRAINT "territory_duel_difficulty_check" CHECK ("territory_duels"."difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "territory_duel_result_check" CHECK ("territory_duels"."result" is null or "territory_duels"."result" in ('single_correct', 'faster', 'speed_tie', 'no_correct'))
);
--> statement-breakpoint
CREATE TABLE "territory_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"match_number" smallint NOT NULL,
	"revision_id" uuid NOT NULL,
	"player_one_user_id" uuid NOT NULL,
	"player_two_user_id" uuid NOT NULL,
	"phase" text DEFAULT 'countdown' NOT NULL,
	"phase_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phase_ends_at" timestamp with time zone,
	"map_seed" text NOT NULL,
	"map_version" integer DEFAULT 1 NOT NULL,
	"map_snapshot" jsonb NOT NULL,
	"ownership" jsonb NOT NULL,
	"player_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_duel" smallint DEFAULT 1 NOT NULL,
	"max_duels" smallint DEFAULT 20 NOT NULL,
	"winner_user_id" uuid,
	"finish_reason" text,
	"rules_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territory_match_room_number_unique" UNIQUE("room_id","match_number"),
	CONSTRAINT "territory_match_number_check" CHECK ("territory_matches"."match_number" > 0),
	CONSTRAINT "territory_match_distinct_players_check" CHECK ("territory_matches"."player_one_user_id" <> "territory_matches"."player_two_user_id"),
	CONSTRAINT "territory_match_phase_check" CHECK ("territory_matches"."phase" in ('countdown', 'question', 'reveal', 'capture', 'finished')),
	CONSTRAINT "territory_match_duel_check" CHECK ("territory_matches"."current_duel" between 0 and "territory_matches"."max_duels"),
	CONSTRAINT "territory_match_max_duels_check" CHECK ("territory_matches"."max_duels" between 1 and 20),
	CONSTRAINT "territory_match_map_version_check" CHECK ("territory_matches"."map_version" = 1),
	CONSTRAINT "territory_match_rules_version_check" CHECK ("territory_matches"."rules_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "territory_rematch_votes" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territory_rematch_votes_match_id_user_id_pk" PRIMARY KEY("match_id","user_id"),
	CONSTRAINT "territory_rematch_vote_idempotency_unique" UNIQUE("match_id","user_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "territory_answers" ADD CONSTRAINT "territory_answers_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_answers" ADD CONSTRAINT "territory_answers_match_id_territory_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."territory_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_answers" ADD CONSTRAINT "territory_answers_duel_id_territory_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."territory_duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_answers" ADD CONSTRAINT "territory_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duels_match_id_territory_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."territory_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duels_content_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("content_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duels_winner_user_id_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duels_previous_owner_user_id_user_id_fk" FOREIGN KEY ("previous_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_matches_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_matches_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_matches_player_one_user_id_user_id_fk" FOREIGN KEY ("player_one_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_matches_player_two_user_id_user_id_fk" FOREIGN KEY ("player_two_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_matches_winner_user_id_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_rematch_votes" ADD CONSTRAINT "territory_rematch_votes_match_id_territory_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."territory_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_rematch_votes" ADD CONSTRAINT "territory_rematch_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "territory_answer_match_duel_idx" ON "territory_answers" USING btree ("match_id","duel_id","submitted_at");--> statement-breakpoint
CREATE INDEX "territory_duel_match_started_idx" ON "territory_duels" USING btree ("match_id","started_at");--> statement-breakpoint
CREATE INDEX "territory_match_room_created_idx" ON "territory_matches" USING btree ("room_id","created_at");