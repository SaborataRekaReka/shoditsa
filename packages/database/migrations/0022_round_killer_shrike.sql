ALTER TABLE "friends_room_answers" ADD COLUMN "score_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "friends_room_rounds" ADD COLUMN "pack_variant" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD COLUMN "packs" jsonb DEFAULT '[{"mode":"series","variant":"all"}]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "friends_rooms"
SET "packs" = jsonb_build_array(jsonb_build_object(
  'mode', "mode",
  'variant', CASE WHEN "mode" = 'city' THEN 'capitals' WHEN "mode" = 'music' THEN 'medium' ELSE 'all' END
));
