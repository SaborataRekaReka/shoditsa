ALTER TABLE "friends_rooms" ADD COLUMN "game_type" text DEFAULT 'quiz' NOT NULL;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD COLUMN "danetki_session_id" uuid;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD CONSTRAINT "friends_rooms_danetki_session_id_game_sessions_id_fk" FOREIGN KEY ("danetki_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD CONSTRAINT "friends_room_game_type_check" CHECK ("friends_rooms"."game_type" in ('quiz', 'danetki'));