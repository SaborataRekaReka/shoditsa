CREATE TABLE "economy_rule_assignments" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rules_version" integer NOT NULL,
	"cohort" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_rule_assignments_cohort_check" CHECK ("economy_rule_assignments"."cohort" in ('control','canary','admin','test','rollout'))
);
--> statement-breakpoint
ALTER TABLE "economy_rule_assignments" ADD CONSTRAINT "economy_rule_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_rule_assignments" ADD CONSTRAINT "economy_rule_assignments_rules_version_economy_rule_sets_version_fk" FOREIGN KEY ("rules_version") REFERENCES "public"."economy_rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "economy_rule_assignments_version_cohort_idx" ON "economy_rule_assignments" USING btree ("rules_version","cohort","assigned_at");
--> statement-breakpoint
INSERT INTO "economy_rule_sets" ("version", "effective_at", "rules", "active")
VALUES (
	3,
	now(),
	'{"version":3,"rewards":{"completion":5,"win":5,"finalChoiceWin":5,"efficiency":{"upTo3Attempts":3,"upTo6Attempts":2,"upTo9Attempts":1},"firstGame":5,"route3":10,"fullRoute":20},"streakMilestones":{"day3":3,"day7":7,"day14":12,"day30":20,"every30Days":20},"freePlay":{"ladder":[60,80,100,120],"max":2147483647,"legacyLinear":{"base":60,"step":20}},"periodUnlock":120,"friendsRoom":{"freeBlocksPerDay":2147483647,"roundsPerBlock":6,"maxRoundsPerRoom":30,"ladder":[0],"max":0},"danetki":{"dailyFreeRooms":1,"ownerDailyCompletionReward":10,"clubExtraRooms":2,"ladder":[90,120,150],"max":2147483647,"questionWarningAt":35,"questionLimit":40,"legacyLinear":{"solo":{"base":90,"step":30},"group":{"base":120,"step":30}}}}'::jsonb,
	false
)
ON CONFLICT ("version") DO UPDATE
SET "rules" = EXCLUDED."rules", "effective_at" = EXCLUDED."effective_at", "active" = false;
--> statement-breakpoint
UPDATE "economy_rule_sets" SET "active" = false WHERE "active" = true;
--> statement-breakpoint
INSERT INTO "economy_rule_sets" ("version", "effective_at", "rules", "active")
VALUES (
	4,
	now(),
	'{"version":4,"rewards":{"completion":5,"win":5,"finalChoiceWin":5,"efficiency":{"upTo3Attempts":3,"upTo6Attempts":2,"upTo9Attempts":1},"firstGame":5,"route3":10,"fullRoute":20},"streakMilestones":{"day3":3,"day7":7,"day14":12,"day30":20,"every30Days":20},"freePlay":{"ladder":[60,80,100,120],"max":120},"periodUnlock":120,"friendsRoom":{"freeBlocksPerDay":1,"roundsPerBlock":6,"maxRoundsPerRoom":30,"ladder":[60,80,100,120],"max":120},"danetki":{"dailyFreeRooms":1,"ownerDailyCompletionReward":10,"clubExtraRooms":2,"ladder":[90,120,150],"max":150,"questionWarningAt":35,"questionLimit":40}}'::jsonb,
	true
)
ON CONFLICT ("version") DO UPDATE
SET "rules" = EXCLUDED."rules", "effective_at" = EXCLUDED."effective_at", "active" = true;
