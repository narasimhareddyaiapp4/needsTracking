-- =============================================================================
-- SQL MIGRATION: CREATE ORDER EMAIL & SMTP NOTIFICATION TRIGGER
-- Description:
-- 1. Adds tracking columns (email_sent, email_sent_at) to the orders table.
-- 2. Enables the pg_net extension for asynchronous HTTP requests from Postgres.
-- 3. Creates trigger function to invoke the 'send-seller-order-notification'
--    Supabase Edge Function via net.http_post whenever an order is created.
-- 4. Automatically dispatches emails via SMTP (or Resend fallback) to both
--    the seller (+ authorized staff) and buyer.
-- =============================================================================

-- Step 1: Add email tracking columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

-- Step 2: Enable pg_net extension for database-level HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 3: Trigger function to call the send-seller-order-notification edge function
CREATE OR REPLACE FUNCTION public.handle_order_created_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT := 'https://cikxysaxvbixrcwlgzds.supabase.co';
  v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpa3h5c2F4dmJpeHJjd2xnemRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzA2MjgsImV4cCI6MjEwNDIwNjYyOH0.YIc4KXr055r1D3-mKW1bCn06GNWWK4TXettqhazgpg4';
BEGIN
  -- Deduplication check: only invoke if email has not been processed yet
  IF NEW.email_sent IS NOT TRUE THEN
    BEGIN
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/send-seller-order-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := jsonb_build_object(
          'orderId', NEW.id,
          'source', 'postgres_trigger'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Non-blocking: ensure database insertion succeeds even if network/webhook fails
      RAISE WARNING 'send-seller-order-notification trigger HTTP call failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Drop existing trigger if present and recreate on public.orders
DROP TRIGGER IF EXISTS on_order_created_send_notification ON public.orders;

CREATE TRIGGER on_order_created_send_notification
  AFTER INSERT
  ON public.orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_order_created_notification();

COMMENT ON TRIGGER on_order_created_send_notification ON public.orders
IS 'Automatically invokes send-seller-order-notification Edge Function to dispatch SMTP email and notifications whenever a new order is inserted.';
