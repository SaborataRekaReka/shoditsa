CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('shoditsa.account_merge', true) = 'on'
     AND NEW."user_id" IS DISTINCT FROM OLD."user_id"
     AND NEW."operation_key" = OLD."operation_key"
     AND NEW."amount" = OLD."amount"
     AND NEW."balance_after" = OLD."balance_after" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_ledger is append-only';
END;
$$ LANGUAGE plpgsql;
