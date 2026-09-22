// src/services/printerService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import * as Print from 'expo-print';
import QRCode from 'qrcode';
import { supabase } from './supabase';
import { announceOrderPrint } from './speechService';
export { announceOrderPrint };

const PRINTER_STORAGE_KEY = '@printer_config_v1';

// Default printer configuration
export const DEFAULT_PRINTER_CONFIG = {
  printerName: '',
  printerAddress: '',
  paperWidth: '58mm', // '58mm' (32 chars) or '80mm' (48 chars)
  currencySymbol: 'Rs.', // 'Rs.' (recommended for POS thermal printers) | '₹' | 'INR'
  storeName: "LocalWala's",
  storeAddress: '',
  storeContact: '',
  gstNumber: '',
  footerNote: 'Thank You! Visit Again.',
  autoPrintOnOrder: false,
  printMode: 'bluetooth', // 'bluetooth' | 'system'
  bottomFeedLines: 1, // Compact feed after printing (eliminates 2-inch wasted blank space)
  cutPaper: true,
  printHeader: true, // Option to check/uncheck header part (store name, address, tax invoice title)
  printDayWiseNumber: true, // Option to check/require Day-wise order number on receipts
  enableTax: false, // Option to enable/disable CGST + SGST tax on billing & receipts
  cgstRate: 2.5, // Central GST percentage e.g. 2.5%
  sgstRate: 2.5, // State GST percentage e.g. 2.5%
  enableServiceCost: false, // Option to enable/disable service charge on billing & receipts
  serviceCostRate: 0, // Service cost percentage e.g. 5%
  printTaxBreakdown: true, // Option to print CGST, SGST, Service Cost itemized rows on receipt
  printDynamicQr: true, // Option to print dynamic UPI QR code with exact order price on receipt
};

// Global active Web Bluetooth BLE device/characteristic instance
let activeBleDevice = null;
let activeCharacteristic = null;

/**
 * Fetch saved printer configuration from local storage.
 */
export const getPrinterConfig = async () => {
  try {
    const raw = await AsyncStorage.getItem(PRINTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_PRINTER_CONFIG,
        ...parsed,
        currencySymbol: parsed.currencySymbol || 'Rs.',
        bottomFeedLines: parsed.bottomFeedLines !== undefined ? Number(parsed.bottomFeedLines) : 1,
        printHeader: parsed.printHeader !== undefined ? Boolean(parsed.printHeader) : true,
        printDayWiseNumber: parsed.printDayWiseNumber !== undefined ? Boolean(parsed.printDayWiseNumber) : true,
        enableTax: parsed.enableTax !== undefined ? Boolean(parsed.enableTax) : false,
        cgstRate: parsed.cgstRate !== undefined ? Number(parsed.cgstRate) : 2.5,
        sgstRate: parsed.sgstRate !== undefined ? Number(parsed.sgstRate) : 2.5,
        enableServiceCost: parsed.enableServiceCost !== undefined ? Boolean(parsed.enableServiceCost) : false,
        serviceCostRate: parsed.serviceCostRate !== undefined ? Number(parsed.serviceCostRate) : 0,
        printTaxBreakdown: parsed.printTaxBreakdown !== undefined ? Boolean(parsed.printTaxBreakdown) : true,
        printDynamicQr: parsed.printDynamicQr !== undefined ? Boolean(parsed.printDynamicQr) : true,
      };
    }
  } catch (err) {
    console.warn('[PrinterService] Failed to load printer config:', err);
  }
  return DEFAULT_PRINTER_CONFIG;
};

/**
 * Save printer configuration to local storage.
 */
