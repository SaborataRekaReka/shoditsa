CREATE TABLE "commerce_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_subscription_id" text,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"initial_order_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"period" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"next_payment_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "commerce_subscriptions_initial_order_unique" UNIQUE("initial_order_id"),
	CONSTRAINT "commerce_subscriptions_status_check" CHECK ("commerce_subscriptions"."status" in ('pending','active','past_due','canceled','rejected','expired')),
	CONSTRAINT "commerce_subscriptions_amount_check" CHECK ("commerce_subscriptions"."amount_minor" > 0),
	CONSTRAINT "commerce_subscriptions_currency_check" CHECK ("commerce_subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commerce_subscriptions_interval_check" CHECK ("commerce_subscriptions"."interval" in ('Day','Week','Month')),
	CONSTRAINT "commerce_subscriptions_period_check" CHECK ("commerce_subscriptions"."period" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_initial_order_id_payment_orders_id_fk" FOREIGN KEY ("initial_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_subscriptions_provider_id_unique" ON "commerce_subscriptions" USING btree ("provider","provider_subscription_id") WHERE "commerce_subscriptions"."provider_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "commerce_subscriptions_user_status_idx" ON "commerce_subscriptions" USING btree ("user_id","status","createdAt");--> statement-breakpoint
DELETE FROM "integration_secrets"
WHERE "key" IN ('YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY');--> statement-breakpoint
UPDATE "commerce_products"
SET "description" = CASE "id"
      WHEN 'club_30d' THEN 'Полный архив, свободная игра, комнаты с друзьями до 30 раундов без списаний, клубные спецпоказы и 2 дополнительные Данетки в сутки на 30 суток. Автопродление доступно по отдельному выбору.'
      WHEN 'club_365d' THEN 'Полный архив, свободная игра, комнаты с друзьями до 30 раундов без списаний, клубные спецпоказы и 2 дополнительные Данетки в сутки на 365 суток. Автопродление доступно по отдельному выбору.'
      ELSE "description"
    END,
    "updatedAt" = now()
WHERE "id" IN ('club_30d', 'club_365d');
