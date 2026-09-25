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
-- (Alternatively, you can configure Supabase Dashboard -> Database -> Webhooks)
CREATE EXTENSION IF NOT EXISTS pg_net;

COMMENT ON TABLE public.orders IS 'Orders table enabled with Realtime broadcast for seller instant browser popups and sound alerts.';
