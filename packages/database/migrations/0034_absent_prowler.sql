ALTER TYPE "public"."friends_room_phase" ADD VALUE 'intermission' BEFORE 'finished';--> statement-breakpoint
CREATE TABLE "friends_room_daily_usage" (
	"user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"free_blocks" integer DEFAULT 0 NOT NULL,
	"paid_blocks" integer DEFAULT 0 NOT NULL,
	"club_blocks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "friends_room_daily_usage_user_id_activity_date_pk" PRIMARY KEY("user_id","activity_date"),
	CONSTRAINT "friends_room_daily_usage_counts_check" CHECK ("friends_room_daily_usage"."free_blocks" >= 0 and "friends_room_daily_usage"."paid_blocks" >= 0 and "friends_room_daily_usage"."club_blocks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "friends_room_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"block_number" smallint NOT NULL,
	"rounds_added" smallint DEFAULT 6 NOT NULL,
	"access_source" text NOT NULL,
	"cost" integer DEFAULT 0 NOT NULL,
	"ledger_id" uuid,
	"idempotency_key" text NOT NULL,
	"rules_version" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_room_extension_room_block_unique" UNIQUE("room_id","block_number"),
	CONSTRAINT "friends_room_extension_owner_key_unique" UNIQUE("owner_user_id","idempotency_key"),
	CONSTRAINT "friends_room_extension_block_check" CHECK ("friends_room_extensions"."block_number" between 1 and 5),
	CONSTRAINT "friends_room_extension_rounds_check" CHECK ("friends_room_extensions"."rounds_added" between 3 and 6),
	CONSTRAINT "friends_room_extension_access_check" CHECK ("friends_room_extensions"."access_source" in ('free', 'tickets', 'club')),
	CONSTRAINT "friends_room_extension_cost_check" CHECK ("friends_room_extensions"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_products" DROP CONSTRAINT "commerce_products_kind_check";--> statement-breakpoint
ALTER TABLE "commerce_products" DROP CONSTRAINT "commerce_products_semantics_check";--> statement-breakpoint
ALTER TABLE "client_events" DROP CONSTRAINT "client_event_name_check";--> statement-breakpoint
ALTER TABLE "friends_room_rounds" DROP CONSTRAINT "friends_room_round_position_check";--> statement-breakpoint
ALTER TABLE "content_packs" ALTER COLUMN "access_model" SET DEFAULT 'club';--> statement-breakpoint
UPDATE "content_packs"
SET "access_model" = 'club',
    "included_in_club" = true,
    "preview_items" = 0,
    "product_id" = null;--> statement-breakpoint
UPDATE "commerce_products"
SET "description" = CASE "id"
      WHEN 'club_30d' THEN 'Полный архив, свободная игра, комнаты с друзьями до 30 раундов без списаний, клубные спецпоказы и 2 дополнительные Данетки в сутки на 30 суток. Продление вручную.'
      WHEN 'club_365d' THEN 'Полный архив, свободная игра, комнаты с друзьями до 30 раундов без списаний, клубные спецпоказы и 2 дополнительные Данетки в сутки на 365 суток. Продление вручную.'
      ELSE "description"
    END,
    "updated_at" = now()
WHERE "id" IN ('club_30d', 'club_365d');--> statement-breakpoint
UPDATE "commerce_products" SET "enabled" = false, "updated_at" = now() WHERE "kind" = 'pack';--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD COLUMN "danetki_launch" jsonb DEFAULT '{"kind":"daily"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD COLUMN "rules_version" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD COLUMN "purchase_debt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "friends_room_daily_usage" ADD CONSTRAINT "friends_room_daily_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_extensions" ADD CONSTRAINT "friends_room_extensions_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_extensions" ADD CONSTRAINT "friends_room_extensions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_kind_check" CHECK ("commerce_products"."kind" in ('club','pack','tip','tickets'));--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_semantics_check" CHECK ((
    ("commerce_products"."kind" = 'club' and "commerce_products"."duration_days" > 0 and "commerce_products"."entitlement_key" = 'club')
    or ("commerce_products"."kind" = 'pack' and "commerce_products"."entitlement_key" = 'pack' and "commerce_products"."scope" is not null and length("commerce_products"."scope") > 0)
    or ("commerce_products"."kind" = 'tip' and "commerce_products"."entitlement_key" = 'supporter')
    or ("commerce_products"."kind" = 'tickets' and "commerce_products"."duration_days" is null and "commerce_products"."entitlement_key" is null and ("commerce_products"."metadata"->>'ticketAmount')::int > 0)
  ));--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_club_only_check" CHECK ("content_packs"."access_model" = 'club' and "content_packs"."included_in_club" = true and "content_packs"."preview_items" = 0 and "content_packs"."product_id" is null);--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_event_name_check" CHECK ("client_events"."event_name" in ('page_view','mode_opened','client_error','api_error','network_offline','network_online','report_form_opened','report_submit_failed','club_screen_view','club_interest_clicked','archive_paywall_view','archive_paywall_clicked','checkout_started','checkout_returned','purchase_succeeded','purchase_failed','club_free_play_started','pack_opened','pack_paywall_view','ticket_earned','ticket_spent','insufficient_tickets_view','ticket_offer_view','ticket_offer_clicked','ticket_bundle_purchased','period_unlocked','free_play_started','danetki_room_started','danetki_room_completed','danetki_limit_reached','club_paywall_view','special_locked_view','special_club_cta_clicked','friends_room_created','friends_room_started','friends_room_free_block_started','friends_room_block_completed','friends_room_intermission_view','friends_room_continue_clicked','friends_room_continued','friends_room_ended_at_intermission','friends_room_guest_joined','friends_room_guest_registered','final_choice_shown','final_choice_candidate_selected','final_choice_submitted','final_choice_reveal_opened','final_choice_reveal_cancelled','final_choice_revealed','final_choice_timed_out','final_choice_unavailable');--> statement-breakpoint
ALTER TABLE "friends_room_rounds" ADD CONSTRAINT "friends_room_round_position_check" CHECK ("friends_room_rounds"."position" between 1 and 30);--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_purchase_debt_check" CHECK ("wallet_accounts"."purchase_debt" >= 0);
--> statement-breakpoint
INSERT INTO "commerce_products"
  ("id", "kind", "title", "description", "price_minor", "currency", "duration_days", "entitlement_key", "scope", "enabled", "sort_order", "metadata", "updated_at")
VALUES
  ('tickets_60', 'tickets', '60 билетов', 'Набор для свободной игры, Данеток и комнат с друзьями.', 6900, 'RUB', null, null, null, true, 40, '{"ticketAmount":60}'::jsonb, now()),
  ('tickets_180', 'tickets', '180 билетов', 'Большой набор билетов для дополнительных игр.', 14900, 'RUB', null, null, null, true, 41, '{"ticketAmount":180}'::jsonb, now())
ON CONFLICT ("id") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "price_minor" = EXCLUDED."price_minor",
  "currency" = EXCLUDED."currency",
  "duration_days" = EXCLUDED."duration_days",
  "entitlement_key" = EXCLUDED."entitlement_key",
  "scope" = EXCLUDED."scope",
  "metadata" = EXCLUDED."metadata",
  "updated_at" = now();
