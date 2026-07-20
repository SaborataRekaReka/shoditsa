UPDATE "app_settings"
SET
  "value" = 'true'::jsonb,
  "version" = "version" + 1,
  "updatedAt" = now()
WHERE "key" = 'danetki.enabled'
  AND "value" = 'false'::jsonb
  AND "updated_by" IS NULL;
