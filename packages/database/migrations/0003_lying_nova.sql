CREATE TABLE "admin_user_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_session_id" uuid,
	"event_name" text NOT NULL,
	"result" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"browser" text,
	"os" text,
	"device" text,
	CONSTRAINT "auth_event_name_check" CHECK ("auth_events"."event_name" in ('sign_up','sign_in','sign_out','email_verified','password_reset_requested','password_changed','sessions_revoked')),
	CONSTRAINT "auth_event_result_check" CHECK ("auth_events"."result" in ('success','failure'))
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"error_code" text,
	"safe_error_message" text,
	"worker_id" text,
	"pipeline_run_id" uuid,
	CONSTRAINT "background_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "background_job_type_check" CHECK ("background_jobs"."type" in ('content_revision_build','content_quality_check','music_pipeline','event_export','user_export','media_check','client_event_retention')),
	CONSTRAINT "background_job_status_check" CHECK ("background_jobs"."status" in ('queued','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "client_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_session_id" uuid,
	"game_session_id" uuid,
	"route" text,
	"app_version" text,
	"browser" text,
	"os" text,
	"device" text,
	"request_id" text,
	"error_code" text,
	"stack_fingerprint" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "client_event_name_check" CHECK ("client_events"."event_name" in ('page_view','mode_opened','client_error','api_error','network_offline','network_online','report_form_opened','report_submit_failed'))
);
--> statement-breakpoint
CREATE TABLE "content_quality_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"severity" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"item_id" text NOT NULL,
	"item_version_id" uuid,
	"workspace_change_id" uuid,
	"field" text,
	"message" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_until" timestamp with time zone,
	"accepted_comment" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "content_quality_fingerprint_unique" UNIQUE("fingerprint"),
	CONSTRAINT "content_quality_severity_check" CHECK ("content_quality_issues"."severity" in ('critical','warning','info')),
	CONSTRAINT "content_quality_status_check" CHECK ("content_quality_issues"."status" in ('open','accepted','resolved'))
);
--> statement-breakpoint
CREATE TABLE "content_workspace_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"change_type" text NOT NULL,
	"base_item_version_id" uuid,
	"before_payload" jsonb,
	"after_payload" jsonb NOT NULL,
	"changed_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"pipeline_run_id" uuid,
	"pipeline_run_item_id" uuid,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_workspace_item_unique" UNIQUE("workspace_id","item_id"),
	CONSTRAINT "content_workspace_change_type_check" CHECK ("content_workspace_changes"."change_type" in ('create','update','disable')),
	CONSTRAINT "content_workspace_source_check" CHECK ("content_workspace_changes"."source" in ('manual','ai_pipeline','bulk','rollback','report_fix'))
);
--> statement-breakpoint
CREATE TABLE "content_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Рабочая версия' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"built_revision_id" uuid,
	"created_by" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"last_validation_summary" jsonb,
	"failure_code" text,
	"safe_failure_message" text,
	CONSTRAINT "content_workspace_status_check" CHECK ("content_workspaces"."status" in ('open','building','ready','published','failed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_key" text NOT NULL,
	"card_id" text,
	"input_item_version_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"before_json" jsonb,
	"proposed_json" jsonb,
	"field_decisions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources_json" jsonb,
	"confidence_json" jsonb,
	"raw_result_ref" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"workspace_change_id" uuid,
	"applied_revision_id" uuid,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"safe_error_message" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_run_entity_unique" UNIQUE("run_id","entity_key"),
	CONSTRAINT "pipeline_run_item_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "pipeline_run_item_status_check" CHECK ("pipeline_run_items"."status" in ('pending','running','review_required','approved','staged','published','failed','rejected','conflict'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_key" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input_definition_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"items_total" integer DEFAULT 0 NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_succeeded" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(12, 6),
	"actual_cost" numeric(12, 6),
	"created_by" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"safe_error_message" text,
	"cancel_requested_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"worker_id" text,
	"filesystem_scope" text,
	"log_excerpt" text,
	"result_expires_at" timestamp with time zone,
	CONSTRAINT "pipeline_run_status_check" CHECK ("pipeline_runs"."status" in ('queued','running','review_required','partially_failed','approved','staged','published','partially_published','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_report_reason_check";--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_report_status_check";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "result" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "resolution_type" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "resolution_comment" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "linked_workspace_change_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "linked_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "duplicate_of_report_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "client_event_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "page_url" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "client_error_id" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "auth_session_id" uuid;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "account_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "blocked_by" uuid;--> statement-breakpoint
ALTER TABLE "admin_user_notes" ADD CONSTRAINT "admin_user_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_notes" ADD CONSTRAINT "admin_user_notes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_auth_session_id_session_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_issues" ADD CONSTRAINT "content_quality_issues_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_issues" ADD CONSTRAINT "content_quality_issues_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_issues" ADD CONSTRAINT "content_quality_issues_workspace_change_id_content_workspace_changes_id_fk" FOREIGN KEY ("workspace_change_id") REFERENCES "public"."content_workspace_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_workspace_id_content_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."content_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_base_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("base_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspace_changes" ADD CONSTRAINT "content_workspace_changes_pipeline_run_item_id_pipeline_run_items_id_fk" FOREIGN KEY ("pipeline_run_item_id") REFERENCES "public"."pipeline_run_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_workspace_change_id_content_workspace_changes_id_fk" FOREIGN KEY ("workspace_change_id") REFERENCES "public"."content_workspace_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspaces" ADD CONSTRAINT "content_workspaces_base_revision_id_content_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspaces" ADD CONSTRAINT "content_workspaces_built_revision_id_content_revisions_id_fk" FOREIGN KEY ("built_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workspaces" ADD CONSTRAINT "content_workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_card_id_content_items_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_input_item_version_id_content_item_versions_id_fk" FOREIGN KEY ("input_item_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_items" ADD CONSTRAINT "pipeline_run_items_applied_revision_id_content_revisions_id_fk" FOREIGN KEY ("applied_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_user_note_user_idx" ON "admin_user_notes" USING btree ("user_id","createdAt");--> statement-breakpoint
CREATE INDEX "auth_event_user_occurred_idx" ON "auth_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "background_job_claim_idx" ON "background_jobs" USING btree ("status","next_retry_at","createdAt");--> statement-breakpoint
CREATE INDEX "background_job_pipeline_idx" ON "background_jobs" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "client_event_occurred_idx" ON "client_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "client_event_user_occurred_idx" ON "client_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "client_event_game_session_idx" ON "client_events" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX "client_event_request_idx" ON "client_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "client_event_name_idx" ON "client_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "content_quality_status_severity_idx" ON "content_quality_issues" USING btree ("status","severity","mode");--> statement-breakpoint
CREATE INDEX "content_quality_item_idx" ON "content_quality_issues" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_workspace_pipeline_item_unique" ON "content_workspace_changes" USING btree ("pipeline_run_item_id") WHERE "content_workspace_changes"."pipeline_run_item_id" is not null;--> statement-breakpoint
CREATE INDEX "content_workspace_change_workspace_idx" ON "content_workspace_changes" USING btree ("workspace_id","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "content_workspace_single_active_idx" ON "content_workspaces" USING btree ((true)) WHERE "content_workspaces"."status" in ('open','building','ready');--> statement-breakpoint
CREATE INDEX "content_workspace_base_idx" ON "content_workspaces" USING btree ("base_revision_id");--> statement-breakpoint
CREATE INDEX "pipeline_run_item_run_status_idx" ON "pipeline_run_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "pipeline_run_status_created_idx" ON "pipeline_runs" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "pipeline_run_pipeline_created_idx" ON "pipeline_runs" USING btree ("pipeline_key","createdAt");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_linked_workspace_change_id_content_workspace_changes_id_fk" FOREIGN KEY ("linked_workspace_change_id") REFERENCES "public"."content_workspace_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_linked_revision_id_content_revisions_id_fk" FOREIGN KEY ("linked_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_duplicate_of_report_id_content_reports_id_fk" FOREIGN KEY ("duplicate_of_report_id") REFERENCES "public"."content_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_auth_session_id_session_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_blocked_by_user_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_action_created_idx" ON "audit_log" USING btree ("action","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "content_report_user_client_event_unique" ON "content_reports" USING btree ("user_id","client_event_id") WHERE "content_reports"."client_event_id" is not null;--> statement-breakpoint
CREATE INDEX "game_session_auth_session_idx" ON "game_sessions" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "player_profiles_status_until_idx" ON "player_profiles" USING btree ("account_status","blocked_until");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_result_check" CHECK ("audit_log"."result" in ('success','failure'));--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_report_resolution_type_check" CHECK ("content_reports"."resolution_type" is null or "content_reports"."resolution_type" in ('fixed_by_revision','already_fixed','expected_behavior','insufficient_data','duplicate','other'));--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_report_not_self_duplicate_check" CHECK ("content_reports"."duplicate_of_report_id" is null or "content_reports"."duplicate_of_report_id" <> "content_reports"."id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_report_reason_check" CHECK ("content_reports"."reason" in ('wrong_fact','disputed_comparison','title_not_found','bad_hint','bad_image','duplicate_card','typo_or_translation','technical_error','other'));--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_report_status_check" CHECK ("content_reports"."status" in ('open','in_progress','resolved','dismissed','duplicate'));--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_account_status_check" CHECK ("player_profiles"."account_status" in ('active','blocked'));
