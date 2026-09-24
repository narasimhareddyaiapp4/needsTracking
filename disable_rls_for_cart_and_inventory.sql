-- ==============================================================================
-- DISABLE RLS & GRANT PERMISSIONS FOR CARTS, INVENTORY, PRODUCTS & ALL TABLES
-- Run this script in your Supabase Dashboard -> SQL Editor -> Run
-- ==============================================================================

-- 1. Ensure public schema usage is granted to all roles
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- 2. Explicitly disable RLS on Cart & Inventory tables
ALTER TABLE IF EXISTS public.carts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cart_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory_history DISABLE ROW LEVEL SECURITY;

-- 3. Explicitly disable RLS on Product & Variant tables
ALTER TABLE IF EXISTS public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_media DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.variant_options DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_variant_combinations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_barcodes DISABLE ROW LEVEL SECURITY;

-- 4. Explicitly disable RLS on Orders & Staff tables
ALTER TABLE IF EXISTS public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.seller_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customers DISABLE ROW LEVEL SECURITY;

-- 5. Dynamically disable Row Level Security across ALL existing public tables
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', r.tablename);
    END LOOP;
END $$;

-- 6. Grant full permissions on all tables, sequences, and routines
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- 7. Ensure future created tables & sequences also have full permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- 8. Force PostgREST API to refresh schema cache immediately
NOTIFY pgrst, 'reload schema';