export const savePrinterConfig = async (config) => {
  try {
    const merged = { ...DEFAULT_PRINTER_CONFIG, ...config };
    await AsyncStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (err) {
    console.error('[PrinterService] Failed to save printer config:', err);
    throw err;
  }
};

/**
 * Helper to get maximum line characters based on paper size.
 */
export const getLineCharWidth = (paperWidth = '58mm') => {
  return paperWidth === '80mm' ? 48 : 32;
};

/**
 * Safely parses any number, numeric string (with commas or symbols), or fallback.
 */
export const safeParseNumber = (val, defaultVal = 0) => {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'number') return isNaN(val) || !isFinite(val) ? defaultVal : val;
  const cleaned = String(val).replace(/[^0-9.-]+/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || !isFinite(parsed) ? defaultVal : parsed;
};

/**
 * Safely formats price with 2 decimal places and currency prefix.
 */
export const safeFormatPrice = (val, currency = 'Rs.') => {
  const num = safeParseNumber(val, 0);
  const prefix = currency ? `${currency}` : '';
  return `${prefix}${num.toFixed(2)}`;
};

/**
 * Safely formats numeric value to fixed 2-decimal string.
 */
export const safeFormatNumber = (val, decimals = 2) => {
  const num = safeParseNumber(val, 0);
  return num.toFixed(decimals);
};

/**
 * Escapes special HTML characters to prevent XSS or broken receipt rendering.
 */
export const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Sanitizes text specifically for ESC/POS thermal receipt printers.
 * Thermal POS printers use 8-bit ASCII / Code Pages (PC437) and do not support Unicode ₹ (U+20B9).
 * Multi-byte UTF-8 ₹ (0xE2 0x82 0xB9) causes Chinese-mode firmware to print Chinese glyphs
 * and consume the following price digits. This sanitizer guarantees strictly 7-bit clean ASCII.
 */
export const sanitizeThermalText = (text, currencySymbol = 'Rs.') => {
  if (!text) return '';
  const safeCurrency = (!currencySymbol || currencySymbol === '₹') ? 'Rs.' : currencySymbol;
  let str = String(text)
    .replace(/\u20B9/g, safeCurrency)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return str.replace(/[^\x20-\x7E\n\r\t]/g, '');
};

/**
 * Formats a two-column line (Left text, Right text) padded with spaces to fill the paper width.
 */
export const formatTwoColumns = (leftText, rightText, totalWidth = 32) => {
  const left = sanitizeThermalText(String(leftText || '').trim());
  let right = sanitizeThermalText(String(rightText || '').trim());
  if (right.length >= totalWidth) {
    return right.substring(0, totalWidth);
  }
  const spaceNeeded = totalWidth - left.length - right.length;
  if (spaceNeeded <= 0) {
    const maxLeft = Math.max(1, totalWidth - right.length - 1);
    return left.substring(0, maxLeft) + ' ' + right;
  }
  return left + ' '.repeat(spaceNeeded) + right;
};

/**
 * Formats an item row cleanly for 58mm (32 cols) or 80mm (48 cols) thermal paper.
 * Prevents line wrapping, handles multi-quantity orders with unit rate and line total,
 * and ensures all numbers are ASCII formatted without swallowing digits.
 */
export const formatItemRow = (name, qty, price, totalWidth = 32, currencySymbol = 'Rs.', total = null) => {
  const safeCurrency = (!currencySymbol || currencySymbol === '₹') ? 'Rs.' : currencySymbol;
  const cleanName = sanitizeThermalText(String(name || 'Item').trim(), safeCurrency);
  const quantity = safeParseNumber(qty, 1);
  const unitRate = safeParseNumber(price, 0);
  const lineTotal = total !== null && total !== undefined ? safeParseNumber(total, 0) : quantity * unitRate;
  const totalStr = `${safeCurrency}${lineTotal.toFixed(2)}`;

  if (totalWidth >= 48) {
    // 80mm format: 4 columns [ITEM (22), QTY (4), RATE (10), AMOUNT (12)] = 48 chars
    const nameColWidth = totalWidth - 4 - 10 - 12;
    const qtyCol = String(quantity).padStart(4, ' ');
    const rateCol = unitRate.toFixed(2).padStart(10, ' ');
    const totalCol = totalStr.padStart(12, ' ');

    if (cleanName.length <= nameColWidth) {
      const nameCol = cleanName.padEnd(nameColWidth, ' ');
      return nameCol + qtyCol + rateCol + totalCol;
    } else {
      const line1 = cleanName;
      const line2 = ' '.repeat(nameColWidth) + qtyCol + rateCol + totalCol;
      return line1 + '\n' + line2;
    }
  }

  // 58mm format (32 chars)
  if (quantity === 1) {
    const spaceForName = totalWidth - totalStr.length - 1;
    if (cleanName.length <= spaceForName) {
      const pad = totalWidth - cleanName.length - totalStr.length;
      return cleanName + ' '.repeat(Math.max(1, pad)) + totalStr;
    } else {
      return cleanName + '\n' + ' '.repeat(totalWidth - totalStr.length) + totalStr;
    }
  } else {
    // Multi-quantity on 58mm:
    // Line 1: Item Name
    // Line 2: "  2 x 50.00          Rs.100.00"
    const qtyRateStr = `  ${quantity} x ${unitRate.toFixed(2)}`;
    const spaceNeeded = totalWidth - qtyRateStr.length - totalStr.length;
    const line2 = qtyRateStr + ' '.repeat(Math.max(1, spaceNeeded)) + totalStr;
    return cleanName + '\n' + line2;
  }
};

/**
 * Helper to parse full order number and day-wise order number from order data.
 */
export const extractOrderNumbers = (order = {}) => {
  if (!order || typeof order !== 'object') {
    return { orderNumber: 'N/A', dayOrderNo: null };
  }

  const rawId = order.id || order.order_id || order.orderId || '';
  const orderNum =
    order.order_number ||
    order.orderNumber ||
    order.order_no ||
    (rawId ? String(rawId).substring(0, 8).toUpperCase() : 'N/A');

  let dayOrderNo =
    order.daily_order_number ||
    order.day_wise_order_number ||
    order.day_order_no ||
    order.daily_order_no ||
    order.dayOrderNo ||
    order.dailyOrderNumber ||
    order.day_order_number ||
    order.token_no ||
    order.token_number ||
    order.token ||
    null;

  // If dayOrderNo is not explicitly set, try extracting from order_number
  // Examples: '20260829-0001', 'ORD-20260829-0042', '20260829_0012', '#0005', '0005'
  if (!dayOrderNo && orderNum && typeof orderNum === 'string') {
    const suffixMatch = orderNum.match(/[-_](\d+)$/);
    if (suffixMatch && suffixMatch[1]) {
      dayOrderNo = suffixMatch[1];
    } else if (/^\d{1,6}$/.test(orderNum.trim())) {
      dayOrderNo = orderNum.trim();
    } else if (/^#\d{1,6}$/.test(orderNum.trim())) {
      dayOrderNo = orderNum.trim().replace(/^#/, '');
    }
  }

  // If dayOrderNo is still not resolved, derive a clean numeric token from order ID or sequence
  if (!dayOrderNo) {
    if (rawId && typeof rawId === 'string') {
      const digits = rawId.replace(/\D/g, '');
      if (digits.length >= 2) {
        dayOrderNo = String(parseInt(digits.slice(-4), 10) || digits.slice(-3) || '1');
      } else {
        dayOrderNo = String(rawId.slice(-4).toUpperCase());
      }
    } else {
      dayOrderNo = '1';
    }
  }

  // Extract 6-digit unique payment transaction reference if available
  let paymentReference = order.payment_reference || null;
  if (!paymentReference && order.shipping_address) {
    let shipping = order.shipping_address;
    if (typeof shipping === 'string') {
      try {
        shipping = JSON.parse(shipping);
      } catch (_) {}
    }
    if (typeof shipping === 'object' && shipping !== null) {
      paymentReference = shipping.payment_reference || shipping.billing?.payment_reference || null;
      if (!paymentReference && shipping.payment_note) {
        const match = String(shipping.payment_note).match(/\b(\d{6})\b/);
        if (match) paymentReference = match[1];
      }
    }
  }

  return {
    orderNumber: String(orderNum),
    dayOrderNo: dayOrderNo ? String(dayOrderNo) : null,
    paymentReference: paymentReference ? String(paymentReference) : null,
  };
};

/**
 * Creates dashed separator line according to paper width.
 */
export const getSeparator = (totalWidth = 32) => {
  return '-'.repeat(totalWidth);
};

/**
 * Generates raw ESC/POS command bytes for 58mm / 80mm thermal receipt printers.
 */
export const generateEscPosBytes = (data, config = DEFAULT_PRINTER_CONFIG) => {
  const width = getLineCharWidth(config.paperWidth);
  const separator = getSeparator(width);
  // ESC/POS must strictly use ASCII currency 'Rs.' or 'Rs ' to prevent Chinese glyph corruption on thermal hardware
  const currencySymbol = (config.currencySymbol && config.currencySymbol !== '₹') ? config.currencySymbol : 'Rs.';
  const encoder = new TextEncoder();

  // ESC/POS Commands
  const ESC = 0x1b;
  const FS = 0x1c;
  const GS = 0x1d;

  const CMD_INIT = [ESC, 0x40]; // Initialize printer
  const CMD_CANCEL_KANJI = [FS, 0x2e]; // FS . (Cancel Chinese/Kanji character mode - prevents Chinese glyphs)
  const CMD_CODEPAGE_PC437 = [ESC, 0x74, 0x00]; // ESC t 0 (Select Code page 0: PC437 Standard USA)
  const CMD_CHARSET_USA = [ESC, 0x52, 0x00]; // ESC R 0 (USA Character Set)

  const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
  const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
  const CMD_ALIGN_RIGHT = [ESC, 0x61, 0x02];
  const CMD_BOLD_ON = [ESC, 0x45, 0x01];
  const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
  const CMD_DOUBLE_SIZE = [GS, 0x21, 0x11]; // Double height & width
  const CMD_DOUBLE_HEIGHT = [GS, 0x21, 0x01]; // Double height only (preserves full 32/48 col line width)
  const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];
  const CMD_FEED_AND_CUT = [ESC, 0x64, 0x01, GS, 0x56, 0x42, 0x00]; // Feed 1 line and partial cut

  let byteChunks = [];

  const addBytes = (bytes) => {
    byteChunks.push(new Uint8Array(bytes));
  };

  const addText = (text) => {
    const clean = sanitizeThermalText(text, currencySymbol);
    byteChunks.push(encoder.encode(clean + '\n'));
  };

  // 1. Initialize and cancel Chinese character mode
  addBytes(CMD_INIT);
  addBytes(CMD_CANCEL_KANJI);
  addBytes(CMD_CODEPAGE_PC437);
  addBytes(CMD_CHARSET_USA);

  // 2. Header (Centered, Bold) - only if printHeader is enabled (checked)
  if (config.printHeader !== false) {
    addBytes(CMD_ALIGN_CENTER);
    addBytes(CMD_BOLD_ON);
    const store = sanitizeThermalText(data.storeName || config.storeName || "RECEIPT", currencySymbol);
    if (store.length <= Math.floor(width / 2)) {
      addBytes(CMD_DOUBLE_SIZE);
    } else {
      addBytes(CMD_DOUBLE_HEIGHT);
    }
    addText(store);
    addBytes(CMD_NORMAL_SIZE);
    addBytes(CMD_BOLD_OFF);

    if (config.storeAddress) {
      addText(config.storeAddress);
    }
    if (config.storeContact) {
      addText(`Tel: ${config.storeContact}`);
    }
    if (config.gstNumber) {
      addText(`GSTIN: ${config.gstNumber}`);
    }

    // 3. Receipt Title & Info
    addText(separator);
    addBytes(CMD_BOLD_ON);
    addText(data.title || 'TAX INVOICE / ORDER RECEIPT');
    addBytes(CMD_BOLD_OFF);
    addText(separator);
  }

  // 4. Token / Day Order Number (Prominent banner for counter/kitchen)
  const dayOrder = data.dayOrderNo || data.dailyOrderNumber || data.dayWiseOrderNo;
  if (config.printDayWiseNumber !== false && dayOrder) {
    addBytes(CMD_ALIGN_CENTER);
    addBytes(CMD_BOLD_ON);
    addText(`*** DAY ORDER NO: #${String(dayOrder).replace(/^#/, '')} ***`);
    addBytes(CMD_BOLD_OFF);
    addText(separator);
  }

  // Order Meta
  addBytes(CMD_ALIGN_LEFT);

  if (data.orderId || data.rawOrderId) {
    const orderNoStr = String(data.orderId || data.rawOrderId);
    if (orderNoStr.length > 20) {
      addText('Order No:');
      addText(`  ${orderNoStr}`);
    } else {
      addText(formatTwoColumns('Order No:', orderNoStr, width));
    }
  }
  if (config.printDayWiseNumber !== false && dayOrder) {
    addText(formatTwoColumns('Day Order No:', `#${String(dayOrder).replace(/^#/, '')}`, width));
  }
  if (data.date) {
    addText(formatTwoColumns('Date:', String(data.date), width));
  }
  if (data.customerName) {
    addText(formatTwoColumns(`Customer: ${data.customerName}`, '', width));
  }
  if (data.customerPhone) {
    addText(formatTwoColumns('Phone:', String(data.customerPhone), width));
  }
  if (data.orderType) {
    addText(formatTwoColumns('Type:', String(data.orderType).toUpperCase(), width));
  }
  if (data.tableNo) {
    addText(formatTwoColumns('Table:', `#${data.tableNo}`, width));
  }
  if (data.deliveryAddress) {
    addText(`Address: ${data.deliveryAddress.substring(0, width * 2)}`);
  }

  // 5. Items Header
  addText(separator);
  addBytes(CMD_BOLD_ON);
  if (width >= 48) {
    const nameHdr = 'ITEM'.padEnd(width - 4 - 10 - 12, ' ');
    addText(nameHdr + ' QTY      RATE      AMOUNT');
  } else {
    addText(formatTwoColumns('ITEM', 'QTY  PRICE', width));
  }
  addBytes(CMD_BOLD_OFF);
  addText(separator);

  // 6. Items List
  if (data.items && Array.isArray(data.items) && data.items.length > 0) {
    data.items.forEach((item) => {
      const name = item.name || 'Item';
      const qty = item.quantity || 1;
      const price = item.price || 0;
      const total = item.total !== undefined ? item.total : (qty * price);
      const rowText = formatItemRow(name, qty, price, width, currencySymbol, total);
      addText(rowText);
    });
  } else {
    addText(formatTwoColumns('(No itemized list)', '', width));
  }

  // 7. Totals & Summary
  const rawTotal =
    data.total !== undefined && data.total !== null && String(data.total).trim() !== ''
      ? data.total
      : data.total_amount !== undefined && data.total_amount !== null && String(data.total_amount).trim() !== ''
      ? data.total_amount
      : data.amount !== undefined && data.amount !== null && String(data.amount).trim() !== ''
      ? data.amount
      : null;

  const cgstAmount = safeParseNumber(data.cgstAmount, 0);
  const sgstAmount = safeParseNumber(data.sgstAmount, 0);
  const serviceCost = safeParseNumber(data.serviceCost, 0);
  const cgstRate = data.cgstRate !== undefined ? data.cgstRate : (config.cgstRate || 2.5);
  const sgstRate = data.sgstRate !== undefined ? data.sgstRate : (config.sgstRate || 2.5);
  const serviceCostRate = data.serviceCostRate !== undefined ? data.serviceCostRate : (config.serviceCostRate || 0);

  const hasTaxesOrCharges = (config.printTaxBreakdown !== false) && (cgstAmount > 0 || sgstAmount > 0 || serviceCost > 0);

  const expectedTotalWithTaxes =
    safeParseNumber(data.subtotal, 0) +
    safeParseNumber(data.deliveryFee, 0) -
    safeParseNumber(data.discount, 0) +
    cgstAmount +
    sgstAmount +
    serviceCost;

  const parsedRawTotal = rawTotal !== null && rawTotal !== undefined ? safeParseNumber(rawTotal, -1) : -1;
  const computedTotal =
    parsedRawTotal >= (expectedTotalWithTaxes - 0.05) && parsedRawTotal > 0
      ? parsedRawTotal
      : expectedTotalWithTaxes > 0
      ? expectedTotalWithTaxes
      : data.items && Array.isArray(data.items) && data.items.length > 0
      ? data.items.reduce((sum, it) => sum + safeParseNumber(it.total !== undefined ? it.total : (it.quantity * it.price), 0), 0) + cgstAmount + sgstAmount + serviceCost
      : (parsedRawTotal > 0 ? parsedRawTotal : 0);

  const hasMetaTotals =
    (data.subtotal !== undefined && safeParseNumber(data.subtotal, 0) > 0) ||
    (data.deliveryFee && safeParseNumber(data.deliveryFee) > 0) ||
    (data.discount && safeParseNumber(data.discount) > 0) ||
    hasTaxesOrCharges;

  addText(separator);
  if (hasMetaTotals) {
    if (data.subtotal !== undefined && safeParseNumber(data.subtotal, 0) > 0) {
      addText(formatTwoColumns('Subtotal:', safeFormatPrice(data.subtotal, currencySymbol), width));
    }
    if (config.printTaxBreakdown !== false) {
      if (cgstAmount > 0) {
        addText(formatTwoColumns(`CGST (${cgstRate}%):`, safeFormatPrice(cgstAmount, currencySymbol), width));
      }
      if (sgstAmount > 0) {
        addText(formatTwoColumns(`SGST (${sgstRate}%):`, safeFormatPrice(sgstAmount, currencySymbol), width));
      }
      if (serviceCost > 0) {
        addText(formatTwoColumns(`Service Charge (${serviceCostRate}%):`, safeFormatPrice(serviceCost, currencySymbol), width));
      }
    }
    if (data.deliveryFee && safeParseNumber(data.deliveryFee) > 0) {
      addText(formatTwoColumns('Delivery Fee:', safeFormatPrice(data.deliveryFee, currencySymbol), width));
    }
    if (data.discount && safeParseNumber(data.discount) > 0) {
      addText(formatTwoColumns('Discount:', `-${safeFormatPrice(data.discount, currencySymbol)}`, width));
    }
    addText(separator);
  }

  // TOTAL Line in standard universal BOLD (100% supported on all thermal printers, never dropped)
  addBytes(CMD_BOLD_ON);
  addText(formatTwoColumns('TOTAL AMOUNT:', safeFormatPrice(computedTotal, currencySymbol), width));
  addBytes(CMD_BOLD_OFF);
  addText(separator);

  if (data.paymentMethod) {
    addText(formatTwoColumns('Payment Mode:', String(data.paymentMethod).toUpperCase(), width));
  }
  if (data.paymentReference) {
    addText(formatTwoColumns('UPI/Pay Ref:', String(data.paymentReference), width));
  }
  if (data.paymentStatus) {
    addText(formatTwoColumns('Payment Status:', String(data.paymentStatus).toUpperCase(), width));
  }

  // Dynamic Payment QR Code on Receipt (Configurable by seller profile & printer settings)
  if (data.shouldPrintQr !== false && config.printDynamicQr !== false && data.dynamicQrText) {
    addBytes(CMD_ALIGN_CENTER);
    addText(separator);
    addBytes(CMD_BOLD_ON);
    addText(`SCAN & PAY: ${currencySymbol}${safeFormatPrice(computedTotal, '')}`);
    addBytes(CMD_BOLD_OFF);

    try {
      const qrData = data.dynamicQrText;
      const storeLen = qrData.length + 3;
      const pL = storeLen % 256;
      const pH = Math.floor(storeLen / 256);

      // Model 2
      addBytes([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
      // Module size (4 for 58mm, 6 for 80mm)
      const qrSize = config.paperWidth === '80mm' ? 6 : 4;
      addBytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, qrSize]);
      // Error correction Level M
      addBytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
      // Store data
      const storeHeader = [GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30];
      const qrBytes = encoder.encode(qrData);
      const fullStoreCmd = new Uint8Array(storeHeader.length + qrBytes.length);
      fullStoreCmd.set(storeHeader, 0);
      fullStoreCmd.set(qrBytes, storeHeader.length);
      addBytes(fullStoreCmd);
      // Print QR
      addBytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    } catch (_) {}

    if (data.sellerUpiId) {
      addText(`UPI: ${data.sellerUpiId}`);
    }
    addText('Pay via GPay / PhonePe / Paytm');
  }

  // 8. Footer
  addBytes(CMD_ALIGN_CENTER);
  addText(separator);
  if (config.footerNote) {
    addText(config.footerNote);
  }
  addText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  // 9. Minimal bottom paper feed & cut (eliminates the unwanted 2-inch blank space)
  const feedLines = typeof config.bottomFeedLines === 'number'
    ? Math.max(0, Math.min(10, config.bottomFeedLines))
    : 1;

  if (feedLines > 0) {
    addBytes([ESC, 0x64, feedLines]); // ESC d n: Print and feed n lines
  }

  if (config.cutPaper !== false) {
    addBytes([GS, 0x56, 0x42, 0x00]); // GS V 'B' 0: Feed to cutter position and partial cut
  }

  // Combine all Uint8Array chunks into a single ArrayBuffer
  const totalLength = byteChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const finalBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of byteChunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return finalBuffer;
};

/**
 * Generates an HTML representation styled specifically for 58mm / 80mm thermal receipt printing.
 */
export const generateReceiptHtml = (data, config = DEFAULT_PRINTER_CONFIG) => {
  const is80mm = config.paperWidth === '80mm';
  const widthMm = is80mm ? '72mm' : '48mm';
  const currencySymbol = config.currencySymbol || 'Rs.';
  const shouldPrintHeader = config.printHeader !== false;

  const rawTotal =
    data.total !== undefined && data.total !== null && String(data.total).trim() !== ''
      ? data.total
      : data.total_amount !== undefined && data.total_amount !== null && String(data.total_amount).trim() !== ''
      ? data.total_amount
      : data.amount !== undefined && data.amount !== null && String(data.amount).trim() !== ''
      ? data.amount
      : null;

  const cgstAmount = safeParseNumber(data.cgstAmount, 0);
  const sgstAmount = safeParseNumber(data.sgstAmount, 0);
  const serviceCost = safeParseNumber(data.serviceCost, 0);

  const expectedTotalWithTaxes =
    safeParseNumber(data.subtotal, 0) +
    safeParseNumber(data.deliveryFee, 0) -
    safeParseNumber(data.discount, 0) +
    cgstAmount +
    sgstAmount +
    serviceCost;

  const parsedRawTotal = rawTotal !== null && rawTotal !== undefined ? safeParseNumber(rawTotal, -1) : -1;
  const computedTotal =
    parsedRawTotal >= (expectedTotalWithTaxes - 0.05) && parsedRawTotal > 0
      ? parsedRawTotal
      : expectedTotalWithTaxes > 0
      ? expectedTotalWithTaxes
      : data.items && Array.isArray(data.items) && data.items.length > 0
      ? data.items.reduce((sum, it) => sum + safeParseNumber(it.total !== undefined ? it.total : (it.quantity * it.price), 0), 0) + cgstAmount + sgstAmount + serviceCost
      : (parsedRawTotal > 0 ? parsedRawTotal : 0);

  const dayOrder = data.dayOrderNo || data.dailyOrderNumber || data.dayWiseOrderNo;
  const shouldPrintDayWise = config.printDayWiseNumber !== false && dayOrder;

  const itemsHtml = (data.items && data.items.length > 0)
    ? data.items
        .map(
          (item) => `
          <tr>
            <td style="text-align: left; padding: 4px 0; word-break: break-word; font-size: inherit;">${item.name || 'Item'}</td>
            <td style="text-align: center; padding: 4px 0; font-size: inherit;">x${item.quantity || 1}</td>
            <td style="text-align: right; padding: 4px 0; font-size: inherit;">${currencySymbol}${safeFormatNumber(item.price || 0)}</td>
            <td style="text-align: right; padding: 4px 0; font-size: inherit; font-weight: bold;">${currencySymbol}${safeFormatNumber(item.total !== undefined ? item.total : (item.quantity * item.price))}</td>
          </tr>
        `
        )
        .join('')
    : `
      <tr>
        <td colspan="4" style="text-align: center; padding: 8px 0; color: #666; font-style: italic;">(No itemized list)</td>
      </tr>
    `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          @page {
            size: auto;
            margin: 0mm !important;
          }
          @page :first {
            margin: 0mm !important;
          }
          html, body {
            font-family: 'Courier New', Courier, monospace;
            width: ${widthMm};
            max-width: ${widthMm};
            margin: 0 auto !important;
            padding: 4px 2px 2px 2px !important;
            color: #000;
            background: #fff;
            font-size: ${is80mm ? '13px' : '11px'};
            line-height: 1.35;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @media print {
            @page {
              size: auto;
              margin: 0mm !important;
            }
            html, body {
              width: ${widthMm} !important;
              max-width: ${widthMm} !important;
              margin: 0 auto !important;
              padding: 2px 2px 2px 2px !important;
              overflow: visible !important;
              height: auto !important;
              min-height: 0 !important;
            }
            .receipt-container {
              width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              page-break-after: avoid !important;
              break-after: avoid !important;
            }
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .store-name { font-size: ${is80mm ? '18px' : '15px'}; font-weight: bold; margin-bottom: 3px; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .meta-row { display: flex; justify-content: space-between; margin: 2px 0; font-size: ${is80mm ? '12px' : '10px'}; }
          .day-order-box {
            border: 1.5px dashed #000;
            padding: 3px 2px;
            margin: 4px 0;
            text-align: center;
          }
          .day-order-label {
            font-size: ${is80mm ? '11px' : '9px'};
            font-weight: bold;
            letter-spacing: 0.5px;
          }
          .day-order-val {
            font-size: ${is80mm ? '20px' : '17px'};
            font-weight: 900;
            margin-top: 1px;
          }
          table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: inherit; }
          th { border-bottom: 1px dashed #000; font-weight: bold; padding: 3px 0; font-size: inherit; }
          .total-row { font-size: ${is80mm ? '16px' : '14px'}; font-weight: bold; margin: 5px 0; display: flex; justify-content: space-between; }
          .footer { margin-top: 6px; margin-bottom: 0; padding-bottom: 0; font-size: ${is80mm ? '11px' : '10px'}; }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          ${shouldPrintHeader ? `
          <div class="center">
            <div class="store-name">${data.storeName || config.storeName || "RECEIPT"}</div>
            ${config.storeAddress ? `<div>${config.storeAddress}</div>` : ''}
            ${config.storeContact ? `<div>Tel: ${config.storeContact}</div>` : ''}
            ${config.gstNumber ? `<div>GSTIN: ${config.gstNumber}</div>` : ''}
          </div>

          <div class="divider"></div>
          <div class="center bold">${data.title || 'TAX INVOICE / ORDER RECEIPT'}</div>
          <div class="divider"></div>
          ` : ''}

          ${shouldPrintDayWise ? `
          <div class="day-order-box">
            <div class="day-order-label">DAY ORDER NO</div>
            <div class="day-order-val">#${String(dayOrder).replace(/^#/, '')}</div>
          </div>
          <div class="divider"></div>
          ` : ''}

          <div class="meta-row"><span>Order No:</span><span class="bold">${data.orderId || data.rawOrderId || 'N/A'}</span></div>
          ${shouldPrintDayWise ? `<div class="meta-row"><span>Day Order No:</span><span class="bold">#${String(dayOrder).replace(/^#/,'')}</span></div>` : ''}
          <div class="meta-row"><span>Date:</span><span>${data.date || new Date().toLocaleString()}</span></div>
          ${data.customerName ? `<div class="meta-row"><span>Customer:</span><span class="bold">${data.customerName}</span></div>` : ''}
          ${data.customerPhone ? `<div class="meta-row"><span>Mobile:</span><span>${data.customerPhone}</span></div>` : ''}
          ${data.orderType ? `<div class="meta-row"><span>Type:</span><span class="bold">${String(data.orderType).toUpperCase()}</span></div>` : ''}
          ${data.tableNo ? `<div class="meta-row"><span>Table:</span><span class="bold">#${data.tableNo}</span></div>` : ''}
          ${data.deliveryAddress ? `<div class="meta-row" style="flex-direction:column; margin-top:2px;"><span>Address:</span><span style="font-size:0.9em; word-break:break-word;">${data.deliveryAddress}</span></div>` : ''}

          <div class="divider"></div>
          <table>
            <thead>
              <tr>
                <th style="text-align: left;">ITEM</th>
                <th style="text-align: center;">QTY</th>
                <th style="text-align: right;">RATE</th>
                <th style="text-align: right;">AMT</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="divider"></div>

          ${data.subtotal !== undefined ? `<div class="meta-row"><span>Subtotal:</span><span>${currencySymbol}${safeFormatNumber(data.subtotal)}</span></div>` : ''}
          ${config.printTaxBreakdown !== false && cgstAmount > 0 ? `<div class="meta-row"><span>CGST (${data.cgstRate || config.cgstRate || 2.5}%):</span><span>${currencySymbol}${safeFormatNumber(cgstAmount)}</span></div>` : ''}
          ${config.printTaxBreakdown !== false && sgstAmount > 0 ? `<div class="meta-row"><span>SGST (${data.sgstRate || config.sgstRate || 2.5}%):</span><span>${currencySymbol}${safeFormatNumber(sgstAmount)}</span></div>` : ''}
          ${config.printTaxBreakdown !== false && serviceCost > 0 ? `<div class="meta-row"><span>Service Charge (${data.serviceCostRate || config.serviceCostRate || 0}%):</span><span>${currencySymbol}${safeFormatNumber(serviceCost)}</span></div>` : ''}
          ${data.deliveryFee ? `<div class="meta-row"><span>Delivery:</span><span>${currencySymbol}${safeFormatNumber(data.deliveryFee)}</span></div>` : ''}
          ${data.discount ? `<div class="meta-row"><span>Discount:</span><span>-${currencySymbol}${safeFormatNumber(data.discount)}</span></div>` : ''}

          <div class="divider"></div>
          <div class="total-row">
            <span>TOTAL AMOUNT:</span>
            <span>${currencySymbol}${safeFormatNumber(computedTotal)}</span>
          </div>
          <div class="divider"></div>

          ${data.paymentMethod ? `<div class="meta-row"><span>Payment:</span><span class="bold">${String(data.paymentMethod).toUpperCase()}</span></div>` : ''}
          ${data.paymentReference ? `<div class="meta-row"><span>UPI/Pay Ref:</span><span class="bold">${escapeHtml(data.paymentReference)}</span></div>` : ''}
          ${data.paymentStatus ? `<div class="meta-row"><span>Status:</span><span class="bold">${String(data.paymentStatus).toUpperCase()}</span></div>` : ''}

          ${(data.shouldPrintQr !== false && config.printDynamicQr !== false && (data.dynamicQrUrl || data.dynamicQrText)) ? `
          <div class="divider"></div>
          <div class="center qr-receipt-section" style="margin: 6px 0; text-align: center;">
            <div style="font-weight: 800; font-size: ${is80mm ? '12px' : '10.5px'}; margin-bottom: 4px; letter-spacing: 0.5px;">
              ⚡ SCAN &amp; PAY: ${currencySymbol}${safeFormatNumber(computedTotal)}
            </div>
            <img src="${data.dynamicQrUrl || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=4&data=${encodeURIComponent(data.dynamicQrText)}`}" alt="Payment QR" style="width: ${is80mm ? '140px' : '110px'}; height: ${is80mm ? '140px' : '110px'}; margin: 0 auto; display: block;" />
            ${data.sellerUpiId ? `<div style="font-size: ${is80mm ? '10px' : '8.5px'}; font-weight: bold; margin-top: 3px; color: #111;">UPI: ${escapeHtml(data.sellerUpiId)}</div>` : ''}
            <div style="font-size: ${is80mm ? '9px' : '7.5px'}; color: #555; margin-top: 1px;">Google Pay • PhonePe • Paytm • Any UPI App</div>
          </div>
          ` : ''}

          <div class="center footer">
            <div>${config.footerNote || 'Thank You! Visit Again.'}</div>
            <div style="margin-top: 3px; color: #555;">${new Date().toLocaleTimeString()}</div>
          </div>
        </div>
      </body>
    </html>
  `;
};

/**
 * Request Web Bluetooth pairing (for Chrome on Android/Desktop/Web).
 */
export const scanAndConnectWebBluetooth = async () => {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    throw new Error('Web Bluetooth API is only available in Chrome / supported browsers on Android and PC.');
  }

  // Standard thermal receipt printer BLE service UUIDs
  const PRINTER_SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb', // Standard POS BLE
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ffe0-0000-1000-8000-00805f9b34fb', // Generic serial/BLE printer
  ];

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES,
    });

    const server = await device.gatt.connect();
    activeBleDevice = device;

    // Find write characteristic
    let matchedCharacteristic = null;
    for (const serviceUuid of PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            matchedCharacteristic = char;
            break;
          }
        }
        if (matchedCharacteristic) break;
      } catch (err) {
        // service not found on this device, check next
      }
    }

    activeCharacteristic = matchedCharacteristic;

    // Save connected device details
    const currentConfig = await getPrinterConfig();
    const updated = await savePrinterConfig({
      ...currentConfig,
      printerName: device.name || 'Bluetooth POS Printer',
      printerAddress: device.id || 'WebBLE-Device',
      printMode: 'bluetooth',
    });

    return {
      success: true,
      deviceName: device.name || 'Bluetooth Printer',
      config: updated,
    };
  } catch (err) {
    console.error('[PrinterService] Web Bluetooth connection error:', err);
    throw err;
  }
};

