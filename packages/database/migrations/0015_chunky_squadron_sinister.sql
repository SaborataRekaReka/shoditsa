CREATE TABLE "private_game_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"participants" integer NOT NULL,
	"event_date" date,
	"description" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"internal_note" text,
	"pack_id" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_game_orders_participants_check" CHECK ("private_game_orders"."participants" between 2 and 10000),
	CONSTRAINT "private_game_orders_status_check" CHECK ("private_game_orders"."status" in ('new','contacted','in_progress','completed','rejected'))
);
--> statement-breakpoint
ALTER TABLE "private_game_orders" ADD CONSTRAINT "private_game_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_game_orders" ADD CONSTRAINT "private_game_orders_pack_id_content_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."content_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_game_orders_status_created_idx" ON "private_game_orders" USING btree ("status","createdAt");