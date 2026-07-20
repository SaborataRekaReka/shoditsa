CREATE TYPE "public"."danetki_room_mode" AS ENUM ('solo', 'group');
CREATE TYPE "public"."danetki_ai_status" AS ENUM ('idle', 'queued', 'processing', 'error');
CREATE TYPE "public"."danetki_member_role" AS ENUM ('owner', 'player');
CREATE TYPE "public"."danetki_sender_kind" AS ENUM ('user', 'ai', 'system');
CREATE TYPE "public"."danetki_message_type" AS ENUM ('question', 'answer', 'hint', 'guess', 'event', 'solution');
CREATE TYPE "public"."danetki_guess_status" AS ENUM ('pending', 'correct', 'incorrect');
CREATE TYPE "public"."danetki_ai_purpose" AS ENUM ('answer', 'evaluate_guess', 'hint', 'summarize');
CREATE TYPE "public"."danetki_ai_call_status" AS ENUM ('pending', 'success', 'error');

CREATE TABLE "danetki_session_state" (
  "session_id" uuid PRIMARY KEY NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "room_mode" "danetki_room_mode" NOT NULL,
  "question_count" integer DEFAULT 0 NOT NULL,
  "hint_level" integer DEFAULT 0 NOT NULL,
  "revealed_fact_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "state_summary" text DEFAULT '' NOT NULL,
  "next_message_seq" bigint DEFAULT 1 NOT NULL,
  "ai_status" "danetki_ai_status" DEFAULT 'idle' NOT NULL,
  "prompt_version" text DEFAULT 'danetki-host-v1' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_session_question_count_check" CHECK ("question_count" >= 0),
  CONSTRAINT "danetki_session_hint_level_check" CHECK ("hint_level" BETWEEN 0 AND 3)
);

CREATE TABLE "danetki_session_members" (
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" "danetki_member_role" DEFAULT 'player' NOT NULL,
  "display_name_snapshot" text NOT NULL,
  "color_key" text NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_session_members_session_id_user_id_pk" PRIMARY KEY ("session_id", "user_id"),
  CONSTRAINT "danetki_member_name_check" CHECK (char_length("display_name_snapshot") BETWEEN 1 AND 40)
);

CREATE TABLE "danetki_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "max_uses" integer DEFAULT 5 NOT NULL,
  "uses_count" integer DEFAULT 0 NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_invite_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "danetki_invite_uses_check" CHECK ("uses_count" >= 0 AND "max_uses" BETWEEN 1 AND 6)
);

CREATE TABLE "danetki_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "seq" bigint NOT NULL,
  "sender_kind" "danetki_sender_kind" NOT NULL,
  "sender_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "message_type" "danetki_message_type" NOT NULL,
  "text" text NOT NULL,
  "classification" text,
  "importance" text,
  "parent_message_id" uuid,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_message_session_seq_unique" UNIQUE ("session_id", "seq"),
  CONSTRAINT "danetki_message_classification_check" CHECK ("classification" IS NULL OR "classification" IN ('yes','no','irrelevant','unclear','invalid')),
  CONSTRAINT "danetki_message_importance_check" CHECK ("importance" IS NULL OR "importance" IN ('critical','useful','neutral'))
);
ALTER TABLE "danetki_messages" ADD CONSTRAINT "danetki_message_parent_fk" FOREIGN KEY ("parent_message_id") REFERENCES "danetki_messages"("id") ON DELETE SET NULL;

CREATE TABLE "danetki_final_guesses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "status" "danetki_guess_status" DEFAULT 'pending' NOT NULL,
  "evaluation" jsonb,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_guess_idempotency_unique" UNIQUE ("session_id", "user_id", "idempotency_key")
);

CREATE TABLE "danetki_ai_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "trigger_message_id" uuid REFERENCES "danetki_messages"("id") ON DELETE SET NULL,
  "purpose" "danetki_ai_purpose" NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "provider_response_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "status" "danetki_ai_call_status" DEFAULT 'pending' NOT NULL,
  "error_code" text,
  "response_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "danetki_surrender_votes" (
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "danetki_surrender_votes_session_id_user_id_pk" PRIMARY KEY ("session_id", "user_id")
);

CREATE UNIQUE INDEX "danetki_message_user_idempotency_unique" ON "danetki_messages" ("session_id", "sender_user_id", "idempotency_key") WHERE "sender_user_id" IS NOT NULL AND "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "danetki_message_ai_parent_unique" ON "danetki_messages" ("parent_message_id") WHERE "sender_kind" = 'ai' AND "parent_message_id" IS NOT NULL;
CREATE INDEX "danetki_message_session_created_idx" ON "danetki_messages" ("session_id", "created_at");
CREATE INDEX "danetki_members_active_idx" ON "danetki_session_members" ("session_id", "left_at", "joined_at");
CREATE INDEX "danetki_invite_session_idx" ON "danetki_invites" ("session_id", "expires_at");
CREATE INDEX "danetki_guess_session_created_idx" ON "danetki_final_guesses" ("session_id", "created_at");
CREATE INDEX "danetki_ai_call_session_created_idx" ON "danetki_ai_calls" ("session_id", "created_at");
CREATE UNIQUE INDEX "danetki_ai_call_trigger_purpose_unique" ON "danetki_ai_calls" ("trigger_message_id", "purpose") WHERE "trigger_message_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_danetki_member_limit() RETURNS trigger AS $$
BEGIN
  IF NEW."left_at" IS NULL AND (
    SELECT count(*) FROM "danetki_session_members"
    WHERE "session_id" = NEW."session_id" AND "left_at" IS NULL AND "user_id" <> NEW."user_id"
  ) >= 6 THEN
    RAISE EXCEPTION 'danetki room is full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "danetki_member_limit_trigger" BEFORE INSERT OR UPDATE OF "left_at" ON "danetki_session_members" FOR EACH ROW EXECUTE FUNCTION enforce_danetki_member_limit();

ALTER TABLE "background_jobs" DROP CONSTRAINT "background_job_type_check";
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_job_type_check" CHECK ("type" IN ('content_revision_build','content_release_import','content_quality_check','music_pipeline','movie_pipeline','anime_pipeline','normalization_pipeline','event_export','user_export','media_check','client_event_retention','danetki_ai_reply','danetki_guess_evaluate','danetki_room_expire'));

INSERT INTO "app_settings" ("key", "value") VALUES
  ('danetki.enabled', 'false'::jsonb),
  ('danetki.multiplayerEnabled', 'true'::jsonb),
  ('danetki.hostModel', '"gpt-5-mini"'::jsonb),
  ('danetki.promptVersion', '"danetki-host-v1"'::jsonb),
  ('danetki.contextMessages', '30'::jsonb),
  ('danetki.roomTtlHours', '24'::jsonb)
ON CONFLICT ("key") DO NOTHING;
