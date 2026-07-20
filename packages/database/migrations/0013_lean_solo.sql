CREATE TABLE "commerce_products" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"duration_days" integer,
	"entitlement_key" text,
	"scope" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_products_price_check" CHECK ("commerce_products"."price_minor" >= 0),
	CONSTRAINT "commerce_products_currency_check" CHECK ("commerce_products"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commerce_products_kind_check" CHECK ("commerce_products"."kind" in ('club','pack','tip')),
	CONSTRAINT "commerce_products_semantics_check" CHECK ((
    ("commerce_products"."kind" = 'club' and "commerce_products"."duration_days" > 0 and "commerce_products"."entitlement_key" = 'club')
    or ("commerce_products"."kind" = 'pack' and "commerce_products"."scope" is not null and length("commerce_products"."scope") > 0)
    or ("commerce_products"."kind" = 'tip' and "commerce_products"."entitlement_key" = 'supporter')
  ))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error_code" text,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_events_provider_event_unique" UNIQUE("provider","provider_event_id"),
	CONSTRAINT "payment_events_status_check" CHECK ("payment_events"."status" in ('received','processed','ignored','failed'))
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"provider_payment_id" text,
	"provider_status" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "payment_orders_user_idempotency_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "payment_orders_status_check" CHECK ("payment_orders"."status" in ('created','pending','paid','failed','canceled','expired','refunded','chargeback')),
	CONSTRAINT "payment_orders_amount_check" CHECK ("payment_orders"."amount_minor" >= 0),
	CONSTRAINT "payment_orders_currency_check" CHECK ("payment_orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entitlement_key" text NOT NULL,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_entitlements_status_check" CHECK ("user_entitlements"."status" in ('active','revoked','expired')),
	CONSTRAINT "user_entitlements_source_check" CHECK ("user_entitlements"."source_type" in ('order','admin','promo','migration','yandex')),
	CONSTRAINT "user_entitlements_dates_check" CHECK ("user_entitlements"."ends_at" is null or "user_entitlements"."ends_at" > "user_entitlements"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_products_enabled_sort_idx" ON "commerce_products" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE INDEX "payment_events_received_idx" ON "payment_events" USING btree ("receivedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_provider_payment_unique" ON "payment_orders" USING btree ("provider","provider_payment_id") WHERE "payment_orders"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_orders_user_created_idx" ON "payment_orders" USING btree ("user_id","createdAt");--> statement-breakpoint
CREATE INDEX "payment_orders_status_updated_idx" ON "payment_orders" USING btree ("status","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "user_entitlements_source_unique" ON "user_entitlements" USING btree ("source_type","source_id","entitlement_key",coalesce("scope", ''));--> statement-breakpoint
CREATE INDEX "user_entitlements_user_access_idx" ON "user_entitlements" USING btree ("user_id","entitlement_key","status","ends_at");
--> statement-breakpoint
INSERT INTO "commerce_products" ("id", "kind", "title", "description", "price_minor", "currency", "duration_days", "entitlement_key", "enabled", "sort_order", "metadata") VALUES
  ('club_30d', 'club', 'Клубный билет на 30 дней', 'Полный архив и свободная игра на 30 суток. Продление вручную.', 19900, 'RUB', 30, 'club', true, 10, '{}'),
  ('club_365d', 'club', 'Годовой клубный билет', 'Полный архив и свободная игра на 365 суток. Продление вручную.', 149000, 'RUB', 365, 'club', true, 20, '{}')
ON CONFLICT ("id") DO NOTHING;