/**
 * Send raw ESC/POS bytes to active Web Bluetooth characteristic in chunks.
 */
const sendBytesViaWebBluetooth = async (uint8Bytes) => {
  if (!activeCharacteristic && activeBleDevice?.gatt?.connected) {
    const server = activeBleDevice.gatt;
    const services = await server.getPrimaryServices();
    for (const s of services) {
      const chars = await s.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          activeCharacteristic = c;
          break;
        }
      }
      if (activeCharacteristic) break;
    }
  }

  if (!activeCharacteristic) {
    throw new Error('No active Bluetooth printer connection. Please reconnect the printer.');
  }

  const CHUNK_SIZE = 64;
  for (let i = 0; i < uint8Bytes.length; i += CHUNK_SIZE) {
    const chunk = uint8Bytes.slice(i, i + CHUNK_SIZE);
    if (activeCharacteristic.writeValueWithoutResponse) {
      await activeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await activeCharacteristic.writeValue(chunk);
    }
    // Slight pause between packets to prevent buffer overflow on mini thermal chips
    await new Promise((r) => setTimeout(r, 20));
  }
};

/**
 * Browser-isolated receipt printing via hidden iframe with popup fallback for Web/GitHub Pages.
 */
export const printHtmlOnWeb = (html) => {
  return new Promise((resolve) => {
    try {
      if (typeof document === 'undefined') {
        resolve({ success: false, error: 'Document not available' });
        return;
      }

      // Remove any leftover temporary print iframes
      const existing = document.getElementById('thermal-print-iframe');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

      const iframe = document.createElement('iframe');
      iframe.id = 'thermal-print-iframe';
      iframe.setAttribute(
        'style',
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;z-index:-9999;'
      );
      document.body.appendChild(iframe);

      const frameDoc = iframe.contentWindow || iframe.contentDocument;
      const targetDoc = frameDoc.document || frameDoc;

      targetDoc.open();
      targetDoc.write(html);
      targetDoc.close();

      let printed = false;
      const executePrint = () => {
        if (printed) return;
        printed = true;
        try {
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          }
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
            resolve({ success: true, mode: 'web_iframe' });
          }, 1200);
        } catch (e) {
          console.warn('[PrinterService] Iframe print failed, attempting popup fallback:', e);
          try {
            const printWin = window.open('', '_blank', 'width=450,height=650');
            if (printWin) {
              printWin.document.write(html);
              printWin.document.close();
              printWin.focus();
              printWin.print();
              setTimeout(() => {
                try { printWin.close(); } catch (_) {}
              }, 1200);
              resolve({ success: true, mode: 'web_popup' });
            } else {
              window.print();
              resolve({ success: true, mode: 'window_print' });
            }
          } catch (winErr) {
            console.error('[PrinterService] Popup print error:', winErr);
            resolve({ success: false, error: winErr });
          }
        }
      };

      if (iframe.contentWindow) {
        iframe.contentWindow.onload = executePrint;
        setTimeout(executePrint, 350);
      } else {
        executePrint();
      }
    } catch (err) {
      console.error('[PrinterService] Web print initialization failed:', err);
      try {
        if (typeof window !== 'undefined') {
          window.print();
          resolve({ success: true, mode: 'window_print' });
        } else {
          resolve({ success: false, error: err });
        }
      } catch (fallbackErr) {
        resolve({ success: false, error: fallbackErr });
      }
    }
  });
};

