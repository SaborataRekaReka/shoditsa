CREATE TABLE "registration_mode_play_credits" (
	"user_id" uuid NOT NULL,
	"mode" "content_mode" NOT NULL,
	"remaining" smallint DEFAULT 3 NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_mode_play_credits_user_id_mode_pk" PRIMARY KEY("user_id","mode"),
	CONSTRAINT "registration_mode_play_credits_remaining_check" CHECK ("registration_mode_play_credits"."remaining" between 0 and 3),
	CONSTRAINT "registration_mode_play_credits_mode_check" CHECK ("registration_mode_play_credits"."mode" not in ('diagnosis','territory'))
);
--> statement-breakpoint
ALTER TABLE "registration_mode_play_credits" ADD CONSTRAINT "registration_mode_play_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Keep every Diagnosis balance unchanged. Only existing campaign recipients
-- receive the additional per-mode grants; historical accounts are not enrolled.
INSERT INTO "registration_mode_play_credits" ("user_id","mode","granted_at")
SELECT b.user_id, m.mode::content_mode, b.granted_at
FROM registration_play_credits b
CROSS JOIN unnest(ARRAY['movie','series','anime','game','music','city','animal','book','character','connections','danetki']) AS m(mode)
ON CONFLICT DO NOTHING;
