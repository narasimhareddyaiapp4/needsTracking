import { Linking, Platform, Share } from 'react-native';
import { supabase } from './supabase';

// In-memory cache for fast, zero-delay seller profile lookups
const sellerContactCache = new Map();

/**
 * Normalizes phone numbers for dialer (removes formatting characters)
 */
export function cleanPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.trim().replace(/[^\d+]/g, '');
}

/**
 * Formats a phone number for WhatsApp wa.me links
 * WhatsApp expects country code + number with digits only (no '+', no '-', no spaces).
 * If a 10-digit number is passed without country code, defaults to +91 (India) as per project locale.
 */
export function formatWhatsAppNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  // If 10 digits, assume standard Indian mobile and prefix 91
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/**
 * Fetches and resolves seller contact details automatically.
 * Tries:
 *  1. In-memory cache
 *  2. profiles table by sellerId (or customerId)
 *  3. users table by sellerId
 *  4. customers table by customerId or user_id
 */
export async function getSellerContactInfo({ sellerId, customerId, product = null, fallbackSeller = null } = {}) {
  // If fallback seller has a phone already, use it as baseline
  const baselineMobile = fallbackSeller?.mobile || fallbackSeller?.phone || product?.seller_mobile || product?.seller_phone || null;
  const baselineName = fallbackSeller?.full_name || fallbackSeller?.name || product?.seller_name || null;

  const targetId = sellerId || product?.user_id || product?.customer_id || customerId || fallbackSeller?.id;
  
  if (!targetId && !baselineMobile) {
    return {
      id: null,
      full_name: baselineName || 'Store Owner',
      mobile: null,
      email: null,
      address: null,
    };
  }

  const cacheKey = String(targetId || baselineMobile);
  if (sellerContactCache.has(cacheKey)) {
    const cached = sellerContactCache.get(cacheKey);
    if (cached && (cached.mobile || baselineMobile)) {
      return {
        ...cached,
        mobile: cached.mobile || baselineMobile,
        full_name: cached.full_name || baselineName || 'Store Owner',
      };
    }
  }

  let contact = {
    id: targetId || null,
    full_name: baselineName || 'Store Owner',
    mobile: baselineMobile,
    email: fallbackSeller?.email || null,
    address: fallbackSeller?.address || fallbackSeller?.city || null,
  };

  // 1. Check profiles table
  if (targetId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, mobile, email, address_line_1, city, avatar_url')
        .eq('id', targetId)
        .maybeSingle();

      if (!error && data) {
        if (data.mobile) contact.mobile = data.mobile;
        if (data.full_name) contact.full_name = data.full_name;
        if (data.email) contact.email = data.email;
        if (data.city || data.address_line_1) {
          contact.address = [data.address_line_1, data.city].filter(Boolean).join(', ');
        }
        if (data.avatar_url) contact.avatar_url = data.avatar_url;

        if (contact.mobile) {
          sellerContactCache.set(cacheKey, contact);
          return contact;
        }
      }
    } catch (e) {
      console.warn('[sellerContactService] profiles fetch notice:', e.message);
    }
  }

  // 2. Check users table
  if (targetId) {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, name, mobile, email, profile_photo_data')
        .eq('id', targetId)
        .maybeSingle();

      if (!userError && userData) {
        if (userData.mobile && !contact.mobile) contact.mobile = userData.mobile;
        if (userData.name && (!contact.full_name || contact.full_name === 'Store Owner')) {
          contact.full_name = userData.name;
        }
        if (userData.email && !contact.email) contact.email = userData.email;
        if (userData.profile_photo_data) contact.avatar_url = userData.profile_photo_data;

        if (contact.mobile) {
          sellerContactCache.set(cacheKey, contact);
          return contact;
        }
      }
    } catch (e) {
      console.warn('[sellerContactService] users fetch notice:', e.message);
    }
  }

  // 3. Check customers table by ID or user_id
  const lookupCustomerId = customerId || product?.customer_id || targetId;
  if (lookupCustomerId) {
    try {
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id, name, mobile, email, address')
        .or(`id.eq.${lookupCustomerId},user_id.eq.${lookupCustomerId}`)
        .maybeSingle();

      if (!custErr && custData) {
        if (custData.mobile && !contact.mobile) contact.mobile = custData.mobile;
        if (custData.name && (!contact.full_name || contact.full_name === 'Store Owner')) {
          contact.full_name = custData.name;
        }
        if (custData.email && !contact.email) contact.email = custData.email;
        if (custData.address && !contact.address) contact.address = custData.address;

        if (contact.mobile) {
          sellerContactCache.set(cacheKey, contact);
          return contact;
        }
      }
    } catch (e) {
      console.warn('[sellerContactService] customers fetch notice:', e.message);
    }
  }

  // Save to cache even if partial to avoid repeated failing network hits
  sellerContactCache.set(cacheKey, contact);
  return contact;
}

