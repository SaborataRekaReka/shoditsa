ALTER TYPE "public"."content_mode" ADD VALUE IF NOT EXISTS 'connections';

DO $$ BEGIN
  CREATE TYPE "public"."connections_color" AS ENUM('yellow', 'green', 'blue', 'purple');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."connections_guess_result" AS ENUM('correct', 'wrong', 'one_away');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "connections_schedule" (
  "puzzle_date" date PRIMARY KEY NOT NULL,
  "item_version_id" uuid NOT NULL REFERENCES "content_item_versions"("id"),
  "scheduled_by" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "cancelled_at" timestamptz,
  CONSTRAINT "connections_schedule_item_version_unique" UNIQUE("item_version_id")
);

CREATE TABLE IF NOT EXISTS "connections_session_state" (
  "session_id" uuid PRIMARY KEY NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "solved_colors" connections_color[] DEFAULT ARRAY[]::connections_color[] NOT NULL,
  "mistakes_used" smallint DEFAULT 0 NOT NULL,
  "hints_used" smallint DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "connections_session_mistakes_check" CHECK ("mistakes_used" BETWEEN 0 AND 4),
  CONSTRAINT "connections_session_hints_check" CHECK ("hints_used" BETWEEN 0 AND 2)
);

CREATE TABLE IF NOT EXISTS "connections_guesses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "position" smallint NOT NULL,
  "tile_ids" text[] NOT NULL,
  "signature" text NOT NULL,
  "result" connections_guess_result NOT NULL,
  "matched_color" connections_color,
  "mistakes_after" smallint NOT NULL,
  "response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "connections_guess_session_position_unique" UNIQUE("session_id", "position"),
  CONSTRAINT "connections_guess_session_signature_unique" UNIQUE("session_id", "signature"),
  CONSTRAINT "connections_guess_session_idempotency_unique" UNIQUE("session_id", "idempotency_key"),
  CONSTRAINT "connections_guess_tiles_count_check" CHECK (cardinality("tile_ids") = 4),
  CONSTRAINT "connections_guess_position_check" CHECK ("position" BETWEEN 1 AND 6),
  CONSTRAINT "connections_guess_mistakes_check" CHECK ("mistakes_after" BETWEEN 0 AND 4),
  CONSTRAINT "connections_guess_match_check" CHECK (("result" = 'correct' AND "matched_color" IS NOT NULL) OR ("result" <> 'correct' AND "matched_color" IS NULL))
);

CREATE TABLE IF NOT EXISTS "connections_hint_choices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "checkpoint" smallint NOT NULL,
  "group_color" connections_color NOT NULL,
  "response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "connections_hint_session_checkpoint_unique" UNIQUE("session_id", "checkpoint"),
  CONSTRAINT "connections_hint_session_idempotency_unique" UNIQUE("session_id", "idempotency_key"),
  CONSTRAINT "connections_hint_checkpoint_check" CHECK ("checkpoint" IN (1, 3))
);

CREATE INDEX IF NOT EXISTS "connections_schedule_active_date_idx" ON "connections_schedule" ("puzzle_date", "cancelled_at");
CREATE INDEX IF NOT EXISTS "connections_guess_session_created_idx" ON "connections_guesses" ("session_id", "created_at");

ALTER TABLE "game_sessions" DROP CONSTRAINT IF EXISTS "game_session_attempts_check";
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_attempts_check" CHECK ("attempts_count" BETWEEN 0 AND 10);

ALTER TABLE "content_reports" DROP CONSTRAINT IF EXISTS "content_report_reason_check";
ALTER TABLE "content_reports" ADD CONSTRAINT "content_report_reason_check" CHECK ("reason" IN (
  'wrong_fact',
  'disputed_comparison',
  'title_not_found',
  'bad_hint',
  'bad_image',
  'duplicate_card',
  'ambiguous_group',
  'wrong_group_title',
  'word_does_not_fit',
  'duplicate_word',
  'typo_or_translation',
  'technical_error',
  'other'
));

INSERT INTO "app_settings" ("key", "value")
VALUES
  ('connections_enabled', 'true'::jsonb),
  ('connections_hints_enabled', 'true'::jsonb),
  ('connections_launch_date', 'null'::jsonb)
ON CONFLICT ("key") DO NOTHING;
