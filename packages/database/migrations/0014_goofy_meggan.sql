CREATE TABLE "content_pack_entries" (
	"pack_id" text NOT NULL,
	"position" integer NOT NULL,
	"answer_item_id" text NOT NULL,
	"prompt_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "content_pack_entries_pack_id_position_pk" PRIMARY KEY("pack_id","position"),
	CONSTRAINT "content_pack_entries_answer_unique" UNIQUE("pack_id","answer_item_id"),
	CONSTRAINT "content_pack_entries_position_check" CHECK ("content_pack_entries"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"description" text NOT NULL,
	"cover_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"access_model" text DEFAULT 'free' NOT NULL,
	"product_id" text,
	"included_in_club" boolean DEFAULT true NOT NULL,
	"preview_items" integer DEFAULT 0 NOT NULL,
	"manifest_version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_packs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "content_packs_status_check" CHECK ("content_packs"."status" in ('draft','published','archived')),
	CONSTRAINT "content_packs_access_model_check" CHECK ("content_packs"."access_model" in ('free','club','purchase')),
	CONSTRAINT "content_packs_preview_items_check" CHECK ("content_packs"."preview_items" >= 0),
	CONSTRAINT "content_packs_manifest_version_check" CHECK ("content_packs"."manifest_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_pack_progress" (
	"user_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"completed_positions" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"last_position" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "user_pack_progress_user_id_pack_id_pk" PRIMARY KEY("user_id","pack_id"),
	CONSTRAINT "user_pack_progress_last_position_check" CHECK ("user_pack_progress"."last_position" is null or "user_pack_progress"."last_position" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_products" DROP CONSTRAINT "commerce_products_semantics_check";--> statement-breakpoint
ALTER TABLE "game_sessions" DROP CONSTRAINT "game_session_kind_check";--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "pack_id" text;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "pack_position" integer;--> statement-breakpoint
ALTER TABLE "content_pack_entries" ADD CONSTRAINT "content_pack_entries_pack_id_content_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."content_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_entries" ADD CONSTRAINT "content_pack_entries_answer_item_id_content_items_id_fk" FOREIGN KEY ("answer_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pack_progress" ADD CONSTRAINT "user_pack_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pack_progress" ADD CONSTRAINT "user_pack_progress_pack_id_content_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."content_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_pack_entries_pack_enabled_idx" ON "content_pack_entries" USING btree ("pack_id","enabled","position");--> statement-breakpoint
CREATE INDEX "content_packs_catalog_idx" ON "content_packs" USING btree ("status","mode","createdAt");--> statement-breakpoint
CREATE INDEX "user_pack_progress_user_updated_idx" ON "user_pack_progress" USING btree ("user_id","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_pack_user_position_unique" ON "game_sessions" USING btree ("user_id","pack_id","pack_position") WHERE "game_sessions"."pack_id" is not null and "game_sessions"."pack_position" is not null;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_semantics_check" CHECK ((
    ("commerce_products"."kind" = 'club' and "commerce_products"."duration_days" > 0 and "commerce_products"."entitlement_key" = 'club')
    or ("commerce_products"."kind" = 'pack' and "commerce_products"."entitlement_key" = 'pack' and "commerce_products"."scope" is not null and length("commerce_products"."scope") > 0)
    or ("commerce_products"."kind" = 'tip' and "commerce_products"."entitlement_key" = 'supporter')
  ));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_pack_fields_check" CHECK (("game_sessions"."kind" = 'pack' and "game_sessions"."pack_id" is not null and "game_sessions"."pack_position" is not null) or ("game_sessions"."kind" <> 'pack' and "game_sessions"."pack_id" is null and "game_sessions"."pack_position" is null));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_kind_check" CHECK ("game_sessions"."kind" in ('daily','archive','free_play','pack'));
--> statement-breakpoint
INSERT INTO "commerce_products" ("id", "kind", "title", "description", "price_minor", "currency", "entitlement_key", "scope", "enabled", "sort_order", "metadata") VALUES
  ('pack_dtf_games_30', 'pack', '30 игр, которые сходятся', 'Тематический спецпоказ из 30 игр с отдельным прогрессом.', 14900, 'RUB', 'pack', 'dtf-games-promo-30-v1', true, 30, '{"badge":"Навсегда"}'::jsonb),
  ('tip_paper_99', 'tip', 'Бумажный жетон', 'Поддержать кассира и получить отметку в профиле.', 9900, 'RUB', 'supporter', 'paper', true, 90, '{}'::jsonb),
  ('tip_silver_299', 'tip', 'Серебряный жетон', 'Поддержать развитие игры и получить отметку в профиле.', 29900, 'RUB', 'supporter', 'silver', true, 91, '{}'::jsonb),
  ('tip_gold_699', 'tip', 'Золотой жетон', 'Особая поддержка игры с постоянной отметкой в профиле.', 69900, 'RUB', 'supporter', 'gold', true, 92, '{}'::jsonb)
ON CONFLICT ("id") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "price_minor" = EXCLUDED."price_minor",
  "currency" = EXCLUDED."currency",
  "entitlement_key" = EXCLUDED."entitlement_key",
  "scope" = EXCLUDED."scope",
  "sort_order" = EXCLUDED."sort_order",
  "updatedAt" = now();
