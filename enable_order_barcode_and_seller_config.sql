-- ============================================================================
-- Migration: enable_order_barcode_and_seller_config.sql
-- Description:
-- 1. Adds `enable_order_barcode_scanner` to `public.profiles` to allow sellers
--    to individually configure/enable the order barcode scanner for their store.
-- 2. Adds `barcode` column to `public.orders` to store dedicated order barcodes
--    generated during order creation.
-- 3. Creates indexes for high-speed barcode search lookup on orders.
-- 4. Reloads PostgREST schema cache.
-- ============================================================================

-- 1. Add barcode scanner toggle column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS enable_order_barcode_scanner BOOLEAN DEFAULT false;

-- 2. Add barcode column to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS barcode TEXT;

-- 3. Create indexes for fast barcode queries
CREATE INDEX IF NOT EXISTS idx_orders_barcode 
ON public.orders(barcode);

CREATE INDEX IF NOT EXISTS idx_profiles_enable_order_barcode 
ON public.profiles(enable_order_barcode_scanner);

-- 4. Grant table and column access to authenticated and anon roles
GRANT SELECT, UPDATE ON public.profiles TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated, anon;

-- 5. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
