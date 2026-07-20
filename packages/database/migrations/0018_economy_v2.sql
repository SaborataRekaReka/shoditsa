CREATE TABLE "economy_rule_sets" (
  "version" integer PRIMARY KEY NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "rules" jsonb NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "economy_rule_sets_single_active_idx" ON "economy_rule_sets" USING btree ("active") WHERE "economy_rule_sets"."active" = true;

ALTER TABLE "wallet_ledger" ADD COLUMN "rules_version" integer DEFAULT 1 NOT NULL;

-- A session that was not completed before the cutover must report the same rules
-- version that the completion service will use after this migration.
UPDATE "game_sessions" SET "rules_version" = 2 WHERE "status" = 'playing' AND "rules_version" < 2;

CREATE TABLE "danetki_daily_usage" (
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "activity_date" date NOT NULL,
  "daily_rooms" integer DEFAULT 0 NOT NULL,
  "extra_rooms" integer DEFAULT 0 NOT NULL,
  "club_rooms" integer DEFAULT 0 NOT NULL,
  "paid_rooms" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "danetki_daily_usage_user_id_activity_date_pk" PRIMARY KEY ("user_id", "activity_date"),
  CONSTRAINT "danetki_daily_usage_counts_check" CHECK ("daily_rooms" >= 0 AND "extra_rooms" >= 0 AND "club_rooms" >= 0 AND "paid_rooms" >= 0)
);

ALTER TABLE "client_events" DROP CONSTRAINT "client_event_name_check";
ALTER TABLE "client_events" ADD CONSTRAINT "client_event_name_check" CHECK ("event_name" IN (
  'page_view','mode_opened','client_error','api_error','network_offline','network_online','report_form_opened','report_submit_failed',
  'club_screen_view','club_interest_clicked','archive_paywall_view','archive_paywall_clicked','checkout_started','checkout_returned',
  'purchase_succeeded','purchase_failed','club_free_play_started','pack_opened','pack_paywall_view','ticket_earned','ticket_spent',
  'insufficient_tickets_view','ticket_offer_view','ticket_offer_clicked','ticket_bundle_purchased','period_unlocked','free_play_started',
  'danetki_room_started','danetki_room_completed','danetki_limit_reached','club_paywall_view'
));

UPDATE "economy_rule_sets" SET "active" = false WHERE "active" = true;
INSERT INTO "economy_rule_sets" ("version", "effective_at", "rules", "active") VALUES (
  2,
  now(),
  '{"version":2,"rewards":{"completion":5,"win":5,"efficiency":{"upTo3Attempts":3,"upTo6Attempts":2,"upTo9Attempts":1},"firstGame":5,"route3":10,"fullRoute":20},"streakMilestones":{"day3":3,"day7":7,"day14":12,"day30":20,"every30Days":20},"freePlay":{"base":60,"step":20},"periodUnlock":120,"danetki":{"dailyFreeRooms":1,"ownerDailyCompletionReward":10,"clubExtraRooms":2,"solo":{"base":90,"step":30},"group":{"base":120,"step":30},"questionWarningAt":35,"questionLimit":40}}'::jsonb,
  true
);

UPDATE "commerce_products"
SET "price_minor" = 179000,
    "description" = 'Полный архив, свободная игра, клубные спецпоказы и 2 дополнительные Данетки в сутки на 365 суток. Продление вручную.',
    "updatedAt" = now()
WHERE "id" = 'club_365d';

UPDATE "commerce_products"
SET "description" = 'Полный архив, свободная игра, клубные спецпоказы и 2 дополнительные Данетки в сутки на 30 суток. Продление вручную.',
    "updatedAt" = now()
WHERE "id" = 'club_30d';
