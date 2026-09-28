-- ============================================================================
-- Migration: enable_order_barcode_and_clean_order_numbers.sql
-- Description:
-- 1. Adds `print_order_barcode` and `enable_order_barcode_scanner` to `public.profiles`
--    so seller print/scanner preferences persist across all devices.
-- 2. Adds `barcode` column to `public.orders`.
-- 3. Updates `generate_order_number()` to generate pure alphanumeric order numbers
--    (e.g., 202609280001) without any hyphens or special characters.
-- 4. Updates `set_order_number()` trigger to automatically populate clean alphanumeric
--    barcodes on all new orders.
-- 5. Backfills existing orders with clean alphanumeric barcodes.
-- 6. Reloads PostgREST schema cache.
-- ============================================================================

-- 1. Ensure required columns exist on profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS print_order_barcode BOOLEAN DEFAULT true;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS enable_order_barcode_scanner BOOLEAN DEFAULT false;

-- 2. Ensure barcode column exists on orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS barcode TEXT;

-- 3. Create high-speed lookup indexes
CREATE INDEX IF NOT EXISTS idx_orders_barcode 
ON public.orders(barcode);

CREATE INDEX IF NOT EXISTS idx_profiles_print_order_barcode 
ON public.profiles(print_order_barcode);

CREATE INDEX IF NOT EXISTS idx_profiles_enable_order_barcode 
ON public.profiles(enable_order_barcode_scanner);

-- 4. Update order number sequence table if not present
CREATE TABLE IF NOT EXISTS public.order_number_sequences (
    sequence_date DATE PRIMARY KEY,
    last_value INT NOT NULL
);

-- 5. Generate clean alphanumeric order numbers (Zero special characters: YYYYMMDD0001)
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT AS $$
DECLARE
    new_value INT;
    current_sequence_date DATE;
    order_prefix TEXT;
    order_suffix TEXT;
BEGIN
    current_sequence_date := NOW()::DATE;
    -- Prefix date formatted without dashes: e.g. 20260928
    order_prefix := to_char(current_sequence_date, 'YYYYMMDD');

    -- Lock the table to prevent concurrent sequence collisions
    LOCK TABLE public.order_number_sequences IN EXCLUSIVE MODE;

    -- Upsert daily sequence counter
    INSERT INTO public.order_number_sequences (sequence_date, last_value)
    VALUES (current_sequence_date, 1)
    ON CONFLICT (sequence_date)
    DO UPDATE SET last_value = order_number_sequences.last_value + 1
    RETURNING last_value INTO new_value;

    order_suffix := lpad(new_value::TEXT, 4, '0');

    -- Strictly alphanumeric - zero hyphens, hashes, or symbols (e.g. 202609280001)
    RETURN order_prefix || order_suffix;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger to automatically set clean order_number and clean barcode on every new order
CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    -- Assign order number if not set or empty
    IF NEW.order_number IS NULL OR TRIM(NEW.order_number) = '' THEN
        NEW.order_number := public.generate_order_number();
    END IF;

    -- Automatically generate clean alphanumeric barcode if omitted
    IF NEW.barcode IS NULL OR TRIM(NEW.barcode) = '' THEN
        NEW.barcode := regexp_replace(NEW.order_number, '[^A-Za-z0-9]', '', 'g');
    ELSE
        -- Strip any special characters from explicitly provided barcode
        NEW.barcode := regexp_replace(NEW.barcode, '[^A-Za-z0-9]', '', 'g');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger if needed
DROP TRIGGER IF EXISTS set_order_number_trigger ON public.orders;
CREATE TRIGGER set_order_number_trigger
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_number();

-- 7. Backfill clean alphanumeric barcode on all existing orders
UPDATE public.orders
SET barcode = regexp_replace(COALESCE(order_number, SUBSTRING(id::text, 1, 8)), '[^A-Za-z0-9]', '', 'g')
WHERE barcode IS NULL OR barcode ~ '[^A-Za-z0-9]';

-- 8. Grant table and column access to authenticated and anon roles
GRANT SELECT, UPDATE ON public.profiles TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated, anon;

-- 9. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
