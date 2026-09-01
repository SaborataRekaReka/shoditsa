ALTER TABLE "territory_duels" DROP CONSTRAINT "territory_duel_position_check";--> statement-breakpoint
ALTER TABLE "territory_duels" DROP CONSTRAINT "territory_duel_result_check";--> statement-breakpoint
ALTER TABLE "territory_matches" DROP CONSTRAINT "territory_match_duel_check";--> statement-breakpoint
ALTER TABLE "territory_matches" ALTER COLUMN "rules_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "territory_duels" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "territory_matches" ADD COLUMN "siege_state" jsonb DEFAULT '{"active":null,"towersRemaining":{}}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "territory_matches" SET "rules_version" = 2 WHERE "phase" <> 'finished';--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duel_kind_check" CHECK ("territory_duels"."kind" in ('regular', 'siege'));--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duel_position_check" CHECK ("territory_duels"."position" between 1 and 80);--> statement-breakpoint
ALTER TABLE "territory_duels" ADD CONSTRAINT "territory_duel_result_check" CHECK ("territory_duels"."result" is null or "territory_duels"."result" in ('single_correct', 'closer', 'faster', 'speed_tie', 'no_correct'));--> statement-breakpoint
ALTER TABLE "territory_matches" ADD CONSTRAINT "territory_match_duel_check" CHECK ("territory_matches"."current_duel" between 0 and 80);
