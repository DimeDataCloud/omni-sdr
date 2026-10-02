-- Omni-SDR 0012: a new org starts its trial with credits (SPEC §1 step 1: the 7-day trial). Without this a trialing
-- customer could run nothing metered (no ICP proposal, competitor search or generation): found by the acceptance
-- script, 2026-10-02. The amounts are PLACEHOLDERS (DECISIONS 2026-09-28: pricing undecided); ops can change any
-- balance through the ledger. Media stays at nothing: media generation is off for every org until Christian turns it on.
-- Granted through the ledger (kind 'grant', ref 'trial'), so balance = sum(ledger) still holds.
GRANT INSERT ON credit_balances TO ledger_owner;
CREATE FUNCTION grant_trial_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  FOR g IN SELECT * FROM (VALUES ('action', 100::bigint), ('data', 25::bigint)) AS t(meter, amount) LOOP
    INSERT INTO credit_balances (org_id, meter, balance) VALUES (NEW.id, g.meter, g.amount)
      ON CONFLICT (org_id, meter) DO UPDATE SET balance = credit_balances.balance + EXCLUDED.balance;
    INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type) VALUES (NEW.id, g.meter, g.amount, 'grant', 'trial');
  END LOOP;
  RETURN NEW;
END $$;
GRANT CREATE ON SCHEMA public TO ledger_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION grant_trial_credits() OWNER TO ledger_owner;
REVOKE CREATE ON SCHEMA public FROM ledger_owner;
REVOKE EXECUTE ON FUNCTION grant_trial_credits() FROM PUBLIC;
CREATE TRIGGER grant_trial_credits AFTER INSERT ON orgs FOR EACH ROW EXECUTE FUNCTION grant_trial_credits();
