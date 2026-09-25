-- ============================================================================
-- Migration: add_offers_and_delivery_partner_cost_schema.sql
-- Description:
-- 1. Product Offers & MRP Strike-through Discounts (e.g. MRP ₹200 vs Price ₹150)
-- 2. Per-Seller Delivery Partner Fee & Free Delivery Threshold (Orders >= ₹200)
-- ============================================================================

-- 1. Add MRP (Original Price) column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS mrp NUMERIC(10, 2) DEFAULT NULL;

COMMENT ON COLUMN public.products.mrp IS 'Maximum Retail Price (MRP) used for displaying strike-through discounts and offer badges (e.g. 20% OFF)';

-- 2. Add MRP column to product variant combinations (if different sizes/colors have distinct MRPs)
ALTER TABLE public.product_variant_combinations 
ADD COLUMN IF NOT EXISTS mrp NUMERIC(10, 2) DEFAULT NULL;

COMMENT ON COLUMN public.product_variant_combinations.mrp IS 'Variant-specific MRP for strike-through discount calculations';

-- 3. Add Delivery Partner & Threshold settings to seller profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS enable_delivery BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS default_delivery_fee NUMERIC(10, 2) DEFAULT 30.00,
ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(10, 2) DEFAULT 200.00,
ADD COLUMN IF NOT EXISTS delivery_partner_type TEXT DEFAULT 'platform'; -- 'platform' | 'in_house' | 'both'

COMMENT ON COLUMN public.profiles.default_delivery_fee IS 'Base delivery charge paid to delivery partner or added to order';
COMMENT ON COLUMN public.profiles.free_delivery_threshold IS 'Minimum order subtotal to unlock 100% FREE delivery for customers (defaults to 200.00)';

-- 4. Add delivery fee & partner payout columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS delivery_partner_payout NUMERIC(10, 2) DEFAULT 0.00;

COMMENT ON COLUMN public.orders.delivery_fee IS 'Delivery fee charged to buyer (0 if free delivery unlocked)';
COMMENT ON COLUMN public.orders.delivery_partner_payout IS 'Compensation amount paid to the delivery partner for completing delivery';

-- 5. Performance index for active products with offers
CREATE INDEX IF NOT EXISTS idx_products_mrp ON public.products(mrp) WHERE mrp IS NOT NULL;

-- 6. Ensure permissions for anon and authenticated users
GRANT SELECT, INSERT, UPDATE ON TABLE public.products TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.product_variant_combinations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.orders TO anon, authenticated, service_role;
