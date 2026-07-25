ALTER TABLE "danetki_session_state" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "danetki_session_state" ADD COLUMN "current_turn_user_id" uuid;--> statement-breakpoint
UPDATE "danetki_session_state" AS "state"
SET
  "started_at" = "session"."startedAt",
  "current_turn_user_id" = (
    SELECT "member"."user_id"
    FROM "danetki_session_members" AS "member"
    WHERE "member"."session_id" = "state"."session_id"
      AND "member"."left_at" IS NULL
    ORDER BY "member"."joined_at", "member"."user_id"
    LIMIT 1
  )
FROM "game_sessions" AS "session"
WHERE "session"."id" = "state"."session_id";--> statement-breakpoint
ALTER TABLE "danetki_session_state" ADD CONSTRAINT "danetki_session_state_current_turn_user_id_user_id_fk" FOREIGN KEY ("current_turn_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
