CREATE TABLE "game_session_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_status" text,
	"source_session_id" uuid,
	"access_source" text,
	"growth_stage" text,
	"origin" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_session_fact_origin_check" CHECK ("game_session_facts"."origin" in ('existing_snapshot','live'))
);
--> statement-breakpoint
ALTER TABLE "game_session_facts" ADD CONSTRAINT "game_session_facts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_session_fact_user_completed_idx" ON "game_session_facts" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "game_session_fact_mode_completed_idx" ON "game_session_facts" USING btree ("mode","completed_at");--> statement-breakpoint
CREATE INDEX "game_session_fact_source_idx" ON "game_session_facts" USING btree ("source_session_id");
--> statement-breakpoint
-- Prevent a gap between the existing-row snapshot and installation of capture.
-- Migration runner executes these statements in one transaction.
LOCK TABLE "game_sessions" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO "game_session_facts" (
  id, user_id, kind, mode, "startedAt", completed_at, completion_status,
  source_session_id, access_source, growth_stage, origin
)
SELECT id, user_id, kind, mode, "startedAt", completed_at,
  CASE WHEN completed_at IS NOT NULL THEN status END,
  source_session_id, access_source, growth_stage, 'existing_snapshot'
FROM "game_sessions";
--> statement-breakpoint
-- Only existing facts are copied. Previously deleted sessions/null links cannot
-- be reconstructed; record the actual deployment boundary rather than a date in code.
INSERT INTO "app_settings" (key, value)
VALUES ('analytics.gameSessionFacts', jsonb_build_object('recordingStartedAt', statement_timestamp()))
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION capture_game_session_fact() RETURNS trigger AS $$
BEGIN
  INSERT INTO game_session_facts (
    id, user_id, kind, mode, "startedAt", completed_at, completion_status,
    source_session_id, access_source, growth_stage, origin
  ) VALUES (
    NEW.id, NEW.user_id, NEW.kind, NEW.mode, NEW."startedAt", NEW.completed_at,
    CASE WHEN NEW.completed_at IS NOT NULL THEN NEW.status END,
    NEW.source_session_id, NEW.access_source, NEW.growth_stage, 'live'
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    completed_at = coalesce(game_session_facts.completed_at, EXCLUDED.completed_at),
    completion_status = coalesce(game_session_facts.completion_status, EXCLUDED.completion_status);
  -- Original start/source/access/stage never change, including an FK SET NULL
  -- caused by deleting a duplicate. The first terminal state is kept on reload.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER capture_game_session_fact
AFTER INSERT OR UPDATE OF user_id, status, completed_at ON game_sessions
FOR EACH ROW EXECUTE FUNCTION capture_game_session_fact();
