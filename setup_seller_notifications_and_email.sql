-- ============================================================================
-- SQL Migration: setup_seller_notifications_and_email.sql
-- Description:
-- 1. Enable Supabase Realtime publication on `orders` table so sellers' browsers
--    immediately receive instant audio chimes and system desktop notifications.
-- 2. Ensure RLS policies allow sellers to read and receive realtime events for their orders.
-- 3. Optional Database Webhook / Trigger to automatically invoke Edge Function
--    `send-seller-order-notification` on each new order.
-- ============================================================================

-- 1. Enable Realtime Replication for the `orders` table
-- (Required for supabase.channel('...').on('postgres_changes', ...) to receive inserts/updates in browsers)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

-- 2. Ensure sellers can SELECT their own orders (RLS policy required for Realtime events to be delivered to seller)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'orders' 
      AND policyname = 'Sellers can view orders assigned to them'
  ) THEN
    CREATE POLICY "Sellers can view orders assigned to them"
    ON public.orders
    FOR SELECT
    TO authenticated
    USING (
      auth.uid() = seller_id 
      OR auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
          AND profiles.role IN ('admin', 'manager')
      )
    );
  END IF;
END $$;

-- 3. Ensure permissions on push_tokens table for storing web push tokens
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_tokens TO authenticated, anon, service_role;

-- 4. Enable pg_net extension if you want PostgreSQL to call the Edge Function directly via Database Trigger
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 5. Add email tracking columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

-- 6. Trigger function to call send-seller-order-notification Edge Function
CREATE OR REPLACE FUNCTION public.handle_order_created_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT := 'https://cikxysaxvbixrcwlgzds.supabase.co';
  v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpa3h5c2F4dmJpeHJjd2xnemRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzA2MjgsImV4cCI6MjEwNDIwNjYyOH0.YIc4KXr055r1D3-mKW1bCn06GNWWK4TXettqhazgpg4';
BEGIN
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
      RAISE WARNING 'send-seller-order-notification trigger HTTP call failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Trigger on orders table
DROP TRIGGER IF EXISTS on_order_created_send_notification ON public.orders;

CREATE TRIGGER on_order_created_send_notification
  AFTER INSERT
  ON public.orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_order_created_notification();

COMMENT ON TABLE public.orders IS 'Orders table enabled with Realtime broadcast and automatic SMTP email notification triggers.';