/**
 * Universal Print Execution:
 * Dispatches to Web Bluetooth BLE, Web Iframe Print, or System Print (expo-print/AirPrint/PDF).
 */
export const printDataPayload = async (dataPayload) => {
  const config = await getPrinterConfig();

  // 1. If Web Bluetooth characteristic is actively connected
  if (activeCharacteristic) {
    try {
      const rawBytes = generateEscPosBytes(dataPayload, config);
      await sendBytesViaWebBluetooth(rawBytes);
      return { success: true, mode: 'bluetooth' };
    } catch (bleErr) {
      console.warn('[PrinterService] Direct BLE print failed, falling back to system print:', bleErr);
    }
  }

  // 2. Universal printing: Web iframe receipt or native expo-print
  try {
    const html = generateReceiptHtml(dataPayload, config);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      return await printHtmlOnWeb(html);
    } else {
      await Print.printAsync({ html });
      return { success: true, mode: 'system' };
    }
  } catch (printErr) {
    console.error('[PrinterService] Print error:', printErr);
    throw printErr;
  }
};

/**
 * Prints an Order Receipt.
 *
 * @param {object} orderDetails - The full order record.
 * @param {object} options - Optional overrides.
 */
export const printReceipt = async (orderDetails, options = {}) => {
  if (!orderDetails) {
    Alert.alert('Error', 'No order details available to print.');
    return { success: false, error: 'No order details provided' };
  }

  try {
    let order = typeof orderDetails === 'string' ? { id: orderDetails } : { ...orderDetails };
    const orderId = order.id || order.order_id || order.orderId;

    // 1. If order_items are not present or empty, auto-fetch full order details from Supabase
    if (orderId && (!order.order_items || !Array.isArray(order.order_items) || order.order_items.length === 0)) {
      try {
        const { data: fetchedOrder, error: fetchErr } = await supabase
          .from('orders')
          .select(`
            *,
            order_items (
              id,
              quantity,
              price,
              product_variant_combination_id,
              product_variant_combinations (
                id,
                combination_string,
                price,
                products (
                  id,
                  product_name,
                  customer_id,
                  user_id
                )
              )
            )
          `)
          .eq('id', orderId)
          .maybeSingle();

        if (!fetchErr && fetchedOrder) {
          order = { ...order, ...fetchedOrder };
        }
      } catch (dbErr) {
        console.warn('[PrinterService] Auto-fetching order items notice:', dbErr);
      }
    }

    // 2. Parse Shipping Address / Contact Info
    let shippingObj = null;
    if (order.shipping_address) {
      if (typeof order.shipping_address === 'object') {
        shippingObj = order.shipping_address;
      } else if (typeof order.shipping_address === 'string') {
        try {
          shippingObj = JSON.parse(order.shipping_address);
        } catch (_) {
          shippingObj = { address: order.shipping_address };
        }
      }
    }

    let customerName =
      shippingObj?.name ||
      order.customer_name ||
      order.customerName ||
      '';

    let customerPhone =
      shippingObj?.phone ||
      shippingObj?.mobile ||
      order.customer_mobile ||
      order.customer_phone ||
      order.customerPhone ||
      '';

    // If customer details still missing, query user profile by user_id
    if ((!customerName || !customerPhone) && order.user_id) {
      try {
        const { data: userProfile } = await supabase
          .from('profiles')
          .select('full_name, mobile')
          .eq('id', order.user_id)
          .maybeSingle();

        if (userProfile) {
          if (!customerName && userProfile.full_name) customerName = userProfile.full_name;
          if (!customerPhone && userProfile.mobile) customerPhone = userProfile.mobile;
        }
      } catch (_) {}
    }

    // 3. Process line items with comprehensive fallbacks
    const rawItems = order.order_items || order.items || order.cart_items || [];
    const items = rawItems.map((item) => {
      const prodCombo = item.product_variant_combinations;
      const prod = prodCombo?.products || item.products || item.product;
      const productName =
        prod?.product_name ||
        item.product_name ||
        item.itemName ||
        item.item_name ||
        item.name ||
        item.title ||
        'Item';

      const comboStr = prodCombo?.combination_string || item.combination_string || item.variant || item.variant_name;
      const variantStr = (comboStr && comboStr.trim().toLowerCase() !== 'default')
        ? ` (${comboStr})`
        : '';

      const quantity = Number(item.quantity || item.qty || item.count || 1);
      const unitPrice = Number(
        item.price !== undefined && item.price !== null
          ? item.price
          : (prodCombo?.price !== undefined ? prodCombo.price : (item.amount || 0))
      );

      return {
        name: `${productName}${variantStr}`,
        quantity,
        price: unitPrice,
        total: quantity * unitPrice,
      };
    });

    // Robust calculation of subtotal and total with multiple fallbacks
    const itemsTotal = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const deliveryFee = Number(order.delivery_fee || order.deliveryFee || 0);
    const discount = Number(order.discount_amount || order.discount || 0);

    // Extract billing metadata if present in shipping_address JSON
    const shippingBilling = (typeof shippingObj === 'object' && shippingObj?.billing) ? shippingObj.billing : null;

    let subtotal = 0;
    if (order.subtotal !== undefined && order.subtotal !== null && Number(order.subtotal) > 0) {
      subtotal = Number(order.subtotal);
    } else if (shippingBilling?.subtotal !== undefined && Number(shippingBilling.subtotal) > 0) {
      subtotal = Number(shippingBilling.subtotal);
    } else if (itemsTotal > 0) {
      subtotal = itemsTotal;
    } else if (order.total_amount !== undefined && order.total_amount !== null && Number(order.total_amount) > 0) {
      subtotal = Number(order.total_amount);
    } else if (order.total !== undefined && order.total !== null && Number(order.total) > 0) {
      subtotal = Number(order.total);
    }

    const config = await getPrinterConfig();
    let cgstAmount = Number(order.cgst_amount || order.cgstAmount || shippingBilling?.cgst_amount || 0);
    let sgstAmount = Number(order.sgst_amount || order.sgstAmount || shippingBilling?.sgst_amount || 0);
    let serviceCost = Number(order.service_cost || order.serviceCost || shippingBilling?.service_cost || 0);
    const cgstRate = Number(order.cgst_rate !== undefined ? order.cgst_rate : shippingBilling?.cgst_rate !== undefined ? shippingBilling.cgst_rate : (config.cgstRate || 2.5));
    const sgstRate = Number(order.sgst_rate !== undefined ? order.sgst_rate : shippingBilling?.sgst_rate !== undefined ? shippingBilling.sgst_rate : (config.sgstRate || 2.5));
    const serviceCostRate = Number(order.service_cost_rate !== undefined ? order.service_cost_rate : shippingBilling?.service_cost_rate !== undefined ? shippingBilling.service_cost_rate : (config.serviceCostRate || 0));

    if (cgstAmount === 0 && sgstAmount === 0 && config.enableTax && subtotal > 0) {
      cgstAmount = Math.round(subtotal * (cgstRate / 100) * 100) / 100;
      sgstAmount = Math.round(subtotal * (sgstRate / 100) * 100) / 100;
    }
    if (serviceCost === 0 && config.enableServiceCost && subtotal > 0 && serviceCostRate > 0) {
      serviceCost = Math.round(subtotal * (serviceCostRate / 100) * 100) / 100;
    }

    const expectedTotalWithTaxes = subtotal + deliveryFee - discount + cgstAmount + sgstAmount + serviceCost;
    const rawOrderTotal = Number(order.total_amount || order.total || order.amount || 0);
    let total = expectedTotalWithTaxes;
    if (rawOrderTotal >= (expectedTotalWithTaxes - 0.05) && rawOrderTotal > 0) {
      total = rawOrderTotal;
    }

    const { orderNumber, dayOrderNo } = extractOrderNumbers(order);
    const resolvedDayOrderNo = options.dayOrderNo || options.dailyOrderNumber || dayOrderNo;

    const formattedAddress = shippingObj
      ? [shippingObj.address, shippingObj.city, shippingObj.postalCode || shippingObj.postal_code, shippingObj.country].filter(Boolean).join(', ')
      : (typeof order.shipping_address === 'string' ? order.shipping_address : '');

    const orderType = order.order_type || (order.table_no ? (order.table_no === 'Parcel' ? 'Takeaway / Parcel' : `Dine-In (Table #${order.table_no})`) : 'Delivery');

    // Dynamic Payment QR Code Resolution (Configurable by seller profile & printer settings)
    let shouldPrintQr = config.printDynamicQr !== false;
    let sellerUpiId = order.seller_upi_id || order.upi_id || shippingBilling?.upi_id || null;
    let resolvedSellerName = options.storeName || order.seller_name || config.storeName || 'Store';
    const sellerId =
      order.seller_id ||
      order.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
      order.order_items?.[0]?.product_variant_combinations?.products?.customer_id ||
      order.user_id ||
      null;

    // Check seller profile settings from Supabase if sellerId is present
    if (sellerId) {
      try {
        const { data: sellerProf } = await supabase
          .from('profiles')
          .select('upi_id, full_name, print_qr_on_receipt')
          .eq('id', sellerId)
          .maybeSingle();

        if (sellerProf) {
          if (sellerProf.print_qr_on_receipt === false) {
            shouldPrintQr = false;
          } else if (sellerProf.print_qr_on_receipt === true) {
            shouldPrintQr = true;
          }
          if (!sellerUpiId && sellerProf.upi_id) {
            sellerUpiId = sellerProf.upi_id;
          }
          if (sellerProf.full_name && !options.storeName && !order.seller_name) {
            resolvedSellerName = sellerProf.full_name;
          }
        }
      } catch (profErr) {
        console.warn('[PrinterService] Seller profile query notice:', profErr);
      }

      // If UPI ID still missing, check user_qr_codes table for active QR code
      if (!sellerUpiId && shouldPrintQr) {
        try {
          const { data: qrRow } = await supabase
            .from('user_qr_codes')
            .select('name, qr_image_url')
            .eq('user_id', sellerId)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (qrRow?.name && qrRow.name.includes('@')) {
            sellerUpiId = qrRow.name.trim();
          }
        } catch (_) {}
      }
    }

    let dynamicQrText = null;
    let dynamicQrUrl = null;

    if (shouldPrintQr && total > 0) {
      const cleanUpi = sellerUpiId ? sellerUpiId.trim() : null;
      if (cleanUpi) {
        dynamicQrText = `upi://pay?pa=${encodeURIComponent(cleanUpi)}&pn=${encodeURIComponent(resolvedSellerName)}&am=${total.toFixed(2)}&cu=INR&tn=Order%20${encodeURIComponent(orderNumber)}`;
      } else {
        dynamicQrText = `upi://pay?pn=${encodeURIComponent(resolvedSellerName)}&am=${total.toFixed(2)}&cu=INR&tn=Order%20${encodeURIComponent(orderNumber)}`;
      }

      try {
        dynamicQrUrl = await QRCode.toDataURL(dynamicQrText, { width: 250, margin: 2 });
      } catch (qrErr) {
        dynamicQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=4&data=${encodeURIComponent(dynamicQrText)}`;
      }
    }

    const payload = {
      title: options.title || 'TAX INVOICE / ORDER RECEIPT',
      orderId: orderNumber,
      rawOrderId: orderId,
      dayOrderNo: resolvedDayOrderNo || null,
      dailyOrderNumber: resolvedDayOrderNo || null,
      dayWiseOrderNo: resolvedDayOrderNo || null,
      date: order.created_at
        ? new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
        : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      customerName,
      customerPhone,
      deliveryAddress: formattedAddress,
      orderType,
      tableNo: order.table_no,
      items,
      subtotal,
      cgstAmount,
      sgstAmount,
      serviceCost,
      cgstRate,
      sgstRate,
      serviceCostRate,
      deliveryFee,
      discount,
      total,
      paymentMethod: String(order.payment_method || 'CASH').toUpperCase(),
      paymentReference: extractOrderNumbers(order).paymentReference,
      paymentStatus: String(order.payment_status || (order.status === 'completed' || order.status === 'paid' ? 'PAID' : 'PENDING')).toUpperCase(),
      storeName: options.storeName || resolvedSellerName || undefined,
      dynamicQrText,
      dynamicQrUrl,
      sellerUpiId,
      shouldPrintQr,
      printDynamicQr: shouldPrintQr,
    };

    const result = await printDataPayload(payload);

    // Optional voice announcement only when explicitly enabled (separated so user can click voice icon independently)
    if (options.speak === true) {
      try {
        announceOrderPrint(payload);
      } catch (speechErr) {
        console.warn('[PrinterService] Speech announcement notice:', speechErr);
      }
    }

    return result;
  } catch (err) {
    console.error('[PrinterService] printReceipt error:', err);
    Alert.alert(
      'Print Failed',
      `Could not print receipt: ${err.message || err}.\n\nPlease ensure your printer is powered on or select printer settings.`,
      [{ text: 'OK' }]
    );
    return { success: false, error: err };
  }
};

/**
 * Prints a Pre-Bill / Cart Estimate.
 *
 * @param {object} cart - Cart object with cart_items.
 */
export const printPreBill = async (cart) => {
  if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
    Alert.alert('Empty Cart', 'There are no items to print a pre-bill for.');
    return;
  }

  try {
    const totalAmount = cart.cart_items.reduce(
      (total, item) =>
        total + (item.product_variant_combinations?.price || 0) * (item.quantity || 1),
      0
    );

    const items = cart.cart_items.map((item) => {
      const productName =
        item.product_variant_combinations?.products?.product_name ||
        item.product_name ||
        'Item';
      const variantStr =
        item.product_variant_combinations?.combination_string
          ? ` (${item.product_variant_combinations.combination_string})`
          : '';
      return {
        name: `${productName}${variantStr}`,
        quantity: item.quantity || 1,
        price: item.product_variant_combinations?.price || 0,
      };
    });

    const config = await getPrinterConfig();
    const subtotal = totalAmount;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let serviceCost = 0;
    if (config.enableTax && subtotal > 0) {
      cgstAmount = Math.round(subtotal * ((config.cgstRate || 2.5) / 100) * 100) / 100;
      sgstAmount = Math.round(subtotal * ((config.sgstRate || 2.5) / 100) * 100) / 100;
    }
    if (config.enableServiceCost && subtotal > 0 && (config.serviceCostRate || 0) > 0) {
      serviceCost = Math.round(subtotal * ((config.serviceCostRate || 0) / 100) * 100) / 100;
    }
    const computedEstimateTotal = subtotal + cgstAmount + sgstAmount + serviceCost;

    const payload = {
      title: '*** PRE-BILL / ESTIMATE ***',
      orderId: 'EST-' + Math.floor(100000 + Math.random() * 900000),
      date: new Date().toLocaleString(),
      items,
      subtotal,
      cgstAmount,
      sgstAmount,
      serviceCost,
      cgstRate: config.cgstRate || 2.5,
      sgstRate: config.sgstRate || 2.5,
      serviceCostRate: config.serviceCostRate || 0,
      total: computedEstimateTotal,
      paymentMethod: 'NOT PAID (ESTIMATE)',
      paymentStatus: 'DRAFT',
    };

    const result = await printDataPayload(payload);
    return result;
  } catch (err) {
    Alert.alert('Print Failed', `Could not print pre-bill: ${err.message || err}`);
    return { success: false, error: err };
  }
};

/**
 * Prints a Test Slip to verify printer connectivity and paper alignment.
 */
export const printTestReceipt = async () => {
  const config = await getPrinterConfig();
  const payload = {
    title: '=== PRINTER TEST SLIP ===',
    orderId: '20260829-0001',
    dayOrderNo: '0001',
    dailyOrderNumber: '0001',
    dayWiseOrderNo: '0001',
    date: new Date().toLocaleString(),
    items: [
      { name: '58mm/80mm Alignment Test', quantity: 1, price: 10.0 },
      { name: 'Thermal ESC/POS Check', quantity: 2, price: 20.0 },
    ],
    subtotal: 50.0,
    total: 50.0,
    paymentMethod: 'TEST OK',
    paymentStatus: 'VERIFIED',
  };

  try {
    const result = await printDataPayload(payload);
    Alert.alert('Test Print Sent', `Test slip successfully sent to ${config.printerName || 'Printer'}.`);
    return result;
  } catch (err) {
    Alert.alert('Test Print Error', err.message || 'Failed to print test slip.');
  }
};

/**
 * Prints a customer-facing Store QR Standee / Poster for physical shop counter display.
 */
export const printStoreStandee = async ({
  sellerName = 'Store',
  sellerAddress = '',
  sellerPhone = '',
  storeUrl = '',
  qrImageUrl = '',
}) => {
  const finalQrUrl =
    qrImageUrl ||
    `https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(storeUrl)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${sellerName} - Store QR Code Standee</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 1.5cm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 20px;
      color: #1e293b;
      background-color: #ffffff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 90vh;
    }
    .standee-card {
      border: 3px solid #007AFF;
      border-radius: 24px;
      padding: 36px 28px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      background: #ffffff;
      box-shadow: 0 10px 25px rgba(0, 122, 255, 0.08);
    }
    .badge {
      display: inline-block;
      background: #EFF6FF;
      color: #007AFF;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 20px;
      margin-bottom: 16px;
    }
    .store-name {
      font-size: 32px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    .store-address {
      font-size: 15px;
      color: #64748b;
      margin: 0 0 24px 0;
    }
    .qr-frame {
      display: inline-block;
      padding: 16px;
      background: #ffffff;
      border: 2px dashed #cbd5e1;
      border-radius: 16px;
      margin: 0 auto 20px auto;
    }
    .qr-image {
      width: 260px;
      height: 260px;
      display: block;
    }
    .scan-title {
      font-size: 20px;
      font-weight: 700;
      color: #007AFF;
      margin: 0 0 8px 0;
    }
    .scan-subtitle {
      font-size: 14px;
      color: #475569;
      margin: 0 0 24px 0;
    }
    .steps-container {
      display: flex;
      justify-content: space-around;
      background: #F8FAFC;
      border-radius: 12px;
      padding: 16px 8px;
      margin-bottom: 24px;
      text-align: center;
    }
    .step-item {
      flex: 1;
      padding: 0 4px;
    }
    .step-num {
      display: inline-block;
      width: 24px;
      height: 24px;
      line-height: 24px;
      background: #007AFF;
      color: #ffffff;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .step-text {
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      margin: 0;
    }
    .store-url-box {
      background: #f1f5f9;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12px;
      color: #334155;
      word-break: break-all;
      margin-bottom: 16px;
      font-family: monospace;
    }
    .footer {
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
    }
  </style>
</head>
<body>
  <div class="standee-card">
    <div class="badge">Digital Store & Menu</div>
    <h1 class="store-name">${sellerName}</h1>
    ${sellerAddress ? `<p class="store-address">📍 ${sellerAddress}</p>` : ''}
    ${sellerPhone ? `<p class="store-address" style="margin-top:-18px;">📞 ${sellerPhone}</p>` : ''}

    <div class="qr-frame">
      <img src="${finalQrUrl}" alt="Store QR Code" class="qr-image" />
    </div>

    <div class="scan-title">📱 Scan with Phone Camera</div>
    <div class="scan-subtitle">Browse products, view prices, and order online directly!</div>

    <div class="steps-container">
      <div class="step-item">
        <div class="step-num">1</div>
        <p class="step-text">Open Phone Camera</p>
      </div>
      <div class="step-item">
        <div class="step-num">2</div>
        <p class="step-text">Scan QR Code</p>
      </div>
      <div class="step-item">
        <div class="step-num">3</div>
        <p class="step-text">Order & Pay Fast</p>
      </div>
    </div>

    <div class="store-url-box">${storeUrl}</div>

    <div class="footer">
      Powered by Needs Tracker • Hyperlocal Marketplace
    </div>
  </div>
</body>
</html>
`;

  try {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      return await printHtmlOnWeb(html);
    } else {
      await Print.printAsync({ html });
      return { success: true, mode: 'system' };
    }
  } catch (err) {
    console.error('[PrinterService] Error printing store standee:', err);
    throw err;
  }
};


