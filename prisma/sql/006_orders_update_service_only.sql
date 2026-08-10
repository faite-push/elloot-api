DROP POLICY IF EXISTS orders_update ON orders;
CREATE POLICY orders_update ON orders FOR UPDATE
  USING (app_is_service() OR app_is_admin())
  WITH CHECK (app_is_service() OR app_is_admin());
