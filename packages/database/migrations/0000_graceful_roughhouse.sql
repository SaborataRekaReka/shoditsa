CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."content_mode" AS ENUM('movie', 'series', 'anime', 'game', 'music', 'diagnosis');--> statement-breakpoint
CREATE TYPE "public"."difficulty_key" AS ENUM('easy', 'medium', 'hard', 'expert');--> statement-breakpoint
CREATE TYPE "public"."period_key" AS ENUM('all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_daily_streak" integer DEFAULT 0 NOT NULL,
	"best_daily_streak" integer DEFAULT 0 NOT NULL,
	"last_completed_date" date,
	"grace_passes" integer DEFAULT 0 NOT NULL,
	"total_active_days" integer DEFAULT 0 NOT NULL,
	"full_house_days" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_aliases" (
	"item_version_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "content_aliases_item_version_id_normalized_alias_pk" PRIMARY KEY("item_version_id","normalized_alias"),
	CONSTRAINT "content_alias_kind_check" CHECK ("content_aliases"."kind" in ('ru','original','alternative','external'))
);
--> statement-breakpoint
CREATE TABLE "content_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"title_ru" text NOT NULL,
	"title_original" text DEFAULT '' NOT NULL,
	"normalized_title" text NOT NULL,
	"year" smallint,
	"end_year" smallint,
	"popularity_score" real NOT NULL,
	"top_rank" integer,
	"sort_order" integer NOT NULL,
	"allowed_in_game" boolean DEFAULT true NOT NULL,
	"content_status" text,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_item_revision_unique" UNIQUE("item_id","revision_id")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "content_mode" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"field" text NOT NULL,
	"decision" jsonb NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_review_reviewer_unique" UNIQUE("item_id","field","reviewer_user_id")
);
--> statement-breakpoint
CREATE TABLE "content_revision_modes" (
	"revision_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"items_count" integer NOT NULL,
	"source_checksum" text NOT NULL,
	CONSTRAINT "content_revision_modes_revision_id_mode_pk" PRIMARY KEY("revision_id","mode")
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"source_manifest" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "content_revisions_version_unique" UNIQUE("version"),
	CONSTRAINT "content_revisions_checksum_sha256_unique" UNIQUE("checksum_sha256"),
	CONSTRAINT "content_revision_status_check" CHECK ("content_revisions"."status" in ('importing','ready','active','failed','retired'))
);
--> statement-breakpoint
CREATE TABLE "daily_attendance" (
	"user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"completed_modes" "content_mode"[] DEFAULT ARRAY[]::content_mode[] NOT NULL,
	"won_modes" "content_mode"[] DEFAULT ARRAY[]::content_mode[] NOT NULL,
	"first_completed_at" timestamp with time zone NOT NULL,
	"full_house" boolean DEFAULT false NOT NULL,
	CONSTRAINT "daily_attendance_user_id_activity_date_pk" PRIMARY KEY("user_id","activity_date")
);
--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_key" text NOT NULL,
	"puzzle_date" date NOT NULL,
	"mode" "content_mode" NOT NULL,
	"period" "period_key" NOT NULL,
	"difficulty" "difficulty_key",
	"variant_key" text DEFAULT '-' NOT NULL,
	"revision_id" uuid NOT NULL,
	"answer_item_version_id" uuid NOT NULL,
	"global_salt" integer NOT NULL,
	"algorithm_version" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_challenges_challenge_key_unique" UNIQUE("challenge_key"),
	CONSTRAINT "daily_challenge_variant_unique" UNIQUE("puzzle_date","mode","period","variant_key","global_salt")
);
--> statement-breakpoint
CREATE TABLE "diagnosis_vignettes" (
	"id" text PRIMARY KEY NOT NULL,
	"item_version_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_play_usage" (
	"user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"launches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "free_play_usage_user_id_activity_date_pk" PRIMARY KEY("user_id","activity_date")
);
--> statement-breakpoint
CREATE TABLE "game_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"guessed_item_version_id" uuid NOT NULL,
	"is_correct" boolean NOT NULL,
	"hints_snapshot" jsonb NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_attempt_position_unique" UNIQUE("session_id","position"),
	CONSTRAINT "game_attempt_guess_unique" UNIQUE("session_id","guessed_item_version_id"),
	CONSTRAINT "game_attempt_idempotency_unique" UNIQUE("session_id","idempotency_key"),
	CONSTRAINT "game_attempt_position_check" CHECK ("game_attempts"."position" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "game_hint_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"checkpoint" smallint NOT NULL,
	"hint_key" text NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_hint_checkpoint_unique" UNIQUE("session_id","checkpoint"),
	CONSTRAINT "game_hint_idempotency_unique" UNIQUE("session_id","idempotency_key"),
	CONSTRAINT "game_hint_checkpoint_check" CHECK ("game_hint_choices"."checkpoint" in (5,8))
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid,
	"kind" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"period" "period_key" NOT NULL,
	"difficulty" "difficulty_key",
	"puzzle_date" date NOT NULL,
	"revision_id" uuid NOT NULL,
	"answer_item_version_id" uuid NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"attempts_count" smallint DEFAULT 0 NOT NULL,
	"rules_version" integer NOT NULL,
	"start_idempotency_key" uuid,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"reward_ledger_id" uuid,
	CONSTRAINT "game_session_kind_check" CHECK ("game_sessions"."kind" in ('daily','archive','free_play')),
	CONSTRAINT "game_session_status_check" CHECK ("game_sessions"."status" in ('playing','won','lost')),
	CONSTRAINT "game_session_attempts_check" CHECK ("game_sessions"."attempts_count" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "legacy_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"payload_checksum" text NOT NULL,
	"imported_games" integer NOT NULL,
	"imported_wallet" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_device_unique" UNIQUE("user_id","device_id","schema_version")
);
--> statement-breakpoint
CREATE TABLE "period_entitlements" (
	"user_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"period" "period_key" NOT NULL,
	"source" text NOT NULL,
	"ledger_id" uuid,
	"unlockedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_entitlements_user_id_mode_period_pk" PRIMARY KEY("user_id","mode","period")
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'ru' NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"legacy_imported_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_profiles_role_check" CHECK ("player_profiles"."role" in ('player','admin'))
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"title" text NOT NULL,
	"reward_type" text NOT NULL,
	"reward_value" jsonb NOT NULL,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"global_limit" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ledger_id" uuid,
	"redemption_number" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemption_number_unique" UNIQUE("promo_id","user_id","redemption_number"),
	CONSTRAINT "promo_redemption_idempotency_unique" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_mode_stats" (
	"user_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"difficulty_key" text DEFAULT '-' NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"distribution" integer[] DEFAULT array_fill(0, ARRAY[10]) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mode_stats_user_id_mode_difficulty_key_pk" PRIMARY KEY("user_id","mode","difficulty_key")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balance_check" CHECK ("wallet_accounts"."balance" >= 0),
	CONSTRAINT "wallet_lifetime_check" CHECK ("wallet_accounts"."lifetime_earned" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_ledger_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "wallet_ledger_type_check" CHECK ("wallet_ledger"."type" in ('earn','spend','adjustment','migration'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_stats" ADD CONSTRAINT "attendance_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_aliases" ADD CONSTRAINT "content_aliases_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_review_decisions" ADD CONSTRAINT "content_review_decisions_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_review_decisions" ADD CONSTRAINT "content_review_decisions_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision_modes" ADD CONSTRAINT "content_revision_modes_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_answer_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("answer_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_vignettes" ADD CONSTRAINT "diagnosis_vignettes_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_play_usage" ADD CONSTRAINT "free_play_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_guessed_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("guessed_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_hint_choices" ADD CONSTRAINT "game_hint_choices_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_challenge_id_daily_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."daily_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_answer_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("answer_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_imports" ADD CONSTRAINT "legacy_imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_entitlements" ADD CONSTRAINT "period_entitlements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_entitlements" ADD CONSTRAINT "period_entitlements_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mode_stats" ADD CONSTRAINT "user_mode_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "content_alias_item_idx" ON "content_aliases" USING btree ("item_version_id");--> statement-breakpoint
CREATE INDEX "content_alias_trgm_idx" ON "content_aliases" USING gin ("normalized_alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "content_revision_mode_year_idx" ON "content_item_versions" USING btree ("revision_id","mode","allowed_in_game","year");--> statement-breakpoint
CREATE INDEX "content_revision_mode_order_idx" ON "content_item_versions" USING btree ("revision_id","mode","sort_order");--> statement-breakpoint
CREATE INDEX "content_items_mode_idx" ON "content_items" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "diagnosis_vignette_item_idx" ON "diagnosis_vignettes" USING btree ("item_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_challenge_user_unique" ON "game_sessions" USING btree ("user_id","challenge_id") WHERE "game_sessions"."challenge_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_start_idempotency_unique" ON "game_sessions" USING btree ("user_id","start_idempotency_key") WHERE "game_sessions"."start_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "game_session_user_status_idx" ON "game_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_cursor_idx" ON "wallet_ledger" USING btree ("user_id","createdAt");--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_reward_ledger_fk" FOREIGN KEY ("reward_ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value", "version") VALUES
  ('daily_global_salt', '0'::jsonb, 1),
  ('active_content_revision_id', 'null'::jsonb, 1),
  ('economy_rules_version', '1'::jsonb, 1),
  ('legacy_import_ticket_cap', '500'::jsonb, 1),
  ('legacy_import_deadline', 'null'::jsonb, 1)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('shoditsa.account_merge', true) = 'on'
     AND NEW."user_id" IS DISTINCT FROM OLD."user_id"
     AND NEW."operation_key" = OLD."operation_key"
     AND NEW."amount" = OLD."amount"
     AND NEW."balance_after" = OLD."balance_after" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_ledger is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER wallet_ledger_no_update_delete
BEFORE UPDATE OR DELETE ON "wallet_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_wallet_ledger_mutation();
