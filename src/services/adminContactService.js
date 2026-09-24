import { Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { showAlert } from '../utils/alertUtils';

// Default Admin Contact details (fallback when DB record mobile is null or unconfigured)
export const DEFAULT_ADMIN_CONFIG = {
  mobile: '9849535153',
  displayMobile: '+91 98495 35153',
  name: 'Narasimha Reddy',
  role: 'Platform Admin',
  email: 'narasimhareddyprocess@gmail.com',
  company: 'NeedsTracker Platform',
  tagline: 'Transform & Digitalize Your Business Setup • Book Free Live Demo',
};

// In-memory cache for fast zero-delay synchronous access across all components
let cachedAdminContact = {
  id: '0f4611de-7b02-4212-a1ea-4ea9f3c22620',
  full_name: DEFAULT_ADMIN_CONFIG.name,
  mobile: DEFAULT_ADMIN_CONFIG.mobile,
  displayMobile: DEFAULT_ADMIN_CONFIG.displayMobile,
  email: DEFAULT_ADMIN_CONFIG.email,
  role: 'admin',
  avatar_url: null,
};

let hasFetchedFromDb = false;

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
 * Defaults to 91 (India) if 10 digits are provided.
 */
export function formatWhatsAppNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/**
 * Formats phone number for pretty UI display: e.g. +91 98495 35153
 */
export function formatDisplayMobile(phone) {
  if (!phone) return DEFAULT_ADMIN_CONFIG.displayMobile;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return String(phone);
}

/**
 * Synchronous getter for Admin Contact Info (returns cached immediately without blocking UI)
 */
export function getAdminContactSync() {
  const envMobile =
    Constants?.expoConfig?.extra?.ADMIN_MOBILE ||
    process.env.EXPO_PUBLIC_ADMIN_MOBILE ||
    null;

  const mobile = cachedAdminContact.mobile || envMobile || DEFAULT_ADMIN_CONFIG.mobile;

  return {
    ...cachedAdminContact,
    mobile,
    displayMobile: formatDisplayMobile(mobile),
    cleanMobile: cleanPhoneNumber(mobile),
    waNumber: formatWhatsAppNumber(mobile),
  };
}

/**
 * Asynchronously fetches and caches verified admin contact details from Supabase.
 */
export async function getAdminContactInfo(forceRefresh = false) {
  if (hasFetchedFromDb && !forceRefresh && cachedAdminContact.mobile) {
    return getAdminContactSync();
  }

  const envMobile =
    Constants?.expoConfig?.extra?.ADMIN_MOBILE ||
    process.env.EXPO_PUBLIC_ADMIN_MOBILE ||
    null;

  try {
    // 1. Check profiles table for admin / superadmin / appadmin
    const { data: adminProfiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, mobile, email, avatar_url, role')
      .in('role', ['admin', 'superadmin', 'appadmin', 'app_admin']);

    if (!profErr && Array.isArray(adminProfiles) && adminProfiles.length > 0) {
      // Find one that has mobile, or take the first one
      const withMobile = adminProfiles.find(p => p && p.mobile && String(p.mobile).trim().length >= 10);
      const activeAdmin = withMobile || adminProfiles[0];

      if (activeAdmin) {
        let avatarUrl = activeAdmin.avatar_url;
        let adminFullName = activeAdmin.full_name || DEFAULT_ADMIN_CONFIG.name;
        const effectiveMobile =
          activeAdmin.mobile ||
          envMobile ||
          DEFAULT_ADMIN_CONFIG.mobile;

        if (!avatarUrl) {
          try {
            const { data: matchedProfile } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('mobile', effectiveMobile)
              .not('avatar_url', 'is', null)
              .limit(1)
              .maybeSingle();

            if (matchedProfile?.avatar_url) {
              avatarUrl = matchedProfile.avatar_url;
              if ((!activeAdmin.full_name || activeAdmin.full_name.toLowerCase() === 'admin') && matchedProfile.full_name) {
                adminFullName = matchedProfile.full_name;
              }
            }
          } catch (_) {}
        }

        cachedAdminContact = {
          id: activeAdmin.id,
          full_name: adminFullName,
          mobile: effectiveMobile,
          displayMobile: formatDisplayMobile(effectiveMobile),
          email: activeAdmin.email || DEFAULT_ADMIN_CONFIG.email,
          role: activeAdmin.role || 'admin',
          avatar_url: avatarUrl || null,
        };

        hasFetchedFromDb = true;
        return getAdminContactSync();
      }
    }

    // 2. Check users table if profiles didn't return
    const { data: adminUsers, error: userErr } = await supabase
      .from('users')
      .select('id, name, mobile, email, profile_photo_data, user_type')
      .in('user_type', ['admin', 'superadmin', 'appadmin', 'app_admin']);

    if (!userErr && Array.isArray(adminUsers) && adminUsers.length > 0) {
      const withMobile = adminUsers.find(u => u && u.mobile && String(u.mobile).trim().length >= 10);
      const activeUser = withMobile || adminUsers[0];

      if (activeUser) {
        const effectiveMobile =
          activeUser.mobile ||
          envMobile ||
          DEFAULT_ADMIN_CONFIG.mobile;

        cachedAdminContact = {
          id: activeUser.id,
          full_name: activeUser.name || DEFAULT_ADMIN_CONFIG.name,
          mobile: effectiveMobile,
          displayMobile: formatDisplayMobile(effectiveMobile),
          email: activeUser.email || DEFAULT_ADMIN_CONFIG.email,
          role: activeUser.user_type || 'admin',
          avatar_url: activeUser.profile_photo_data || null,
        };

        hasFetchedFromDb = true;
        return getAdminContactSync();
      }
    }
  } catch (err) {
    console.warn('[adminContactService] Notice fetching admin contact:', err.message);
  }

  // Fallback if network or DB returns empty
  cachedAdminContact.mobile = envMobile || DEFAULT_ADMIN_CONFIG.mobile;
  cachedAdminContact.displayMobile = formatDisplayMobile(cachedAdminContact.mobile);
  hasFetchedFromDb = true;
  return getAdminContactSync();
}

/**
 * 1. Open WhatsApp Chat / Inquiry to Admin
 */
export async function openAdminWhatsApp(customMessage = '') {
  const admin = getAdminContactSync();
  const waNumber = admin.waNumber;

  if (!waNumber) {
    showAlert('Contact Error', 'Admin contact number is unavailable for WhatsApp.');
    return;
  }

  const defaultMsg =
    'Hello Admin, I am interested in digitalizing my business setup and booking a live demo on NeedsTracker.';
  const message = (customMessage && typeof customMessage === 'string' && customMessage.trim()) ? customMessage.trim() : defaultMsg;

  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  try {
    const supported = await Linking.canOpenURL(url).catch(() => true);
    if (supported) {
      await Linking.openURL(url);
    } else {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        showAlert('WhatsApp Error', 'Could not open WhatsApp on this device.');
      }
    }
  } catch (err) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      showAlert('WhatsApp Notice', `Reach admin at WhatsApp: ${admin.displayMobile}`);
    }
  }
}

