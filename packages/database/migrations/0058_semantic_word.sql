ALTER TYPE "public"."content_mode" ADD VALUE 'word';--> statement-breakpoint
CREATE TABLE "word_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"action" text NOT NULL,
	"request_signature" text NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_action_idempotency_unique" UNIQUE("session_id","idempotency_key"),
	CONSTRAINT "word_action_check" CHECK ("word_actions"."action" in ('guess','hint','give_up'))
);
--> statement-breakpoint
CREATE TABLE "word_session_state" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"guesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_hints_check" CHECK ("word_session_state"."hints_used" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "game_sessions" DROP CONSTRAINT "game_session_attempts_check";--> statement-breakpoint
ALTER TABLE "game_sessions" ALTER COLUMN "attempts_count" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "word_actions" ADD CONSTRAINT "word_actions_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_session_state" ADD CONSTRAINT "word_session_state_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_attempts_check" CHECK ("game_sessions"."attempts_count" >= 0 and ("game_sessions"."mode"::text = 'word' or "game_sessions"."attempts_count" <= 10));