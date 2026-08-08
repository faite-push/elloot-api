-- Patch: wallet credit via SECURITY DEFINER; no direct writes for elloot_app.
BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE wallet_ledger FROM elloot_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE wallet_ledger FROM PUBLIC;
GRANT SELECT ON TABLE wallet_ledger TO elloot_app;

CREATE OR REPLACE FUNCTION service_credit_wallet(
  p_id text,
  p_user_id text,
  p_order_id text,
  p_type "LedgerType",
  p_amount_cents integer,
  p_description text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev integer;
BEGIN
  IF NOT app_is_service() THEN
    RAISE EXCEPTION 'service context required for wallet credit'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_cents = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wallet:' || p_user_id));

  SELECT wl."balanceAfter" INTO v_prev
  FROM wallet_ledger wl
  WHERE wl."userId" = p_user_id
  ORDER BY wl."createdAt" DESC, wl.id DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO wallet_ledger (
    id, "userId", "orderId", type, "amountCents", "balanceAfter", description, "createdAt"
  ) VALUES (
    p_id,
    p_user_id,
    p_order_id,
    p_type,
    p_amount_cents,
    coalesce(v_prev, 0) + p_amount_cents,
    p_description,
    NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION service_credit_wallet(text, text, text, "LedgerType", integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION service_credit_wallet(text, text, text, "LedgerType", integer, text) TO elloot_app;

COMMIT;