/**
 * 2. Direct Mobile Call to Admin
 */
export async function callAdmin() {
  const admin = getAdminContactSync();
  const clean = cleanPhoneNumber(admin.mobile);

  if (!clean) {
    showAlert('Contact Error', 'Admin phone number is not available.');
    return;
  }

  const url = `tel:${clean}`;

  try {
    const supported = await Linking.canOpenURL(url).catch(() => true);
    if (supported) {
      await Linking.openURL(url);
    } else {
      // Desktop web / emulator fallback
      try {
        await Clipboard.setStringAsync(clean);
        showAlert(
          'Admin Contact Number',
          `Admin Phone: ${admin.displayMobile}\n(Copied to clipboard. Call from your mobile phone.)`
        );
      } catch (_) {
        showAlert('Admin Contact', `Admin Phone: ${admin.displayMobile}`);
      }
    }
  } catch (err) {
    try {
      await Clipboard.setStringAsync(clean);
      showAlert(
        'Admin Contact Number',
        `Admin Phone: ${admin.displayMobile}\n(Copied to clipboard)`
      );
    } catch (_) {
      showAlert('Admin Contact', `Admin Phone: ${admin.displayMobile}`);
    }
  }
}

/**
 * 3. Mobile SMS to Admin
 */
export async function sendAdminSms(customMessage = '') {
  const admin = getAdminContactSync();
  const clean = cleanPhoneNumber(admin.mobile);

  if (!clean) {
    showAlert('Contact Error', 'Admin phone number is not available.');
    return;
  }

  const defaultMsg =
    'Hello Admin, I would like to get my business setup digitalized on NeedsTracker or request a demo.';
  const message = (customMessage && typeof customMessage === 'string' && customMessage.trim()) ? customMessage.trim() : defaultMsg;

  const separator = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${clean}${separator}body=${encodeURIComponent(message)}`;

  try {
    const supported = await Linking.canOpenURL(url).catch(() => true);
    if (supported) {
      await Linking.openURL(url);
    } else {
      try {
        await Clipboard.setStringAsync(clean);
        showAlert(
          'Admin Contact Number',
          `Admin SMS Number: ${admin.displayMobile}\n(Copied to clipboard)`
        );
      } catch (_) {
        showAlert('Admin Contact', `Admin SMS Number: ${admin.displayMobile}`);
      }
    }
  } catch (err) {
    showAlert('SMS Notice', `Send SMS to Admin at: ${admin.displayMobile}`);
  }
}

/**
 * 4. Facebook Share
 * Shares the digital business setup & platform demo link directly on Facebook.
 */
export async function shareToFacebook({ shareUrl = '', customQuote = '' } = {}) {
  const admin = getAdminContactSync();

  let targetUrl = shareUrl;
  if (!targetUrl) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
      targetUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
    } else {
      targetUrl = 'https://narasimhareddyaiapp2-localwala.github.io/needsTracking';
    }
  }

  const quote =
    customQuote ||
    `🚀 Transform & Digitalize Your Business with NeedsTracker! Setup online ordering, live GPS delivery tracking, and digital catalog for your store. Contact Admin for a free live demo: ${admin.displayMobile}`;

  const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(targetUrl)}&quote=${encodeURIComponent(quote)}`;

  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(fbShareUrl, '_blank', 'noopener,noreferrer,width=626,height=436');
      return;
    }

    const supported = await Linking.canOpenURL(fbShareUrl).catch(() => true);
    if (supported) {
      await Linking.openURL(fbShareUrl);
    } else {
      // Native Share fallback
      await Share.share({
        title: 'Digitalize Your Business Setup • NeedsTracker',
        message: `${quote}\n${targetUrl}`,
        url: targetUrl,
      });
    }
  } catch (err) {
    try {
      await Share.share({
        title: 'Digitalize Your Business Setup • NeedsTracker',
        message: `${quote}\n${targetUrl}`,
        url: targetUrl,
      });
    } catch (_) {
      showAlert('Share Link', targetUrl);
    }
  }
}
