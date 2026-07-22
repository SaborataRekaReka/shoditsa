CREATE TYPE "public"."friends_room_member_role" AS ENUM('owner', 'player');--> statement-breakpoint
CREATE TYPE "public"."friends_room_phase" AS ENUM('lobby', 'countdown', 'active', 'results', 'finished');--> statement-breakpoint
CREATE TABLE "friends_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"rounds_total" smallint DEFAULT 5 NOT NULL,
	"answer_time_seconds" smallint DEFAULT 30 NOT NULL,
	"phase" "friends_room_phase" DEFAULT 'lobby' NOT NULL,
	"current_round" smallint DEFAULT 0 NOT NULL,
	"phase_started_at" timestamp with time zone,
	"phase_ends_at" timestamp with time zone,
	"next_message_seq" bigint DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_rooms_code_unique" UNIQUE("code"),
	CONSTRAINT "friends_room_code_check" CHECK (char_length("friends_rooms"."code") = 5),
	CONSTRAINT "friends_room_rounds_check" CHECK ("friends_rooms"."rounds_total" in (3, 5, 7)),
	CONSTRAINT "friends_room_answer_time_check" CHECK ("friends_rooms"."answer_time_seconds" in (15, 20, 30, 45)),
	CONSTRAINT "friends_room_current_round_check" CHECK ("friends_rooms"."current_round" between 0 and "friends_rooms"."rounds_total")
);
--> statement-breakpoint
CREATE TABLE "friends_room_members" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "friends_room_member_role" DEFAULT 'player' NOT NULL,
	"display_name_snapshot" text NOT NULL,
	"color_key" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id"),
	CONSTRAINT "friends_room_member_name_check" CHECK (char_length("friends_room_members"."display_name_snapshot") between 1 and 40),
	CONSTRAINT "friends_room_member_score_check" CHECK ("friends_room_members"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "friends_room_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"content_item_version_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"hints" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_room_round_position_unique" UNIQUE("room_id","position"),
	CONSTRAINT "friends_room_round_position_check" CHECK ("friends_room_rounds"."position" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "friends_room_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_room_answer_round_user_unique" UNIQUE("round_id","user_id"),
	CONSTRAINT "friends_room_answer_idempotency_unique" UNIQUE("room_id","user_id","idempotency_key"),
	CONSTRAINT "friends_room_answer_text_check" CHECK (char_length("friends_room_answers"."text") between 1 and 160),
	CONSTRAINT "friends_room_answer_points_check" CHECK ("friends_room_answers"."points" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "friends_room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_room_message_seq_unique" UNIQUE("room_id","seq"),
	CONSTRAINT "friends_room_message_idempotency_unique" UNIQUE("room_id","user_id","idempotency_key"),
	CONSTRAINT "friends_room_message_text_check" CHECK (char_length("friends_room_messages"."text") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD CONSTRAINT "friends_rooms_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_rooms" ADD CONSTRAINT "friends_rooms_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_members" ADD CONSTRAINT "friends_room_members_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_members" ADD CONSTRAINT "friends_room_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_rounds" ADD CONSTRAINT "friends_room_rounds_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_rounds" ADD CONSTRAINT "friends_room_rounds_content_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("content_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_answers" ADD CONSTRAINT "friends_room_answers_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_answers" ADD CONSTRAINT "friends_room_answers_round_id_friends_room_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."friends_room_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_answers" ADD CONSTRAINT "friends_room_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_messages" ADD CONSTRAINT "friends_room_messages_room_id_friends_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."friends_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_room_messages" ADD CONSTRAINT "friends_room_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friends_room_owner_idx" ON "friends_rooms" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "friends_room_members_active_idx" ON "friends_room_members" USING btree ("room_id","left_at","joined_at");--> statement-breakpoint
CREATE INDEX "friends_room_round_item_idx" ON "friends_room_rounds" USING btree ("room_id","content_item_version_id");--> statement-breakpoint
CREATE INDEX "friends_room_answer_room_round_idx" ON "friends_room_answers" USING btree ("room_id","round_id","submitted_at");--> statement-breakpoint
CREATE INDEX "friends_room_message_room_created_idx" ON "friends_room_messages" USING btree ("room_id","created_at");
