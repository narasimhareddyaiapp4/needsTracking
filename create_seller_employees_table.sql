-- ============================================================================
-- SELLER EMPLOYEES & STAFF MANAGEMENT MIGRATION
-- Run this script in your Supabase SQL Editor
-- ============================================================================

-- 1. Create seller_employees table
CREATE TABLE IF NOT EXISTS public.seller_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT,
    mobile TEXT,
    designation TEXT NOT NULL DEFAULT 'cashier', -- 'cashier', 'order_manager', 'inventory_manager', 'manager', 'custom'
    pin_code VARCHAR(10), -- 4-6 digit quick PIN for counter POS switching / login
    permissions JSONB NOT NULL DEFAULT '{
        "can_pos_bill": true,
        "can_manage_orders": true,
        "can_manage_inventory": false,
        "can_manage_products": false,
        "can_view_reports": false
    }'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_seller_employees_seller_id ON public.seller_employees(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_employees_user_id ON public.seller_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_employees_mobile ON public.seller_employees(mobile);
CREATE INDEX IF NOT EXISTS idx_seller_employees_email ON public.seller_employees(email);

-- 2. Add employee attribution columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS created_by_employee_id UUID REFERENCES public.seller_employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS employee_name TEXT;

-- 3. Row Level Security (RLS) on seller_employees
ALTER TABLE public.seller_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers can manage their own employees" ON public.seller_employees;
DROP POLICY IF EXISTS "Employees can view own record" ON public.seller_employees;
DROP POLICY IF EXISTS "Allow staff login resolution" ON public.seller_employees;

-- Store owner has full access (select, insert, update, delete) to their own employees
CREATE POLICY "Sellers can manage their own employees"
ON public.seller_employees
FOR ALL
USING (auth.uid() = seller_id)
WITH CHECK (auth.uid() = seller_id);

-- Employee can view their own record
CREATE POLICY "Employees can view own record"
ON public.seller_employees
FOR SELECT
USING (auth.uid() = user_id);

-- Allow authenticated users to look up their employee association by email or user_id
CREATE POLICY "Allow staff login resolution"
ON public.seller_employees
FOR SELECT
USING (true);

-- 4. Allow employees to access products, categories, orders of their employer store
-- Products SELECT for employees
DROP POLICY IF EXISTS "Employees can view employer products" ON public.products;
CREATE POLICY "Employees can view employer products"
ON public.products
FOR SELECT
USING (
    user_id IN (
        SELECT seller_id FROM public.seller_employees 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

-- Orders SELECT, INSERT, UPDATE for employees
DROP POLICY IF EXISTS "Employees can view employer orders" ON public.orders;
CREATE POLICY "Employees can view employer orders"
ON public.orders
FOR SELECT
USING (
    seller_id IN (
        SELECT seller_id FROM public.seller_employees 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

DROP POLICY IF EXISTS "Employees can update employer orders" ON public.orders;
CREATE POLICY "Employees can update employer orders"
ON public.orders
FOR UPDATE
USING (
    seller_id IN (
        SELECT seller_id FROM public.seller_employees 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

DROP POLICY IF EXISTS "Employees can insert employer orders" ON public.orders;
CREATE POLICY "Employees can insert employer orders"
ON public.orders
FOR INSERT
WITH CHECK (
    seller_id IN (
        SELECT seller_id FROM public.seller_employees 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

-- Helper function to verify employee quick PIN or lookup
CREATE OR REPLACE FUNCTION public.verify_employee_pin(
    p_seller_id UUID,
    p_pin TEXT
)
RETURNS TABLE (
    employee_id UUID,
    employee_name TEXT,
    employee_designation TEXT,
    employee_permissions JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT id, name, designation, permissions
    FROM public.seller_employees
    WHERE seller_id = p_seller_id
      AND pin_code = p_pin
      AND is_active = true
    LIMIT 1;
END;
$$;
