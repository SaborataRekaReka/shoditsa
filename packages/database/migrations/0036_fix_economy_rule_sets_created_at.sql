DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'economy_rule_sets'
      AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'economy_rule_sets'
      AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "economy_rule_sets" RENAME COLUMN "created_at" TO "createdAt";
  END IF;
END
$$;
