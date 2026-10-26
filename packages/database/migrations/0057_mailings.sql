CREATE TABLE "mailing_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"consent_source" text,
	"created_by" uuid,
	"consent_by" uuid,
	"prepared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_send_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	CONSTRAINT "mailing_campaign_status_check" CHECK ("mailing_campaigns"."status" in ('draft','sending','paused','completed'))
);
--> statement-breakpoint
CREATE TABLE "mailing_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"email_hash" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "mailing_recipient_status_check" CHECK ("mailing_recipients"."status" in ('queued','sending','accepted','failed','unknown','suppressed')),
	CONSTRAINT "mailing_recipient_kind_check" CHECK ("mailing_recipients"."kind" in ('campaign','test'))
);
--> statement-breakpoint
CREATE TABLE "mailing_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailing_campaigns" ADD CONSTRAINT "mailing_campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_campaigns" ADD CONSTRAINT "mailing_campaigns_consent_by_user_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_recipients" ADD CONSTRAINT "mailing_recipients_campaign_id_mailing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mailing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_recipients" ADD CONSTRAINT "mailing_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailing_recipient_once_idx" ON "mailing_recipients" USING btree ("campaign_id","email_hash","kind");--> statement-breakpoint
CREATE INDEX "mailing_recipient_queue_idx" ON "mailing_recipients" USING btree ("campaign_id","status","created_at");