CREATE TABLE "svoyak_analytics_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "svoyak_answer_events" (
	"room_code" text NOT NULL,
	"event_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "svoyak_answer_events_room_code_event_id_pk" PRIMARY KEY("room_code","event_id")
);
--> statement-breakpoint
CREATE TABLE "svoyak_content_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"catalog" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "svoyak_revision_status_check" CHECK ("svoyak_content_revisions"."status" in ('ready','active','retired','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "svoyak_members" (
	"room_code" text NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "svoyak_members_room_code_member_id_pk" PRIMARY KEY("room_code","member_id")
);
--> statement-breakpoint
CREATE TABLE "svoyak_questions" (
	"revision_id" text NOT NULL,
	"id" text NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	CONSTRAINT "svoyak_questions_revision_id_id_pk" PRIMARY KEY("revision_id","id")
);
--> statement-breakpoint
CREATE TABLE "svoyak_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"library_revision" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svoyak_rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now()+interval '7 days' NOT NULL,
	CONSTRAINT "svoyak_room_code_check" CHECK ("svoyak_rooms"."code" ~ '^[A-F0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "svoyak_analytics_outbox" ADD CONSTRAINT "svoyak_analytics_outbox_id_svoyak_results_id_fk" FOREIGN KEY ("id") REFERENCES "public"."svoyak_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_answer_events" ADD CONSTRAINT "svoyak_answer_events_room_code_svoyak_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."svoyak_rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_members" ADD CONSTRAINT "svoyak_members_room_code_svoyak_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."svoyak_rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_members" ADD CONSTRAINT "svoyak_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_questions" ADD CONSTRAINT "svoyak_questions_revision_id_svoyak_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."svoyak_content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_results" ADD CONSTRAINT "svoyak_results_room_code_svoyak_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."svoyak_rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_results" ADD CONSTRAINT "svoyak_results_library_revision_svoyak_content_revisions_id_fk" FOREIGN KEY ("library_revision") REFERENCES "public"."svoyak_content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svoyak_rooms" ADD CONSTRAINT "svoyak_rooms_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "svoyak_one_active_revision" ON "svoyak_content_revisions" USING btree ("status") WHERE "svoyak_content_revisions"."status"='active';--> statement-breakpoint
CREATE INDEX "svoyak_member_user_idx" ON "svoyak_members" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "svoyak_room_expiry_idx" ON "svoyak_rooms" USING btree ("expires_at");