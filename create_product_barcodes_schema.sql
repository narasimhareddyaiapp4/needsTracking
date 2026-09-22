-- ============================================================================
-- Migration: create_product_barcodes_schema.sql
-- Description:
-- Complete barcode and inventory tracking support for:
--  1. Grocery (Multi-pack / Case packaging multipliers, EAN/UPC)
--  2. Clothing / Apparel (Matrix variants: Size + Color combinations)
--  3. Jewelry (Serialized unique pieces, gross/net weight, purity, HUID/cert)
--  4. Hotels / Hospitality (Minibar room billing, F&B requisition, Linen assets)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create product_barcodes table
CREATE TABLE IF NOT EXISTS public.product_barcodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    product_variant_combination_id UUID REFERENCES public.product_variant_combinations(id) ON DELETE CASCADE,
    
    -- Barcode & Serial Identification
    barcode TEXT NOT NULL,
    barcode_type TEXT DEFAULT 'CODE128', -- 'EAN13', 'UPC', 'CODE128', 'QR', 'DATAMATRIX'
    serial_number TEXT,                  -- Unique serial for Jewelry / Assets
    
    -- Packaging & Multiplier (Grocery packs, wholesale cartons)
    packaging_unit TEXT DEFAULT 'piece', -- 'piece', 'bottle', 'pack_6', 'case_24', 'box', 'linen'
    multiplier INT NOT NULL DEFAULT 1,   -- Multiplies stock impact (e.g. 1 case = 24 pieces)
    
    -- Item Lifecycle Status (Jewelry / Hotel Assets / Standard Retail)
    item_status TEXT NOT NULL DEFAULT 'in_stock', -- 'in_stock', 'sold', 'in_room', 'laundry', 'damaged'
    is_primary BOOLEAN DEFAULT FALSE,             -- Default barcode to print on price label
    
    -- Dynamic Industry Attributes (Weights, Purity, Room No, Expiry, Batch)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints: barcode should be unique per tenant / product scope
    CONSTRAINT uq_product_barcodes_code UNIQUE (barcode)
);

-- 2. Performance Indexes for instant scanner resolution (<5ms)
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON public.product_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_serial ON public.product_barcodes(serial_number);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_id ON public.product_barcodes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_variant_id ON public.product_barcodes(product_variant_combination_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_status ON public.product_barcodes(item_status);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_metadata ON public.product_barcodes USING gin(metadata);

-- 3. Row Level Security (RLS)
ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DO $$
BEGIN
    DROP POLICY IF EXISTS "Anyone can view barcodes for active products" ON public.product_barcodes;
    DROP POLICY IF EXISTS "Sellers can manage barcodes for their own products" ON public.product_barcodes;
END $$;

-- Anyone (including guests/cashiers) can read barcodes for active products
CREATE POLICY "Anyone can view barcodes for active products" ON public.product_barcodes
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.products p 
        WHERE p.id = product_barcodes.product_id 
        AND p.is_active = true
    )
);

-- Sellers can insert, update, delete barcodes for their own products
CREATE POLICY "Sellers can manage barcodes for their own products" ON public.product_barcodes
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.products p 
        WHERE p.id = product_barcodes.product_id 
        AND (
            p.user_id = auth.uid() 
            OR p.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.products p 
        WHERE p.id = product_barcodes.product_id 
        AND (
            p.user_id = auth.uid() 
            OR p.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
        )
    )
);

-- Grant schema and table permissions to anon & authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_barcodes TO anon, authenticated, service_role;

