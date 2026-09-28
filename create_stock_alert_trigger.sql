-- =============================================================================
-- STOCK ALERT TRIGGER: NOTIFY SELLER & STAFF ON LOW STOCK OR OUT OF STOCK
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_stock_level_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_old_qty INT;
  v_new_qty INT;
  v_threshold INT := 5;
BEGIN
  v_old_qty := COALESCE(OLD.quantity, 0);
  v_new_qty := COALESCE(NEW.quantity, 0);

  -- Only trigger if stock decreased and crossed threshold:
  -- 1) Dropped to Low Stock: old > 5 and new <= 5 and new > 0
  -- 2) Dropped to Out of Stock: old > 0 and new <= 0
  IF (v_old_qty > v_threshold AND v_new_qty <= v_threshold AND v_new_qty > 0)
     OR (v_old_qty > 0 AND v_new_qty <= 0) THEN

    -- Call the send-stock-alert Supabase edge function
    PERFORM net.http_post(
      url := 'https://cikxysaxvbixrcwlgzds.supabase.co/functions/v1/send-stock-alert',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0Y3hoaGJpZ21xcm1xZHloemN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjE3ODgsImV4cCI6MjA2NzczNzc4OH0.AIViaiRT2odHJM2wQXl3dDZ69YxEj7t_7UiRFqEgZjY"}'::jsonb,
      body := jsonb_build_object(
        'product_variant_combination_id', NEW.id,
        'old_quantity', v_old_qty,
        'new_quantity', v_new_qty,
        'threshold', v_threshold
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_stock_level_change ON public.product_variant_combinations;

-- Create trigger on quantity updates
CREATE TRIGGER on_stock_level_change
  AFTER UPDATE OF quantity
  ON public.product_variant_combinations
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_stock_level_alert();
