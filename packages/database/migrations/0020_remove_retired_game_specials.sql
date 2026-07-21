DELETE FROM "game_sessions"
WHERE "pack_id" IN ('dtf-games-promo-30-v1', 'reddit-games-comments-25-v1')
   OR "challenge_id" IN (
     SELECT "id" FROM "daily_challenges" WHERE "variant_key" = 'dtf-games-promo-30-v1'
   );
--> statement-breakpoint
DELETE FROM "daily_challenges" WHERE "variant_key" = 'dtf-games-promo-30-v1';
--> statement-breakpoint
DELETE FROM "content_packs" WHERE "id" IN ('dtf-games-promo-30-v1', 'reddit-games-comments-25-v1');
--> statement-breakpoint
DELETE FROM "commerce_products" WHERE "id" = 'pack_dtf_games_30' OR "scope" = 'dtf-games-promo-30-v1';