/**
 * Batch pre-fetch seller contacts for an array of seller/user IDs.
 * Called when Catalog loads to make seller contacts available instantly with 0ms delay.
 */
export async function batchFetchSellerContacts(sellerIds = []) {
  if (!Array.isArray(sellerIds) || sellerIds.length === 0) return {};
  const uniqueIds = [...new Set(sellerIds.filter(Boolean))];
  const missingIds = uniqueIds.filter(id => !sellerContactCache.has(String(id)));

  if (missingIds.length === 0) {
    const res = {};
    uniqueIds.forEach(id => res[id] = sellerContactCache.get(String(id)));
    return res;
  }

  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, mobile, email, address_line_1, city, avatar_url')
      .in('id', missingIds);

    if (!error && Array.isArray(profiles)) {
      profiles.forEach(p => {
        const contact = {
          id: p.id,
          full_name: p.full_name || 'Store Owner',
          mobile: p.mobile || null,
          email: p.email || null,
          address: [p.address_line_1, p.city].filter(Boolean).join(', '),
          avatar_url: p.avatar_url || null,
        };
        sellerContactCache.set(String(p.id), contact);
      });
    }
  } catch (err) {
    console.warn('[sellerContactService] batchFetchSellerContacts notice:', err.message);
  }

  const result = {};
  uniqueIds.forEach(id => {
    if (sellerContactCache.has(String(id))) {
      result[id] = sellerContactCache.get(String(id));
    }
  });
  return result;
}

/**
 * Point 1: Direct Mobile Phone Call
 */
export async function makeSellerCall(mobile) {
  const clean = cleanPhoneNumber(mobile);
  if (!clean) {
    throw new Error('Seller mobile number is not available');
  }
  const url = `tel:${clean}`;
  const supported = await Linking.canOpenURL(url).catch(() => true);
  if (supported) {
    return Linking.openURL(url);
  } else {
    throw new Error('Calling is not supported on this device');
  }
}

/**
 * Point 2: Message / SMS
 */
export async function sendSellerSms(mobile, { productName = '', productPrice = '', storeName = '' } = {}) {
  const clean = cleanPhoneNumber(mobile);
  if (!clean) {
    throw new Error('Seller mobile number is not available');
  }
  let bodyText = `Hello`;
  if (storeName) bodyText += ` ${storeName}`;
  if (productName) bodyText += `, I am interested in "${productName}"`;
  if (productPrice) bodyText += ` (₹${productPrice})`;
  bodyText += `. Is this available?`;

  const separator = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${clean}${separator}body=${encodeURIComponent(bodyText)}`;
  return Linking.openURL(url);
}

/**
 * Point 3: WhatsApp Call / Chat
 * WhatsApp allows direct messaging and initiates direct voice/video calls inside the chat
 */
export async function openSellerWhatsApp(mobile, { productName = '', productPrice = '', storeName = '', directCall = false } = {}) {
  const waNumber = formatWhatsAppNumber(mobile);
  if (!waNumber) {
    throw new Error('Seller mobile number is not available for WhatsApp');
  }
  let message = `Hello`;
  if (storeName) message += ` ${storeName}`;
  message += `! I would like to inquire about`;
  if (productName) {
    message += ` "${productName}"`;
  } else {
    message += ` your products`;
  }
  if (productPrice) {
    message += ` (Price: ₹${productPrice})`;
  }
  message += `. Please provide more details.`;

  // Standard universal WhatsApp deep link
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
  return Linking.openURL(url);
}

/**
 * Point 4: Share Product Details
 */
export async function shareProductDetails({ product, sellerContact = null, storeName = '' }) {
  if (!product) return;
  const name = product.product_name || product.name || 'Product';
  const price = product.amount || product.price || '';
  const seller = sellerContact?.full_name || storeName || 'Store';
  const phone = sellerContact?.mobile || '';

  let baseUrl = 'https://narasimhareddyaiapp2-localwala.github.io/needsTracking';
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
  }

  const sellerParam = sellerContact?.id ? `&sellerId=${encodeURIComponent(sellerContact.id)}` : '';
  const productParam = product.id ? `&productId=${encodeURIComponent(product.id)}` : '';
  const shareUrl = `${baseUrl}/?direct=true${sellerParam}${productParam}`;

  const message = [
    `🛍️ *${name}*`,
    price ? `💰 Price: ₹${price}` : '',
    seller ? `🏬 Seller: ${seller}` : '',
    phone ? `📞 Contact: ${phone}` : '',
    `🔗 View product: ${shareUrl}`,
  ].filter(Boolean).join('\n');

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: name,
        text: message,
        url: shareUrl,
      });
      return;
    } catch (_) {}
  }

  return Share.share({
    title: name,
    message: `${message}\n${shareUrl}`,
    url: shareUrl,
  });
}
