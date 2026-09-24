import { Platform } from 'react-native';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Parses any raw string from a scanned QR code to extract UPI payment parameters.
 * Supports:
 * 1. Standard UPI URI: `upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...`
 * 2. Query string fragment: `pa=...&pn=...`
 * 3. BharatQR / EMVCo string: `000201...` containing UPI VPA
 * 4. Plain UPI ID / VPA: `name@bank`, `9876543210@upi`
 */
export function parseUpiString(text) {
  if (!text || typeof text !== 'string') {
    return {
      rawText: '',
      upiId: '',
      payeeName: '',
      amount: '',
      currency: 'INR',
      merchantCode: '',
      note: '',
      isUpi: false,
    };
  }

  const trimmed = text.trim();

  // 1. Standard or App-specific UPI URI: upi://pay?... or phonepe://pay?... or tez://upi/pay?...
  if (
    trimmed.toLowerCase().includes('upi://pay') ||
    trimmed.toLowerCase().includes('://pay?') ||
    trimmed.toLowerCase().includes('://upi/pay?') ||
    (trimmed.includes('pa=') && (trimmed.includes('pn=') || trimmed.includes('am=') || trimmed.includes('cu=')))
  ) {
    try {
      const upiUrl = trimmed.match(/[a-zA-Z0-9._-]+:\/\/[^\s"'>]+/i)?.[0] || trimmed;
      const queryPart = upiUrl.includes('?') ? upiUrl.split('?')[1] : upiUrl;
      const params = new URLSearchParams(queryPart);
      const pa = params.get('pa') || '';
      const pn = params.get('pn') || '';
      const am = params.get('am') || '';
      const cu = params.get('cu') || 'INR';
      const mc = params.get('mc') || '';
      const tn = params.get('tn') || '';

      let cleanUpiId = pa ? decodeURIComponent(pa).trim() : '';
      if (cleanUpiId && !cleanUpiId.includes('@')) {
        const normalized = normalizeUpiId(cleanUpiId);
        if (normalized && normalized.includes('@')) {
          cleanUpiId = normalized;
        }
      }
      const cleanPayeeName = pn ? decodeURIComponent(pn).trim() : '';

      return {
        rawText: trimmed,
        upiId: cleanUpiId,
        payeeName: cleanPayeeName,
        amount: am ? decodeURIComponent(am).trim() : '',
        currency: cu,
        merchantCode: mc,
        note: tn ? decodeURIComponent(tn).trim() : '',
        isUpi: Boolean(cleanUpiId && (cleanUpiId.includes('@') || /^\d{10}$/.test(cleanUpiId))),
      };
    } catch (err) {
      console.warn('Error parsing UPI URI params:', err);
    }
  }

  // 2. Query param or fragment format (e.g. pa=someone@bank or URL containing pa=)
  if (trimmed.includes('pa=') && trimmed.includes('@')) {
    const paMatch = trimmed.match(/[?&]pa=([^&"'\s]+)/i) || trimmed.match(/pa=([^&"'\s]+)/i);
    const pnMatch = trimmed.match(/[?&]pn=([^&"'\s]+)/i) || trimmed.match(/pn=([^&"'\s]+)/i);
    const amMatch = trimmed.match(/[?&]am=([^&"'\s]+)/i) || trimmed.match(/am=([^&"'\s]+)/i);
    const cleanUpiId = paMatch ? decodeURIComponent(paMatch[1]).trim() : '';
    const cleanPayeeName = pnMatch ? decodeURIComponent(pnMatch[1]).trim() : '';
    if (cleanUpiId && cleanUpiId.includes('@')) {
      return {
        rawText: trimmed,
        upiId: cleanUpiId,
        payeeName: cleanPayeeName,
        amount: amMatch ? decodeURIComponent(amMatch[1]).trim() : '',
        currency: 'INR',
        merchantCode: '',
        note: '',
        isUpi: true,
      };
    }
  }

  // 3. BharatQR / EMVCo format (starts with 000201 or contains org.npci.upi)
  if (trimmed.startsWith('000201') || trimmed.includes('000201') || trimmed.includes('org.npci.upi')) {
    const upiMatch = trimmed.match(/upi:\/\/pay\?[^"'\s]+/i);
    if (upiMatch) {
      return parseUpiString(upiMatch[0]);
    }

    let extractedUpi = '';
    let extractedPayee = '';

    // TLV parser for EMVCo specifications
    const parseEmvTags = (str) => {
      const map = {};
      let i = 0;
      while (i + 4 <= str.length) {
        const tag = str.substring(i, i + 2);
        const len = parseInt(str.substring(i + 2, i + 4), 10);
        if (isNaN(len) || len < 0 || i + 4 + len > str.length) break;
        map[tag] = str.substring(i + 4, i + 4 + len);
        i += 4 + len;
      }
      return map;
    };

    try {
      const tags = parseEmvTags(trimmed);
      // Merchant Account Information tags 26 to 51
      for (let t = 26; t <= 51; t++) {
        const val = tags[String(t)];
        if (val) {
          const subtags = parseEmvTags(val);
          if (subtags['01'] && subtags['01'].includes('@')) {
            extractedUpi = subtags['01'].trim();
            break;
          }
        }
      }
      if (tags['59']) {
        extractedPayee = tags['59'].trim();
        // Clean tag boundary bleed if len had city code
        if (extractedPayee.endsWith('600')) extractedPayee = extractedPayee.slice(0, -3);
      }
    } catch (_) {}

    // Fallback regex if TLV tags failed
    if (!extractedUpi) {
      const npciMatch = trimmed.match(/org\.npci\.upi(?:01)?(?:\d{2})?([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,30})/i);
      if (npciMatch) {
        extractedUpi = npciMatch[1].trim();
      } else {
        const genericVpa = trimmed.match(/([a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z]{2,30})/);
        if (genericVpa) {
          extractedUpi = genericVpa[1].trim();
        }
      }
    }

    if (!extractedPayee) {
      const payeeMatch = trimmed.match(/59(\d{2})([A-Za-z0-9\s&.,'-]+)/);
      if (payeeMatch) {
        const len = parseInt(payeeMatch[1], 10);
        if (!isNaN(len) && len > 0) {
          extractedPayee = payeeMatch[2].substring(0, len).trim();
        }
      }
    }

    if (extractedUpi) {
      return {
        rawText: trimmed,
        upiId: extractedUpi,
        payeeName: extractedPayee,
        amount: '',
        currency: 'INR',
        merchantCode: '',
        note: '',
        isUpi: true,
      };
    }
  }

  // 4. Plain UPI ID / VPA (e.g. mobile@upi, username@okhdfcbank)
  const plainVpaMatch = trimmed.match(/^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z]{2,30}$/);
  if (plainVpaMatch) {
    return {
      rawText: trimmed,
      upiId: trimmed,
      payeeName: '',
      amount: '',
      currency: 'INR',
      merchantCode: '',
      note: '',
      isUpi: true,
    };
  }

  // 5. Embedded VPA anywhere in text
  const insideVpaMatch = trimmed.match(/(?:^|[^a-zA-Z0-9.\-_])([a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z]{2,30})(?:[^a-zA-Z0-9.\-_]|$)/);
  if (insideVpaMatch) {
    return {
      rawText: trimmed,
      upiId: insideVpaMatch[1].trim(),
      payeeName: '',
      amount: '',
      currency: 'INR',
      merchantCode: '',
      note: '',
      isUpi: true,
    };
  }

  // 6. 10-digit mobile number, UPI number, or alphanumeric Merchant ID fallback
  const normalizedCandidate = normalizeUpiId(trimmed);
  if (normalizedCandidate && normalizedCandidate.includes('@')) {
    return {
      rawText: trimmed,
      upiId: normalizedCandidate,
      payeeName: '',
      amount: '',
      currency: 'INR',
      merchantCode: '',
      note: '',
      isUpi: true,
    };
  }

  return {
    rawText: trimmed,
    upiId: '',
    payeeName: '',
    amount: '',
    currency: 'INR',
    merchantCode: '',
    note: '',
    isUpi: false,
  };
}

/**
 * Checks if a string is a generic QR name/label or placeholder rather than an actual UPI ID.
 */
export function isGenericQrName(text) {
  if (!text || typeof text !== 'string') return true;
  const clean = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!clean) return true;
  const genericLabels = [
    'myupiqr',
    'myupiqr@upi',
    'myqr',
    'myupi',
    'upiqr',
    'qrcode',
    'qr_code',
    'activeqr',
    'staticqr',
    'dynamicqr',
    'storeqr',
    'sellerqr',
    'default',
    'storemerchant',
    'store',
    'null',
    'undefined',
    'vpa',
    'merchantid',
    'qr',
    'image',
    'scanqr',
    'myaccount',
  ];
  if (genericLabels.includes(clean)) return true;
  if (
    clean.startsWith('myupiqr') ||
    clean.startsWith('storeqr') ||
    clean.startsWith('qrcode') ||
    clean.startsWith('staticqr')
  ) {
    return true;
  }
  return false;
}

/**
 * Normalizes any UPI ID, 10-digit mobile number, or Merchant ID into a valid standard UPI VPA (Virtual Payment Address).
 * If the user inputs a plain Merchant ID (e.g. "storename" or "9876543210"), automatically appends the "@upi" handler!
 * Supports:
 * - Full UPI URI: upi://pay?pa=store@okaxis -> store@okaxis
 * - Query string: pa=store@okaxis -> store@okaxis
 * - Plain VPA: store@okaxis -> store@okaxis
 * - 10-digit Mobile: 9876543210 -> 9876543210@upi
 * - With Country Code: +919876543210 / 919876543210 -> 9876543210@upi
 * - Alphanumeric Merchant ID: storename / merchant123 / reddy_store -> storename@upi
 * - Partial handle: storename@ -> storename@upi
 */
export function normalizeUpiId(text) {
  if (!text || typeof text !== 'string') return '';
  let trimmed = text.trim();
  if (!trimmed) return '';

  // Filter out generic labels/placeholders (e.g. "My UPI QR")
  if (isGenericQrName(trimmed)) {
    return '';
  }

  // 1. If full URI or query with pa=
  if (trimmed.toLowerCase().includes('upi://pay')) {
    const paMatch = trimmed.match(/[?&]pa=([^&"'\s]+)/i);
    if (paMatch) {
      trimmed = decodeURIComponent(paMatch[1]).trim();
    }
  } else if (trimmed.includes('pa=') && trimmed.includes('@')) {
    const paMatch = trimmed.match(/[?&]pa=([^&"'\s]+)/i) || trimmed.match(/pa=([^&"'\s]+)/i);
    if (paMatch) {
      trimmed = decodeURIComponent(paMatch[1]).trim();
    }
  }

  // 2. Remove all whitespace
  trimmed = trimmed.replace(/\s+/g, '');

  // 3. If already has @
  if (trimmed.includes('@')) {
    if (trimmed.endsWith('@')) {
      trimmed = `${trimmed}upi`;
    }
    const parts = trimmed.split('@');
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
      const placeholderPrefixes = ['myupiqr', 'qrcode', 'qr_code', 'staticqr', 'dynamicqr'];
      if (placeholderPrefixes.includes(parts[0].toLowerCase())) return '';
      return trimmed.toLowerCase();
    }
    if (!trimmed.startsWith('@')) {
      return trimmed.toLowerCase();
    }
    return '';
  }

  // 4. Check if 10-digit mobile number (with optional +91, 91, or 0 prefix)
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits}@upi`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `${digits.slice(2)}@upi`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${digits.slice(1)}@upi`;
  }

  // 5. Alphanumeric Merchant ID / Store ID (e.g. merchant123, storeid, reddy_store)
  // Automatically append the standard @upi handler
  const sanitized = trimmed.replace(/[^a-zA-Z0-9.\-_]/g, '');
  if (sanitized.length >= 2 && !isGenericQrName(sanitized)) {
    return `${sanitized.toLowerCase()}@upi`;
  }

  return '';
}

/**
 * Builds standard UPI Payment URI
 */
export function buildUpiPaymentUri({ upiId, payeeName = '', amount, note = 'Order Payment', rawText, tr }) {
  if (rawText && typeof rawText === 'string' && rawText.includes('upi://pay?')) {
    try {
      const upiUrl = rawText.match(/upi:\/\/pay\?[^\s"'>]+/i)?.[0] || rawText;
      const base = upiUrl.split('?')[0];
      const queryPart = upiUrl.includes('?') ? upiUrl.split('?')[1] : '';
      const params = new URLSearchParams(queryPart);

      let modified = false;

      if (amount !== undefined && amount !== null && !isNaN(Number(amount)) && Number(amount) > 0) {
        params.set('am', Number(amount).toFixed(2));
        modified = true;
      }
      if (note) {
        // Strip # and special characters that cause UPI transaction failures (UPI standard allows alphanumeric and spaces/hyphens only)
        const cleanNoteParam = String(note).replace(/[^a-zA-Z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
        params.set('tn', cleanNoteParam);
        modified = true;
      }

      // CRITICAL FOR GOOGLE PAY:
      // If amount or note is modified, the static digital signature (sign parameter) from
      // merchant standee QR (PhonePe / Paytm / BharatPe / GPay) is no longer valid.
      // Google Pay verifies signatures: an invalid signature causes "This transaction may be risky"
      // or outright blocks the transaction. Remove signature/checksum parameters!
      if (modified) {
        params.delete('sign');
        params.delete('sign_algo');
        params.delete('signature');
        params.delete('checksum');
      }

      // Handle payee name (pn)
      const cleanPayee = (payeeName || '').trim();
      if (cleanPayee && !isGenericQrName(cleanPayee) && cleanPayee !== 'Store Merchant' && cleanPayee !== 'Merchant') {
        if (!params.has('pn') || isGenericQrName(params.get('pn')) || params.get('pn') === 'Store Merchant') {
          params.set('pn', cleanPayee);
        }
      } else if (params.has('pn') && (isGenericQrName(params.get('pn')) || params.get('pn') === 'Store Merchant')) {
        // Delete generic dummy name so UPI apps (especially GPay) resolve the actual bank-registered name without throwing mismatch warning
        params.delete('pn');
      }

      // Add clean Transaction Reference (tr) if provided and not present
      if (tr && !params.has('tr')) {
        const cleanTr = String(tr).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
        if (cleanTr) params.set('tr', cleanTr);
      }

      return `${base}?${params.toString()}`;
    } catch (e) {
      console.warn('Error preserving scanned UPI parameters in buildUpiPaymentUri:', e);
    }
  }

  const cleanUpi = normalizeUpiId(upiId);
  if (!cleanUpi) return '';
  const cleanName = (payeeName || '').trim();
  // Strip # and any character that is not alphanumeric, space, or hyphen
  const cleanNote = String(note || 'Order Payment').replace(/[^a-zA-Z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim() || 'Order Payment';

  // Base UPI URI with payee address and currency
  let uri = `upi://pay?pa=${encodeURIComponent(cleanUpi)}&cu=INR`;

  // Only include pn if it's a real, non-generic name.
  // When omitted, Google Pay & NPCI resolve the verified bank name automatically,
  // preventing "Name mismatch / Transaction may be risky" errors!
  if (cleanName && !isGenericQrName(cleanName) && cleanName !== 'Store Merchant' && cleanName !== 'Merchant') {
    uri += `&pn=${encodeURIComponent(cleanName)}`;
  }

  if (cleanNote) {
    uri += `&tn=${encodeURIComponent(cleanNote)}`;
  }

  if (amount !== undefined && amount !== null && !isNaN(Number(amount)) && Number(amount) > 0) {
    uri += `&am=${Number(amount).toFixed(2)}`;
  }

  if (tr) {
    const cleanTr = String(tr).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
    if (cleanTr) uri += `&tr=${encodeURIComponent(cleanTr)}`;
  }

  return uri;
}

/**
 * Builds an Android Intent URI for Chrome and Android mobile browsers.
 * Format: `intent://pay?{params}#Intent;scheme=upi;package={pkg};end;`
 * When package is not specified, opens Android's native UPI app chooser.
 */
export function buildAndroidIntentUri({ upiId, payeeName = '', amount, note = 'Order Payment', packageName = null, rawText, tr }) {
  const standardUri = buildUpiPaymentUri({ upiId, payeeName, amount, note, rawText, tr });
  if (!standardUri) return '';

  const queryPart = standardUri.includes('?') ? standardUri.split('?')[1] : '';
  const packagePart = packageName ? `package=${packageName};` : '';
  return `intent://pay?${queryPart}#Intent;scheme=upi;${packagePart}end;`;
}

/**
 * Returns supported UPI apps with their specific Android Intent, iOS, and Universal URIs.
 */
export function buildUpiAppLinks({ upiId, payeeName = '', amount, note = 'Order Payment', rawText, tr }) {
  const standardUri = buildUpiPaymentUri({ upiId, payeeName, amount, note, rawText, tr });
  if (!standardUri) return [];

  const queryPart = standardUri.includes('?') ? standardUri.split('?')[1] : '';

  return [
    {
      id: 'gpay',
      name: 'Google Pay',
      shortName: 'GPay',
      packageName: 'com.google.android.apps.nbu.paisa.user',
      androidIntent: `intent://pay?${queryPart}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end;`,
      iosUri: `tez://upi/pay?${queryPart}`,
      standardUri,
      color: '#0F9D58',
      bgColor: '#E6F4EA',
      borderColor: '#34A853',
      icon: 'google',
      tag: 'Google Pay',
    },
    {
      id: 'phonepe',
      name: 'PhonePe',
      shortName: 'PhonePe',
      packageName: 'com.phonepe.app',
      androidIntent: `intent://pay?${queryPart}#Intent;scheme=upi;package=com.phonepe.app;end;`,
      iosUri: `phonepe://pay?${queryPart}`,
      standardUri: `phonepe://pay?${queryPart}`,
      color: '#5F259F',
      bgColor: '#F3E8FF',
      borderColor: '#9333EA',
      icon: 'mobile',
      tag: 'PhonePe',
    },
    {
      id: 'paytm',
      name: 'Paytm',
      shortName: 'Paytm',
      packageName: 'net.one97.paytm',
      androidIntent: `intent://pay?${queryPart}#Intent;scheme=upi;package=net.one97.paytm;end;`,
      iosUri: `paytmmp://pay?${queryPart}`,
      standardUri: `paytmmp://pay?${queryPart}`,
      color: '#00B9F1',
      bgColor: '#E0F7FE',
      borderColor: '#0284C7',
      icon: 'credit-card',
      tag: 'Paytm',
    },
    {
      id: 'bhim',
      name: 'BHIM UPI',
      shortName: 'BHIM',
      packageName: 'in.org.npci.upiapp',
      androidIntent: `intent://pay?${queryPart}#Intent;scheme=upi;package=in.org.npci.upiapp;end;`,
      iosUri: `upi://pay?${queryPart}`,
      standardUri,
      color: '#0070BA',
      bgColor: '#E6F0FA',
      borderColor: '#0284C7',
      icon: 'shield',
      tag: 'BHIM',
    },
    {
      id: 'any',
      name: 'All UPI Apps',
      shortName: 'Chooser',
      packageName: null,
      androidIntent: `intent://pay?${queryPart}#Intent;scheme=upi;end;`,
      iosUri: standardUri,
      standardUri,
      color: '#2563EB',
      bgColor: '#EFF6FF',
      borderColor: '#3B82F6',
      icon: 'external-link',
      tag: 'Any App',
    },
  ];
}

/**
 * Safely launches a UPI payment intent in Web browsers (Android Chrome, iOS Safari) and React Native.
 */
export async function openUpiAppIntent({
  appId = 'any',
  upiId,
  payeeName = '',
  amount,
  note = 'Order Payment',
  rawText,
  tr,
  LinkingInstance,
}) {
  const apps = buildUpiAppLinks({ upiId, payeeName, amount, note, rawText, tr });
  const app = apps.find((a) => a.id === appId) || apps.find((a) => a.id === 'any') || apps[0];
  if (!app) return { success: false, reason: 'no_app' };

  const isWeb = Platform.OS === 'web' || typeof window !== 'undefined';
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobileBrowser = isAndroid || isIOS || /webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  if (isWeb && !isMobileBrowser) {
    return { success: false, reason: 'desktop', app };
  }

  // On Android Chrome/browser: use Android Intent URL (prevents ERR_UNKNOWN_URL_SCHEME in Chrome)
  // On iOS Safari: use iOS scheme (tez://, phonepe://, paytmmp://, or upi://)
  let targetUrl = app.standardUri;
  if (isWeb) {
    if (isAndroid) {
      targetUrl = app.androidIntent;
    } else if (isIOS) {
      targetUrl = app.iosUri || app.standardUri;
    }
  }

  // Web environment: trigger dispatch using native DOM link click (user-initiated gesture)
  if (isWeb && typeof document !== 'undefined') {
    try {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.target = '_top';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch (_) {}
      }, 500);
      return { success: true, targetUrl, app };
    } catch (e) {
      console.warn('DOM link click failed, trying window.location:', e);
      try {
        window.location.href = targetUrl;
        return { success: true, targetUrl, app };
      } catch (locErr) {
        console.warn('window.location failed:', locErr);
      }
    }
  }

  // React Native environment
  if (LinkingInstance && LinkingInstance.openURL) {
    try {
      const canOpen = await LinkingInstance.canOpenURL(targetUrl).catch(() => false);
      if (canOpen) {
        await LinkingInstance.openURL(targetUrl);
        return { success: true, targetUrl, app };
      }
      // Try standard upi URI as fallback
      const canOpenStd = await LinkingInstance.canOpenURL(app.standardUri).catch(() => false);
      if (canOpenStd) {
        await LinkingInstance.openURL(app.standardUri);
        return { success: true, targetUrl: app.standardUri, app };
      }
      // Direct open targetUrl
      await LinkingInstance.openURL(targetUrl);
      return { success: true, targetUrl, app };
    } catch (nativeErr) {
      console.warn('Native Linking.openURL error:', nativeErr);
    }
  }

  return { success: false, reason: 'unsupported', app };
}

/**
 * Generates local QR code data URL (offline, instant, no external API dependency).
 * Falls back to public API if library fails.
 */
export async function generateQrDataUrl(text, options = {}) {
  if (!text) return null;
  const width = options.width || 350;
  const margin = options.margin !== undefined ? options.margin : 2;

  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width,
      margin,
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF',
      },
    });
    if (dataUrl) return dataUrl;
  } catch (err) {
    console.warn('Local QRCode.toDataURL failed, using fallback URL:', err);
  }

  // Fallback to qrserver API
  return `https://api.qrserver.com/v1/create-qr-code/?size=${width}x${width}&margin=${margin * 4}&data=${encodeURIComponent(text)}`;
}

/**
 * Helper to run jsQR with multiple preprocessing passes (standard, scaled, high-contrast, dynamic mean)
 */
function scanRgbaPixels(rgbaData, width, height) {
  if (!rgbaData || width <= 0 || height <= 0) return null;

  // Pass 1: Standard scan
  let code = jsQR(rgbaData, width, height, { inversionAttempts: 'attemptBoth' });
  if (code && code.data) return code.data;

  // Pass 2: High-contrast binarization pass at threshold 128
  const copy = new Uint8ClampedArray(rgbaData.length);
  let sumGray = 0;
  for (let i = 0; i < rgbaData.length; i += 4) {
    const gray = 0.299 * rgbaData[i] + 0.587 * rgbaData[i + 1] + 0.114 * rgbaData[i + 2];
    sumGray += gray;
    const bin = gray < 128 ? 0 : 255;
    copy[i] = bin;
    copy[i + 1] = bin;
    copy[i + 2] = bin;
    copy[i + 3] = 255;
  }
  code = jsQR(copy, width, height, { inversionAttempts: 'attemptBoth' });
  if (code && code.data) return code.data;

  // Pass 3: Adaptive mean brightness threshold
  const numPixels = rgbaData.length / 4;
  const meanGray = numPixels > 0 ? sumGray / numPixels : 128;
  if (Math.abs(meanGray - 128) > 15) {
    for (let i = 0; i < rgbaData.length; i += 4) {
      const gray = 0.299 * rgbaData[i] + 0.587 * rgbaData[i + 1] + 0.114 * rgbaData[i + 2];
      const bin = gray < meanGray ? 0 : 255;
      copy[i] = bin;
      copy[i + 1] = bin;
      copy[i + 2] = bin;
      copy[i + 3] = 255;
    }
    code = jsQR(copy, width, height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return code.data;
  }

  return null;
}

/**
 * Decodes a QR code from any image URI (Web Canvas, Mobile ImageManipulator + jpeg-js)
 * Supports blob:, file://, https://, data:image/...
 *
 * @param {string} imageUri
 * @returns {Promise<{ success: boolean, rawText?: string, upiId?: string, payeeName?: string, amount?: string, isUpi?: boolean, error?: string }>}
 */
export async function decodeQrFromImage(imageUri) {
  if (!imageUri || typeof imageUri !== 'string') {
    return { success: false, error: 'Invalid image URI provided' };
  }

  // -------------------------------------------------------------
  // Web Environment (HTMLCanvasElement)
  // -------------------------------------------------------------
  if (Platform.OS === 'web' || (typeof window !== 'undefined' && typeof document !== 'undefined')) {
    try {
      const decodedText = await new Promise((resolve) => {
        const tryCanvasScan = (imgElement) => {
          try {
            const origW = imgElement.naturalWidth || imgElement.width;
            const origH = imgElement.naturalHeight || imgElement.height;
            if (!origW || !origH) return null;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;

            // Test native size & downscaled sizes (for high-res phone photos)
            const targetSizes = [{ w: origW, h: origH }];
            if (origW > 800 || origH > 800) {
              const scale = Math.min(800 / origW, 800 / origH);
              targetSizes.unshift({ w: Math.round(origW * scale), h: Math.round(origH * scale) });
            }
            if (origW > 500 || origH > 500) {
              const scale2 = Math.min(500 / origW, 500 / origH);
              targetSizes.push({ w: Math.round(origW * scale2), h: Math.round(origH * scale2) });
            }

            for (const sz of targetSizes) {
              canvas.width = sz.w;
              canvas.height = sz.h;
              ctx.clearRect(0, 0, sz.w, sz.h);
              ctx.drawImage(imgElement, 0, 0, sz.w, sz.h);
              const imgData = ctx.getImageData(0, 0, sz.w, sz.h);
              const found = scanRgbaPixels(imgData.data, sz.w, sz.h);
              if (found) return found;

              // Also test center 75% crop if the image has large margins/standee border
              if (sz.w > 200 && sz.h > 200) {
                const cropW = Math.round(sz.w * 0.75);
                const cropH = Math.round(sz.h * 0.75);
                const cropX = Math.round((sz.w - cropW) / 2);
                const cropY = Math.round((sz.h - cropH) / 2);
                const cropData = ctx.getImageData(cropX, cropY, cropW, cropH);
                const cropFound = scanRgbaPixels(cropData.data, cropW, cropH);
                if (cropFound) return cropFound;
              }
            }
            return null;
          } catch (canvasErr) {
            console.warn('Web canvas QR scan error:', canvasErr);
            return null;
          }
        };

        const img = new window.Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          const res = tryCanvasScan(img);
          if (res) {
            resolve(res);
          } else {
            // If direct cross-origin image was tainted or didn't find QR, try blob fetch
            fetchBlobAndRetry();
          }
        };

        img.onerror = () => {
          fetchBlobAndRetry();
        };

        const fetchBlobAndRetry = async () => {
          try {
            const resp = await fetch(imageUri);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const blobImg = new window.Image();
            blobImg.onload = () => {
              const blobRes = tryCanvasScan(blobImg);
              URL.revokeObjectURL(objUrl);
              resolve(blobRes);
            };
            blobImg.onerror = () => {
              URL.revokeObjectURL(objUrl);
              resolve(null);
            };
            blobImg.src = objUrl;
          } catch (_) {
            resolve(null);
          }
        };

        img.src = imageUri;
      });

      if (decodedText) {
        const parsed = parseUpiString(decodedText);
        return {
          success: true,
          ...parsed,
        };
      }
    } catch (webErr) {
      console.warn('Web decodeQrFromImage error:', webErr);
    }
  }

  // -------------------------------------------------------------
  // Mobile / Native Environment (ImageManipulator -> base64 -> jpeg-js -> jsQR)
  // -------------------------------------------------------------
  try {
    if (ImageManipulator && ImageManipulator.manipulateAsync) {
      const sizesToTry = [800, 500, 1000, null];
      for (const targetW of sizesToTry) {
        const actions = targetW ? [{ resize: { width: targetW } }] : [];
        const manipResult = await ImageManipulator.manipulateAsync(
          imageUri,
          actions,
          { format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );

        if (manipResult?.base64) {
          const rawBuf = Buffer.from(manipResult.base64, 'base64');
          const decodedJpeg = jpeg.decode(rawBuf, { useTArray: true });
          if (decodedJpeg && decodedJpeg.data) {
            const foundText = scanRgbaPixels(decodedJpeg.data, decodedJpeg.width, decodedJpeg.height);
            if (foundText) {
              const parsed = parseUpiString(foundText);
              return {
                success: true,
                ...parsed,
              };
            }
          }
        }
      }
    }
  } catch (nativeErr) {
    console.warn('Native decodeQrFromImage error:', nativeErr);
  }

  return {
    success: false,
    error: 'No QR code could be detected in this image. Please ensure the QR code is clearly visible, in focus, and not cropped.',
  };
}

/**
 * Resolves payment details strictly from an uploaded QR code record or QR image.
 * Guarantees that payee name is extracted ONLY from the uploaded QR code details
 * and NEVER from the seller's profile name.
 *
 * @param {object} qrRecord - Row from user_qr_codes or object with { qr_image_url, name }
 * @returns {Promise<{ upiId: string, payeeName: string, rawText: string, isUpi: boolean }>}
 */
export async function resolveUploadedQrDetails(qrRecord) {
  if (!qrRecord) {
    return { upiId: '', payeeName: '', rawText: '', isUpi: false };
  }

  let upiId = '';
  let payeeName = '';
  let rawText = '';

  // 1. If qrRecord has explicit columns (payee_name, upi_id, raw_qr_data)
  if (qrRecord.upi_id) upiId = normalizeUpiId(qrRecord.upi_id) || '';
  if (qrRecord.payee_name && !isGenericQrName(qrRecord.payee_name) && qrRecord.payee_name !== 'Store Merchant') {
    payeeName = String(qrRecord.payee_name).trim();
  }
  if (qrRecord.raw_qr_data) rawText = qrRecord.raw_qr_data;

  // 2. Parse qrRecord.name (often holds raw QR text, upi://pay URI, BharatQR string, or VPA)
  if (qrRecord.name && (!upiId || !payeeName)) {
    const parsed = parseUpiString(qrRecord.name);
    if (!upiId && parsed?.upiId && !isGenericQrName(parsed.upiId)) {
      upiId = normalizeUpiId(parsed.upiId);
    }
    if (!payeeName && parsed?.payeeName && !isGenericQrName(parsed.payeeName) && parsed.payeeName !== 'Store Merchant') {
      payeeName = String(parsed.payeeName).trim();
    }
    if (!rawText && parsed?.rawText) {
      rawText = parsed.rawText;
    }
  }

  // 3. If details (especially payeeName or upiId) are still missing, decode from the uploaded QR image URL
  const imageUrl = qrRecord.qr_image_url || qrRecord.qr_code_url;
  if (imageUrl && (!upiId || !payeeName)) {
    try {
      const scan = await decodeQrFromImage(imageUrl);
      if (scan?.success) {
        if (!upiId && scan.upiId && !isGenericQrName(scan.upiId)) {
          upiId = normalizeUpiId(scan.upiId);
        }
        if (!payeeName && scan.payeeName && !isGenericQrName(scan.payeeName) && scan.payeeName !== 'Store Merchant') {
          payeeName = String(scan.payeeName).trim();
        }
        if (!rawText && scan.rawText) {
          rawText = scan.rawText;
        }
      }
    } catch (err) {
      console.warn('Notice resolving uploaded QR image details:', err);
    }
  }

  return {
    upiId: upiId || '',
    payeeName: payeeName || '', // Strictly from uploaded QR details only, never profile name!
    rawText: rawText || '',
    isUpi: Boolean(upiId),
  };
}

