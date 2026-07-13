CREATE TABLE "integration_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"last_four" text NOT NULL,
	"updated_by" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;