-- 4. Function: Smart Barcode Lookup for Scanner (Grocery, Cloth, Jewelry, Hotel)
CREATE OR REPLACE FUNCTION public.smart_scan_barcode(p_barcode TEXT)
RETURNS TABLE (
    barcode_id UUID,
    barcode TEXT,
    barcode_type TEXT,
    serial_number TEXT,
    packaging_unit TEXT,
    multiplier INT,
    item_status TEXT,
    metadata JSONB,
    product_id UUID,
    product_name VARCHAR(255),
    seller_id UUID,
    category_id UUID,
    variant_id UUID,
    combination_string TEXT,
    sku TEXT,
    unit_price NUMERIC(10, 2),
    current_stock INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pb.id AS barcode_id,
        pb.barcode,
        pb.barcode_type,
        pb.serial_number,
        pb.packaging_unit,
        pb.multiplier,
        pb.item_status,
        pb.metadata,
        p.id AS product_id,
        p.product_name,
        p.user_id AS seller_id,
        p.category_id,
        pvc.id AS variant_id,
        pvc.combination_string,
        pvc.sku,
        COALESCE(pvc.price, p.amount) AS unit_price,
        pvc.quantity AS current_stock
    FROM public.product_barcodes pb
    JOIN public.products p ON pb.product_id = p.id
    LEFT JOIN public.product_variant_combinations pvc ON pb.product_variant_combination_id = pvc.id
    WHERE pb.barcode = TRIM(p_barcode) 
       OR pb.serial_number = TRIM(p_barcode);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function: Stock Update via Barcode Scanner
-- Automatically multiplies quantity (e.g. scanning a 24-can box increases inventory by 24)
-- Also updates inventory_history and handles serialized jewelry/assets
CREATE OR REPLACE FUNCTION public.adjust_inventory_by_barcode(
    p_barcode TEXT,
    p_action TEXT, -- 'restock', 'sale', 'manual_adjustment', 'sold_serialized'
    p_quantity_scanned INT DEFAULT 1,
    p_notes TEXT DEFAULT NULL,
    p_order_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_barcode_record RECORD;
    v_total_units_delta INT;
    v_current_stock INT;
    v_new_stock INT;
    v_change_type inventory_change_type;
BEGIN
    -- 1. Find the barcode entry
    SELECT 
        pb.id AS barcode_id,
        pb.product_id,
        pb.product_variant_combination_id,
        pb.multiplier,
        pb.item_status,
        pb.serial_number,
        pvc.quantity AS variant_quantity
    INTO v_barcode_record
    FROM public.product_barcodes pb
    LEFT JOIN public.product_variant_combinations pvc ON pb.product_variant_combination_id = pvc.id
    WHERE pb.barcode = TRIM(p_barcode) OR pb.serial_number = TRIM(p_barcode)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Barcode not found');
    END IF;

    -- Calculate total base units (Quantity Scanned * Barcode Multiplier)
    v_total_units_delta := p_quantity_scanned * COALESCE(v_barcode_record.multiplier, 1);

    -- If this is a serialized single piece (Jewelry / Hotel Asset)
    IF v_barcode_record.serial_number IS NOT NULL AND p_action = 'sold_serialized' THEN
        UPDATE public.product_barcodes
        SET item_status = 'sold', updated_at = NOW()
        WHERE id = v_barcode_record.barcode_id;
    END IF;

    -- Update inventory if linked to a variant combination
    IF v_barcode_record.product_variant_combination_id IS NOT NULL THEN
        v_current_stock := COALESCE(v_barcode_record.variant_quantity, 0);

        IF p_action = 'restock' THEN
            v_new_stock := v_current_stock + v_total_units_delta;
            v_change_type := 'restock';
        ELSIF p_action = 'sale' OR p_action = 'sold_serialized' THEN
            v_new_stock := v_current_stock - v_total_units_delta;
            v_change_type := 'sale';
        ELSE
            v_new_stock := v_current_stock + v_total_units_delta;
            v_change_type := 'manual_adjustment';
        END IF;

        -- Update variant stock
        UPDATE public.product_variant_combinations
        SET quantity = v_new_stock
        WHERE id = v_barcode_record.product_variant_combination_id;

        -- Log in inventory_history
        INSERT INTO public.inventory_history (
            product_variant_combination_id,
            change_type,
            quantity_change,
            new_quantity,
            order_id,
            notes
        ) VALUES (
            v_barcode_record.product_variant_combination_id,
            v_change_type,
            CASE WHEN p_action IN ('sale', 'sold_serialized') THEN -v_total_units_delta ELSE v_total_units_delta END,
            v_new_stock,
            p_order_id,
            COALESCE(p_notes, 'Scanned Barcode: ' || p_barcode)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'barcode', p_barcode,
        'units_delta', v_total_units_delta,
        'new_stock', v_new_stock
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_product_barcodes_updated_at() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_product_barcodes_updated_at ON public.product_barcodes;
CREATE TRIGGER trigger_product_barcodes_updated_at
BEFORE UPDATE ON public.product_barcodes
FOR EACH ROW EXECUTE FUNCTION public.update_product_barcodes_updated_at();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
