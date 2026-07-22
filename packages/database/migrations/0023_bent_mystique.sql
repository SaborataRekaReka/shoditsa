ALTER TABLE "friends_rooms" DROP CONSTRAINT "friends_room_rounds_check";--> statement-breakpoint
ALTER TABLE "friends_rooms" ALTER COLUMN "rounds_total" SET DEFAULT 6;--> statement-breakpoint
UPDATE "friends_rooms"
SET "rounds_total" = CASE WHEN "rounds_total" = 5 THEN 6 ELSE 9 END
WHERE "phase" = 'lobby' AND "rounds_total" IN (5, 7);--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD CONSTRAINT "friends_room_rounds_check" CHECK ("friends_rooms"."rounds_total" between 3 and 30);
