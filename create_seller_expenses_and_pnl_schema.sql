-- =============================================================================
-- SQL MIGRATION: SELLER EXPENSES, SALARY & PROFIT / LOSS (P&L) SYSTEM
-- Description:
-- 1. Updates seller_employees to support monthly_salary and daily_wage.
-- 2. Creates public.seller_expenses table for tracking:
--    - Monthly employee salaries with days worked attendance
--    - Store rent and fixed monthly overheads
--    - Daily groceries and raw material procurement
--    - Parcel packaging, tape, box & container costs
--    - Utilities, electricity, water, and miscellaneous expenses
-- 3. Enables RLS policies for sellers and managers.
-- 4. Creates RPC function get_seller_pnl_summary for instant daily P&L reporting.
-- =============================================================================

-- 1. Add salary fields to seller_employees table
ALTER TABLE public.seller_employees 
ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS daily_wage NUMERIC(10, 2) DEFAULT 0;

-- 2. Create seller_expenses table
CREATE TABLE IF NOT EXISTS public.seller_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (
        category IN (
            'groceries',          -- Daily raw materials, ingredients, vegetables, milk, meat
            'parcel_packaging',   -- Delivery boxes, food containers, carry bags, tape
            'rent',               -- Store shop rent
            'salary',             -- Employee payroll / wages
            'utilities',          -- Electricity, water, gas, Wi-Fi
            'delivery_logistics', -- Rider payouts, petrol/fuel, delivery charges
            'maintenance',        -- Equipment repairs, cleaning, pest control
            'other'               -- Miscellaneous expenses
        )
    ),
    title TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expense_type TEXT NOT NULL DEFAULT 'daily' CHECK (expense_type IN ('daily', 'monthly_recurring', 'salary')),
    
    -- Specific fields for employee salary calculation
    employee_id UUID REFERENCES public.seller_employees(id) ON DELETE SET NULL,
    days_worked NUMERIC(5, 2),        -- e.g. 26.0 or 15.5 days worked
    monthly_rate NUMERIC(10, 2),       -- Base monthly salary or base monthly rent
    total_month_days INT DEFAULT 30,   -- Base days in month (usually 30 or 26)

    payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'card', 'credit')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_seller_expenses_seller_id ON public.seller_expenses(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_expenses_seller_date ON public.seller_expenses(seller_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_seller_expenses_category ON public.seller_expenses(seller_id, category);
CREATE INDEX IF NOT EXISTS idx_seller_expenses_employee_id ON public.seller_expenses(employee_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.seller_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers can manage their own expenses" ON public.seller_expenses;
DROP POLICY IF EXISTS "Admins can view all expenses" ON public.seller_expenses;

CREATE POLICY "Sellers can manage their own expenses"
ON public.seller_expenses
FOR ALL
TO authenticated
USING (
    auth.uid() = seller_id 
    OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'superadmin', 'manager')
    )
)
WITH CHECK (
    auth.uid() = seller_id 
    OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'superadmin', 'manager')
    )
);

-- 4. RPC Function for Aggregated Daily P&L (Profit & Loss) Summary
CREATE OR REPLACE FUNCTION public.get_seller_daily_pnl_summary(
    p_seller_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    summary_date DATE,
    total_revenue NUMERIC,
    orders_count BIGINT,
    total_expenses NUMERIC,
    groceries_expense NUMERIC,
    salary_expense NUMERIC,
    rent_expense NUMERIC,
    parcel_expense NUMERIC,
    other_expense NUMERIC,
    net_pnl NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS day
    ),
    daily_orders AS (
        SELECT 
            DATE(o.created_at) AS order_date,
            COALESCE(SUM(o.total_amount), 0) AS revenue,
            COUNT(o.id) AS order_cnt
        FROM public.orders o
        WHERE (o.seller_id = p_seller_id OR o.user_id = p_seller_id)
          AND DATE(o.created_at) >= p_start_date
          AND DATE(o.created_at) <= p_end_date
          AND o.status NOT IN ('cancelled', 'rejected')
        GROUP BY DATE(o.created_at)
    ),
    daily_exp AS (
        SELECT 
            e.expense_date,
            COALESCE(SUM(e.amount), 0) AS total_exp,
            COALESCE(SUM(CASE WHEN e.category = 'groceries' THEN e.amount ELSE 0 END), 0) AS exp_groceries,
            COALESCE(SUM(CASE WHEN e.category = 'salary' THEN e.amount ELSE 0 END), 0) AS exp_salary,
            COALESCE(SUM(CASE WHEN e.category = 'rent' THEN e.amount ELSE 0 END), 0) AS exp_rent,
            COALESCE(SUM(CASE WHEN e.category = 'parcel_packaging' THEN e.amount ELSE 0 END), 0) AS exp_parcel,
            COALESCE(SUM(CASE WHEN e.category NOT IN ('groceries', 'salary', 'rent', 'parcel_packaging') THEN e.amount ELSE 0 END), 0) AS exp_other
        FROM public.seller_expenses e
        WHERE e.seller_id = p_seller_id
          AND e.expense_date >= p_start_date
          AND e.expense_date <= p_end_date
        GROUP BY e.expense_date
    )
    SELECT 
        d.day AS summary_date,
        COALESCE(o.revenue, 0)::NUMERIC AS total_revenue,
        COALESCE(o.order_cnt, 0)::BIGINT AS orders_count,
        COALESCE(e.total_exp, 0)::NUMERIC AS total_expenses,
        COALESCE(e.exp_groceries, 0)::NUMERIC AS groceries_expense,
        COALESCE(e.exp_salary, 0)::NUMERIC AS salary_expense,
        COALESCE(e.exp_rent, 0)::NUMERIC AS rent_expense,
        COALESCE(e.exp_parcel, 0)::NUMERIC AS parcel_expense,
        COALESCE(e.exp_other, 0)::NUMERIC AS other_expense,
        (COALESCE(o.revenue, 0) - COALESCE(e.total_exp, 0))::NUMERIC AS net_pnl
    FROM date_series d
    LEFT JOIN daily_orders o ON d.day = o.order_date
    LEFT JOIN daily_exp e ON d.day = e.expense_date
    ORDER BY d.day DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_seller_daily_pnl_summary(UUID, DATE, DATE) TO authenticated, anon, service_role;
GRANT ALL ON TABLE public.seller_expenses TO authenticated, service_role;

COMMENT ON TABLE public.seller_expenses IS 'Tracks store operating expenses, raw groceries, parcel costs, store rent, and employee salaries with days attendance.';
COMMENT ON FUNCTION public.get_seller_daily_pnl_summary IS 'Generates day-by-day revenue vs expense profit-and-loss (P&L) breakdown.';
