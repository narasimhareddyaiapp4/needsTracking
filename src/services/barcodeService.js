import { supabase } from './supabase';

/**
 * Service to handle Barcode scanning, resolution, and inventory updates
 * across Grocery, Clothing, Jewelry, and Hotel/Hospitality businesses.
 */
export const barcodeService = {
  /**
   * Parse variable-weight barcodes commonly used in Grocery / Supermarkets
   * Standard: EAN-13 starting with '20' to '29' (In-store weighed items)
   * Format: PP IIIII WWWWW C (PP=Prefix, IIIII=Item Code, WWWWW=Weight in grams or price, C=Checksum)
   */
  parseVariableWeightBarcode(barcode) {
    if (!barcode || typeof barcode !== 'string') return null;
    const clean = barcode.trim();
    if (clean.length === 13 && /^(20|21|22|23|24|25|26|27|28|29)/.test(clean)) {
      const itemCode = clean.substring(2, 7);
      const rawValue = parseInt(clean.substring(7, 12), 10);
      const weightKg = rawValue / 1000.0;
      return {
        isVariableWeight: true,
        itemCode,
        weightKg,
      };
    }
    return null;
  },

  /**
   * Look up a scanned barcode or serial number.
   * Calls the database RPC 'smart_scan_barcode'.
   */
  async scanBarcode(scannedCode) {
    try {
      if (!scannedCode) return { success: false, message: 'Invalid barcode' };
      const code = scannedCode.trim();

      // 1. Call high-performance RPC function
      const { data, error } = await supabase.rpc('smart_scan_barcode', {
        p_barcode: code,
      });

      if (error) {
        console.warn('RPC smart_scan_barcode error, attempting fallback query:', error.message);
        // Fallback direct query if RPC isn't deployed yet
        return await this.fallbackScanQuery(code);
      }

      if (!data || data.length === 0) {
        // Check if it's a grocery variable weight barcode
        const variable = this.parseVariableWeightBarcode(code);
        if (variable) {
          return await this.fallbackScanQuery(variable.itemCode, variable);
        }
        return { success: false, notFound: true, message: 'Barcode not found', barcode: code };
      }

      const item = data[0];
      return {
        success: true,
        item: {
          barcodeId: item.barcode_id,
          barcode: item.barcode,
          barcodeType: item.barcode_type,
          serialNumber: item.serial_number,
          packagingUnit: item.packaging_unit,
          multiplier: item.multiplier || 1,
          itemStatus: item.item_status,
          metadata: item.metadata || {},
          productId: item.product_id,
          productName: item.product_name,
          sellerId: item.seller_id,
          categoryId: item.category_id,
          variantId: item.variant_id,
          combinationString: item.combination_string,
          sku: item.sku,
          unitPrice: parseFloat(item.unit_price) || 0,
          currentStock: item.current_stock ?? 0,
        },
      };
    } catch (err) {
      console.error('Error scanning barcode:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Fallback direct select query
   */
  async fallbackScanQuery(code, variableWeight = null) {
    try {
      const { data, error } = await supabase
        .from('product_barcodes')
        .select(`
          id,
          barcode,
          barcode_type,
          serial_number,
          packaging_unit,
          multiplier,
          item_status,
          metadata,
          products (
            id,
            product_name,
            amount,
            user_id
          ),
          product_variant_combinations (
            id,
            combination_string,
            price,
            quantity,
            sku
          )
        `)
        .or(`barcode.eq.${code},serial_number.eq.${code}`)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) {
        return { success: false, notFound: true, message: 'Barcode not found', barcode: code };
      }

      const rec = data[0];
      const prod = rec.products || {};
      const combo = rec.product_variant_combinations || {};

      return {
        success: true,
        item: {
          barcodeId: rec.id,
          barcode: rec.barcode,
          barcodeType: rec.barcode_type,
          serialNumber: rec.serial_number,
          packagingUnit: rec.packaging_unit,
          multiplier: rec.multiplier || 1,
          itemStatus: rec.item_status,
          metadata: rec.metadata || {},
          productId: prod.id,
          productName: prod.product_name,
          sellerId: prod.user_id,
          variantId: combo.id,
          combinationString: combo.combination_string,
          sku: combo.sku,
          unitPrice: combo.price ?? prod.amount ?? 0,
          currentStock: combo.quantity ?? 0,
          variableWeight,
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Adjust inventory using a barcode scan (Stock In / POS Sale / Serialized Item Sold)
   */
  async adjustInventory({ barcode, action = 'restock', quantity = 1, notes = '', orderId = null }) {
    try {
      const { data, error } = await supabase.rpc('adjust_inventory_by_barcode', {
        p_barcode: barcode.trim(),
        p_action: action,
        p_quantity_scanned: quantity,
        p_notes: notes || null,
        p_order_id: orderId || null,
      });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('adjustInventory error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Assign or update a barcode for a product / variant combination
   */
  async assignBarcode({
    productId,
    variantId = null,
    barcode,
    barcodeType = 'CODE128',
    packagingUnit = 'piece',
    multiplier = 1,
    serialNumber = null,
    itemStatus = 'in_stock',
    metadata = {},
    isPrimary = false,
  }) {
    try {
      const payload = {
        product_id: productId,
        product_variant_combination_id: variantId || null,
        barcode: barcode.trim(),
        barcode_type: barcodeType,
        packaging_unit: packagingUnit,
        multiplier: parseInt(multiplier, 10) || 1,
        serial_number: serialNumber ? serialNumber.trim() : null,
        item_status: itemStatus,
        metadata: metadata || {},
        is_primary: isPrimary,
      };

      const { data, error } = await supabase
        .from('product_barcodes')
        .upsert(payload, { onConflict: 'barcode' })
        .select()
        .single();

      if (error) throw error;
      return { success: true, barcode: data };
    } catch (err) {
      console.error('assignBarcode error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Get all barcodes for a specific product or variant combination
   */
  async getBarcodesForProduct(productId, variantId = null) {
    try {
      let query = supabase
        .from('product_barcodes')
        .select('*')
        .eq('product_id', productId);

      if (variantId) {
        query = query.eq('product_variant_combination_id', variantId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return { success: true, barcodes: data || [] };
    } catch (err) {
      return { success: false, error: err.message, barcodes: [] };
    }
  },

  /**
   * Delete a barcode
   */
  async deleteBarcode(barcodeId) {
    try {
      const { error } = await supabase
        .from('product_barcodes')
        .delete()
        .eq('id', barcodeId);

      if (error) throw error;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

export default barcodeService;
