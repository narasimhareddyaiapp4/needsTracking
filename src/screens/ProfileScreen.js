import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  Dimensions,
  SafeAreaView,
  FlatList,
  Switch,
} from 'react-native';
import {
  supabase,
  uploadQrImage,
  addQrCode,
  updateQrCode,
  getActiveQrCode,
  uploadProfileMedia,
  setSellerProductsActiveStatus,
  setAllProductsActiveStatus,
  setSellerStoreActiveStatus,
  setAllStoresActiveStatus,
  extractStoreSettings,
  embedStoreSettings,
  extractMerchantUpi,
  embedMerchantUpi,
} from '../services/supabase';
import {
  schedulePushNotification,
  registerForPushNotificationsAsync,
  getWebNotificationPermission,
  requestWebNotificationPermission,
  isWebNotificationSupported,
} from '../services/notificationService';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import PrinterSettingsModal from '../components/PrinterSettingsModal';
import {
  getPrinterConfig,
  savePrinterConfig,
  DEFAULT_PRINTER_CONFIG,
} from '../services/printerService';
import { showAlert } from '../utils/alertUtils';
import { FontAwesome as Icon } from '@expo/vector-icons';
import {
  getVoiceSettings,
  saveVoiceSettings,
  testVoiceAnnouncement,
} from '../services/speechService';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import { useTheme } from '../context/ThemeContext';
import { getActiveEmployeeSession } from '../services/employeeService';
import { decodeQrFromImage, parseUpiString, normalizeUpiId, isGenericQrName } from '../services/qrScanService';

const MAX_IMAGES = 3;
const MAX_VIDEOS = 1;
const MAX_VIDEO_SIZE_MB = 50;

const ProfileScreen = ({ navigation, route }) => {
  const { themeMode, setThemeMode, colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [printerConfig, setPrinterConfig] = useState(DEFAULT_PRINTER_CONFIG);
  const [markerLocation, setMarkerLocation] = useState(null);
  const [mapInitialRegion, setMapInitialRegion] = useState(null);
  const [upiQrCodeUrl, setUpiQrCodeUrl] = useState(null);
  const [upiId, setUpiId] = useState('');
  const [savingUpiId, setSavingUpiId] = useState(false);
  const [scanningQr, setScanningQr] = useState(false);
  const [qrSourceInfo, setQrSourceInfo] = useState('');
  const [showManualUpiEdit, setShowManualUpiEdit] = useState(false);

  // Map Area Search & Location Picker State
  const mapRef = useRef(null);
  const debounceSearchTimer = useRef(null);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const [mapSearchSuggestions, setMapSearchSuggestions] = useState([]);
  const [selectedAreaInfo, setSelectedAreaInfo] = useState(null);
  const [autoFillAddress, setAutoFillAddress] = useState(true);

  // Profile media state: array of { uri: string, type: 'image' | 'video', isNew?: boolean }
  const [mediaList, setMediaList] = useState([]);
  const [showMediaViewer, setShowMediaViewer] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [viewerCustomMedia, setViewerCustomMedia] = useState(null);

  const imageCount = mediaList.filter((m) => m.type === 'image').length;
  const videoCount = mediaList.filter((m) => m.type === 'video').length;

  // Store & Product Active Visibility Controls (Seller & AppAdmin)
  // By default, sellers are inactive (false) until explicitly activated
  const [isStoreActive, setIsStoreActive] = useState(false);
  const [isMapActive, setIsMapActive] = useState(false);
  const [isProductViewActive, setIsProductViewActive] = useState(false);
  const [sellerProducts, setSellerProducts] = useState([]);
  const [productStats, setProductStats] = useState({ total: 0, active: 0 });
  const [togglingStatus, setTogglingStatus] = useState(false);

  // AppAdmin / Superadmin Multi-User Controls State
  const [adminSellersList, setAdminSellersList] = useState([]);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminGlobalStoreActive, setAdminGlobalStoreActive] = useState(false);
  const [adminGlobalProductsActive, setAdminGlobalProductsActive] = useState(false);

  // Voice Announcement Settings State (Male / Female)
  const [voiceGender, setVoiceGender] = useState('female');
  const [testingVoice, setTestingVoice] = useState(false);

  // Delivery Partner Fee & Free Delivery Threshold Settings
  const [enableDelivery, setEnableDelivery] = useState(true);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState('30');
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState('200');
  const [deliveryPartnerType, setDeliveryPartnerType] = useState('platform');

  // Web Notification Permission State
  const [webNotifPermission, setWebNotifPermission] = useState(
    Platform.OS === 'web' ? getWebNotificationPermission() : 'n/a'
  );

  const handleEnableWebNotifications = async () => {
    try {
      const perm = await requestWebNotificationPermission();
      setWebNotifPermission(perm);
      if (perm === 'granted') {
        showAlert('✅ Notifications Enabled', 'Browser notifications are now active. You will receive live alerts for orders and updates.');
        await schedulePushNotification('🔔 Notifications Active!', 'You will now receive instant order updates on this device.');
      } else if (perm === 'denied') {
        showAlert('❌ Permission Denied', 'Notifications were blocked in your browser. Please click the site settings or lock icon in your address bar to allow notifications.');
      }
    } catch (err) {
      console.warn('Error enabling web notifications:', err);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      if (Platform.OS === 'web' && webNotifPermission !== 'granted') {
        const perm = await requestWebNotificationPermission();
        setWebNotifPermission(perm);
      }
      await schedulePushNotification(
        '🔔 Test Order Notification',
        'This is a real-time notification message test! Web and mobile notifications are working.'
      );
    } catch (err) {
      console.warn('Send test notification error:', err);
    }
  };

  useEffect(() => {
    fetchProfile();
    loadVoicePreference();
    loadPrinterSettings();
    if (Platform.OS === 'web') {
      setWebNotifPermission(getWebNotificationPermission());
    }
  }, []);

  const loadPrinterSettings = async () => {
    try {
      const cfg = await getPrinterConfig();
      if (cfg) {
        setPrinterConfig(cfg);
      }
    } catch (err) {
      console.warn('Error loading printer settings in profile:', err);
    }
  };

  const handleTogglePrintHeader = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), printHeader: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      showAlert(
        'Receipt Header Updated',
        val
          ? 'Receipt Header (Store Name, Address, GSTIN) will be printed.'
          : 'Receipt Header is turned OFF (uncheck) to save paper.'
      );
    } catch (err) {
      console.warn('Error updating printHeader:', err);
    }
  };

  const handleToggleDayWiseNumber = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), printDayWiseNumber: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      showAlert(
        'Day-wise Order Number',
        val
          ? 'Day-wise Order Number (Token #) is now REQUIRED and will appear on receipts.'
          : 'Day-wise Order Number is now turned off on receipts.'
      );
    } catch (err) {
      console.warn('Error updating printDayWiseNumber:', err);
    }
  };

  const handleTogglePrintDynamicQr = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), printDynamicQr: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      syncTaxSettingsToAuth(updated);
      if (profile?.id) {
        try {
          await supabase.from('profiles').update({ print_qr_on_receipt: val }).eq('id', profile.id);
        } catch (_) {}
      }
      showAlert(
        'Dynamic QR on Receipt Updated',
        val
          ? 'Dynamic Payment QR Code with exact bill price will now be printed on receipts.'
          : 'Payment QR Code is turned OFF on printed receipts.'
      );
    } catch (err) {
      console.warn('Error updating printDynamicQr in profile:', err);
    }
  };

  const handleTogglePrintOrderBarcode = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), printOrderBarcode: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      showAlert(
        'Order Barcode Updated',
        val
          ? 'Scannable Code-128 order barcode will now appear on receipts for mobile phone cameras & scanners.'
          : 'Order barcode is turned OFF on receipts.'
      );
    } catch (err) {
      console.warn('Error updating printOrderBarcode in profile:', err);
    }
  };

  const handleSelectQrCodeSize = async (size) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), qrCodeSize: size };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
    } catch (err) {
      console.warn('Error updating qrCodeSize in profile:', err);
    }
  };

  const syncTaxSettingsToAuth = async (cfg) => {
    try {
      await supabase.auth.updateUser({
        data: {
          tax_settings: {
            enable_tax: cfg.enableTax === true,
            cgst_rate: cfg.cgstRate !== undefined ? Number(cfg.cgstRate) : 2.5,
            sgst_rate: cfg.sgstRate !== undefined ? Number(cfg.sgstRate) : 2.5,
            enable_service_cost: cfg.enableServiceCost === true,
            service_cost_rate: cfg.serviceCostRate !== undefined ? Number(cfg.serviceCostRate) : 0,
            print_tax_breakdown: cfg.printTaxBreakdown !== false,
            print_qr_on_receipt: cfg.printDynamicQr !== false,
          },
        },
      });
    } catch (_) {}
  };

  const handleToggleTax = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), enableTax: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      syncTaxSettingsToAuth(updated);
      if (profile?.id) {
        try {
          await supabase.from('profiles').update({ enable_tax: val }).eq('id', profile.id);
        } catch (_) {}
      }
      showAlert(
        'GST Setting Updated',
        val
          ? 'GST (CGST + SGST) will be applied to billing and receipts.'
          : 'GST calculation turned OFF.'
      );
    } catch (err) {
      console.warn('Error updating enableTax:', err);
    }
  };

  const handleUpdateCgstRate = async (val) => {
    const clean = String(val).replace(/[^0-9.]/g, '');
    const rate = clean === '' ? 0 : Number(clean);
    const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), cgstRate: rate };
    setPrinterConfig(updated);
    await savePrinterConfig(updated);
    syncTaxSettingsToAuth(updated);
    if (profile?.id) {
      try {
        await supabase.from('profiles').update({ cgst_rate: rate }).eq('id', profile.id);
      } catch (_) {}
    }
  };

  const handleUpdateSgstRate = async (val) => {
    const clean = String(val).replace(/[^0-9.]/g, '');
    const rate = clean === '' ? 0 : Number(clean);
    const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), sgstRate: rate };
    setPrinterConfig(updated);
    await savePrinterConfig(updated);
    syncTaxSettingsToAuth(updated);
    if (profile?.id) {
      try {
        await supabase.from('profiles').update({ sgst_rate: rate }).eq('id', profile.id);
      } catch (_) {}
    }
  };

  const handleToggleServiceCost = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), enableServiceCost: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      syncTaxSettingsToAuth(updated);
      if (profile?.id) {
        try {
          await supabase.from('profiles').update({ enable_service_cost: val }).eq('id', profile.id);
        } catch (_) {}
      }
      showAlert(
        'Service Charge Updated',
        val
          ? 'Service Charge percentage will be added to billing and receipts.'
          : 'Service Charge turned OFF.'
      );
    } catch (err) {
      console.warn('Error updating enableServiceCost:', err);
    }
  };

  const handleUpdateServiceCostRate = async (val) => {
    const clean = String(val).replace(/[^0-9.]/g, '');
    const rate = clean === '' ? 0 : Number(clean);
    const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), serviceCostRate: rate };
    setPrinterConfig(updated);
    await savePrinterConfig(updated);
    syncTaxSettingsToAuth(updated);
    if (profile?.id) {
      try {
        await supabase.from('profiles').update({ service_cost_rate: rate }).eq('id', profile.id);
      } catch (_) {}
    }
  };

  const handleTogglePrintTaxBreakdown = async (val) => {
    try {
      const updated = { ...(printerConfig || DEFAULT_PRINTER_CONFIG), printTaxBreakdown: val };
      setPrinterConfig(updated);
      await savePrinterConfig(updated);
      syncTaxSettingsToAuth(updated);
      if (profile?.id) {
        try {
          await supabase.from('profiles').update({ print_tax_breakdown: val }).eq('id', profile.id);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('Error updating printTaxBreakdown:', err);
    }
  };

  const loadVoicePreference = async () => {
    try {
      const v = await getVoiceSettings();
      if (v?.gender) {
        setVoiceGender(v.gender);
      }
    } catch (_) {}
  };

  const handleSelectVoiceGender = async (gender) => {
    try {
      setVoiceGender(gender);
      await saveVoiceSettings({ gender });
      showAlert('Voice Updated', `${gender === 'male' ? 'Male' : 'Female'} voice set for order announcements.`);
    } catch (err) {
      console.warn('Error saving voice preference:', err);
    }
  };

  const handleTestVoice = async () => {
    setTestingVoice(true);
    try {
      await testVoiceAnnouncement(voiceGender);
    } catch (err) {
      console.warn('Test voice error:', err);
    } finally {
      setTimeout(() => setTestingVoice(false), 1400);
    }
  };

  const handleSelectTheme = async (mode) => {
    try {
      await setThemeMode(mode);
      const modeLabel = mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'System Default';
      showAlert('Theme Updated', `Theme set to ${modeLabel}.`);
    } catch (err) {
      console.warn('Error updating theme mode:', err);
    }
  };

  useEffect(() => {
    const handleNotifications = async () => {
      if (profile?.id) {
        const token = await registerForPushNotificationsAsync();
        if (token) {
          try {
            await supabase.from('push_tokens').upsert(
              { user_id: profile.id, token: token },
              { onConflict: 'token' }
            );
          } catch (e) {
            console.warn('Push token upsert notice:', e);
          }
          if (token !== profile.push_token) {
            try {
              await supabase
                .from('profiles')
                .update({ push_token: token })
                .eq('id', profile.id);
            } catch (_) {}
          }
        }
      }
    };
    handleNotifications();
  }, [profile?.id]);

  const fetchAdminSellersList = async () => {
    setAdminLoading(true);
    try {
      const { data: profs, error: profsErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, mobile, role, city, address_line_1, media_urls');

      if (profsErr) {
        console.warn('Admin profs error:', profsErr.message);
      }

      let allProds = [];
      try {
        const { data: pData } = await supabase
          .from('products')
          .select('id, user_id, customer_id, product_name, is_active');
        if (pData && Array.isArray(pData)) {
          allProds = pData;
        }
      } catch (pErr) {
        console.warn('Admin prods error:', pErr.message);
      }

      const prodMap = {};
      allProds.forEach((p) => {
        const uId = p.user_id || p.customer_id;
        if (uId) {
          if (!prodMap[uId]) prodMap[uId] = { total: 0, active: 0 };
          prodMap[uId].total += 1;
          if (p.is_active === true) prodMap[uId].active += 1;
        }
      });

      const sellers = (profs || [])
        .filter((p) => {
          const r = (p.role || '').toLowerCase();
          return r === 'seller' || r === 'admin' || r === 'superadmin' || r === 'appadmin' || r === 'app_admin' || (prodMap[p.id] && prodMap[p.id].total > 0);
        })
        .map((p) => {
          const st = extractStoreSettings(p.media_urls);
          const pStat = prodMap[p.id] || { total: 0, active: 0 };
          return {
            id: p.id,
            full_name: p.full_name || p.email?.split('@')[0] || 'Store',
            email: p.email || '',
            mobile: p.mobile || '',
            role: p.role || 'seller',
            city: p.city || p.address_line_1 || 'Local Store',
            media_urls: p.media_urls,
            is_store_active: st.is_store_active === true,
            is_map_active: st.is_map_active === true,
            is_product_active: pStat.total > 0 ? pStat.active > 0 : st.is_product_active === true,
            productCount: pStat.total,
            activeProductCount: pStat.active,
          };
        });

      setAdminSellersList(sellers);
    } catch (err) {
      console.error('Error fetching admin sellers list:', err);
    } finally {
      setAdminLoading(false);
    }
  };

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user || null);

      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error fetching profile:', error.message);
          showAlert('Error', 'Failed to fetch profile.');
        } else if (data) {
          setProfile(data);
          setName(data.full_name || user.user_metadata?.full_name || user.user_metadata?.name || '');
          setEmail(data.email || user.email || '');
          setMobile(data.mobile || user.user_metadata?.mobile || user.user_metadata?.phone || '');
          setAddressLine1(data.address_line_1 || user.user_metadata?.address_line_1 || user.user_metadata?.address || '');
          setAddressLine2(data.address_line_2 || user.user_metadata?.address_line_2 || '');
          setCity(data.city || user.user_metadata?.city || '');
          setState(data.state || user.user_metadata?.state || '');
          setZipCode(data.zip_code || user.user_metadata?.zip_code || user.user_metadata?.postal_code || '');
          const lat = data.latitude != null && !isNaN(Number(data.latitude)) ? Number(data.latitude) : (user.user_metadata?.latitude != null && !isNaN(Number(user.user_metadata.latitude)) ? Number(user.user_metadata.latitude) : null);
          const lon = data.longitude != null && !isNaN(Number(data.longitude)) ? Number(data.longitude) : (user.user_metadata?.longitude != null && !isNaN(Number(user.user_metadata.longitude)) ? Number(user.user_metadata.longitude) : null);
          setLatitude(lat);
          setLongitude(lon);
          if (lat != null && lon != null) {
            setMapInitialRegion({ latitude: lat, longitude: lon });
            setMarkerLocation({ latitude: lat, longitude: lon });
          }

          // Sync Tax & Service Charge Settings from profile data or user metadata
          const metaTax = user.user_metadata?.tax_settings || {};
          const syncedTaxConfig = {
            enableTax: data.enable_tax !== undefined && data.enable_tax !== null ? Boolean(data.enable_tax) : (metaTax.enable_tax !== undefined ? Boolean(metaTax.enable_tax) : undefined),
            cgstRate: data.cgst_rate !== undefined && data.cgst_rate !== null ? Number(data.cgst_rate) : (metaTax.cgst_rate !== undefined ? Number(metaTax.cgst_rate) : undefined),
            sgstRate: data.sgst_rate !== undefined && data.sgst_rate !== null ? Number(data.sgst_rate) : (metaTax.sgst_rate !== undefined ? Number(metaTax.sgst_rate) : undefined),
            enableServiceCost: data.enable_service_cost !== undefined && data.enable_service_cost !== null ? Boolean(data.enable_service_cost) : (metaTax.enable_service_cost !== undefined ? Boolean(metaTax.enable_service_cost) : undefined),
            serviceCostRate: data.service_cost_rate !== undefined && data.service_cost_rate !== null ? Number(data.service_cost_rate) : (metaTax.service_cost_rate !== undefined ? Number(metaTax.service_cost_rate) : undefined),
            printTaxBreakdown: data.print_tax_breakdown !== undefined && data.print_tax_breakdown !== null ? Boolean(data.print_tax_breakdown) : (metaTax.print_tax_breakdown !== undefined ? Boolean(metaTax.print_tax_breakdown) : undefined),
            printDynamicQr: data.print_qr_on_receipt !== undefined && data.print_qr_on_receipt !== null ? Boolean(data.print_qr_on_receipt) : (metaTax.print_qr_on_receipt !== undefined ? Boolean(metaTax.print_qr_on_receipt) : undefined),
          };
          const cleanSynced = Object.fromEntries(Object.entries(syncedTaxConfig).filter(([_, v]) => v !== undefined));
          if (Object.keys(cleanSynced).length > 0) {
            getPrinterConfig().then((cfg) => {
              const merged = { ...cfg, ...cleanSynced };
              setPrinterConfig(merged);
              savePrinterConfig(merged);
            });
          }

          if (data.enable_delivery !== undefined && data.enable_delivery !== null) {
            setEnableDelivery(Boolean(data.enable_delivery));
          }
          if (data.default_delivery_fee !== undefined && data.default_delivery_fee !== null) {
            setDefaultDeliveryFee(String(data.default_delivery_fee));
          }
          if (data.free_delivery_threshold !== undefined && data.free_delivery_threshold !== null) {
            setFreeDeliveryThreshold(String(data.free_delivery_threshold));
          }
          if (data.delivery_partner_type) {
            setDeliveryPartnerType(data.delivery_partner_type);
          }

          // Extract Store & Product Active Settings
          let storeSettings = extractStoreSettings(data.media_urls);
          const hasSettingsInMedia = Array.isArray(data.media_urls)
            ? data.media_urls.some((m) => m && m.type === 'store_settings')
            : (typeof data.media_urls === 'string' && data.media_urls.includes('store_settings'));
          if (!hasSettingsInMedia && user.user_metadata?.store_settings) {
            storeSettings = extractStoreSettings(user.user_metadata.store_settings);
          }
          setIsStoreActive(storeSettings.is_store_active);
          setIsMapActive(storeSettings.is_map_active);
          setIsProductViewActive(storeSettings.is_product_active);

          // Load profile media from user metadata or profile table (filtering out internal settings objects)
          let loadedMedia = [];
          if (user.user_metadata?.profile_media && Array.isArray(user.user_metadata.profile_media)) {
            loadedMedia = user.user_metadata.profile_media;
          } else if (data.media_urls) {
            try {
              loadedMedia = typeof data.media_urls === 'string' ? JSON.parse(data.media_urls) : data.media_urls;
            } catch (e) {
              loadedMedia = [];
            }
          } else if (data.avatar_url) {
            loadedMedia = [{ uri: data.avatar_url, type: 'image' }];
          }
          if (Array.isArray(loadedMedia)) {
            const cleanMedia = loadedMedia.filter(
              (m) => m && m.type !== 'store_settings' && m.uri && typeof m.uri === 'string' && m.uri.trim().length > 0
            );
            setMediaList(cleanMedia);
          }
        } else {
          setName(user.user_metadata?.full_name || user.user_metadata?.name || '');
          setEmail(user.email || '');
          setMobile(user.user_metadata?.mobile || user.user_metadata?.phone || '');
          setAddressLine1(user.user_metadata?.address_line_1 || user.user_metadata?.address || '');
          setAddressLine2(user.user_metadata?.address_line_2 || '');
          setCity(user.user_metadata?.city || '');
          setState(user.user_metadata?.state || '');
          setZipCode(user.user_metadata?.zip_code || user.user_metadata?.postal_code || '');
          const lat = user.user_metadata?.latitude != null && !isNaN(Number(user.user_metadata.latitude)) ? Number(user.user_metadata.latitude) : null;
          const lon = user.user_metadata?.longitude != null && !isNaN(Number(user.user_metadata.longitude)) ? Number(user.user_metadata.longitude) : null;
          setLatitude(lat);
          setLongitude(lon);
          if (lat != null && lon != null) {
            setMapInitialRegion({ latitude: lat, longitude: lon });
            setMarkerLocation({ latitude: lat, longitude: lon });
          }
          if (user.user_metadata?.store_settings) {
            const storeSettings = extractStoreSettings(user.user_metadata.store_settings);
            setIsStoreActive(storeSettings.is_store_active);
            setIsMapActive(storeSettings.is_map_active);
            setIsProductViewActive(storeSettings.is_product_active);
          }
          if (user.user_metadata?.profile_media && Array.isArray(user.user_metadata.profile_media)) {
            const cleanMedia = user.user_metadata.profile_media.filter(
              (m) => m && m.type !== 'store_settings' && m.uri && typeof m.uri === 'string' && m.uri.trim().length > 0
            );
            setMediaList(cleanMedia);
          }
        }

        // Fetch seller products and calculate active/total counts
        try {
          const { data: prods } = await supabase
            .from('products')
            .select('id, product_name, is_active, amount, product_type')
            .eq('user_id', user.id);
          if (prods && Array.isArray(prods)) {
            setSellerProducts(prods);
            const activeCount = prods.filter((p) => p.is_active === true).length;
            setProductStats({ total: prods.length, active: activeCount });
            if (prods.length > 0) {
              setIsProductViewActive(activeCount > 0);
            }
          }
        } catch (prodErr) {
          console.warn('Error loading seller products in profile:', prodErr.message);
        }

        // If user is Admin or Superadmin, fetch all sellers list
        const currentRole = (data?.role || data?.user_type || user.user_metadata?.role || user.user_metadata?.user_type || '').toLowerCase();
        if (currentRole === 'admin' || currentRole === 'superadmin' || currentRole === 'appadmin' || currentRole === 'app_admin') {
          fetchAdminSellersList();
        }

        const activeQr = await getActiveQrCode(user.id);
        const embeddedUpi = extractMerchantUpi(data?.media_urls);
        let currentUpiId =
          normalizeUpiId(data?.upi_id) ||
          normalizeUpiId(embeddedUpi) ||
          normalizeUpiId(user.user_metadata?.upi_id) ||
          '';

        if (activeQr) {
          setUpiQrCodeUrl(activeQr.qr_image_url);
          if (!currentUpiId && activeQr.name && !isGenericQrName(activeQr.name)) {
            currentUpiId = normalizeUpiId(activeQr.name) || '';
          }
          // If UPI ID is missing, scan active QR image in background to recover it
          if (!currentUpiId && activeQr.qr_image_url) {
            decodeQrFromImage(activeQr.qr_image_url)
              .then((scan) => {
                if (scan?.success && scan.upiId) {
                  const detected = normalizeUpiId(scan.upiId);
                  if (detected && !isGenericQrName(detected)) {
                    setUpiId(detected);
                    setQrSourceInfo('Scanned from QR Code');
                    setProfile((prev) => ({ ...(prev || {}), upi_id: detected }));
                    updateQrCode(activeQr.id, detected, true).catch(() => {});
                    supabase.from('profiles').update({ upi_id: detected }).eq('id', user.id).catch(() => {});
                    supabase.auth.updateUser({ data: { upi_id: detected } }).catch(() => {});
                  }
                }
              })
              .catch(() => {});
          }
        }
        if (currentUpiId && !isGenericQrName(currentUpiId)) {
          setUpiId(currentUpiId);
          setProfile((prev) => ({ ...(prev || {}), upi_id: currentUpiId }));
        }
      }
    } catch (err) {
      console.error('Error in fetchProfile:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddImage = async () => {
    if (imageCount >= MAX_IMAGES) {
      showAlert(
        'Limit Reached',
        `You can only upload up to ${MAX_IMAGES} images. Remove an existing image to add a new one.`
      );
      return;
    }

    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showAlert('Permission Denied', 'Camera roll permissions are required to select photos.');
          return;
        }
      }

      const remainingSlots = MAX_IMAGES - imageCount;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const assetsToAdd = result.assets.slice(0, remainingSlots);
        const newImages = assetsToAdd.map((asset) => ({
          uri: asset.uri,
          type: 'image',
          isNew: true,
        }));

        setMediaList((prev) => [...prev, ...newImages]);

        if (result.assets.length > remainingSlots) {
          showAlert(
            'Limit Notice',
            `Only ${remainingSlots} image(s) added as the maximum limit is ${MAX_IMAGES} images.`
          );
        }
      }
    } catch (err) {
      console.error('Error picking images:', err);
      showAlert('Error', 'Failed to pick image.');
    }
  };

  const handleAddVideo = async () => {
    if (videoCount >= MAX_VIDEOS) {
      showAlert(
        'Limit Reached',
        `You can only upload up to ${MAX_VIDEOS} video. Remove the existing video to add a new one.`
      );
      return;
    }

    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showAlert('Permission Denied', 'Camera roll permissions are required to select videos.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
          showAlert('Video Too Large', `Video exceeds maximum size of ${MAX_VIDEO_SIZE_MB}MB.`);
          return;
        }

        setMediaList((prev) => [
          ...prev,
          {
            uri: asset.uri,
            type: 'video',
            isNew: true,
          },
        ]);
      }
    } catch (err) {
      console.error('Error picking video:', err);
      showAlert('Error', 'Failed to pick video.');
    }
  };

  const handleRemoveMedia = (indexToRemove) => {
    setMediaList((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Seller toggle: Store Active (Open / Closed)
  const handleToggleMyStore = async (newVal) => {
    setIsStoreActive(newVal);
    setTogglingStatus(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await setSellerStoreActiveStatus(user.id, {
          is_store_active: newVal,
          is_map_active: isMapActive,
          is_product_active: isProductViewActive,
          existingMedia: mediaList,
        });

        setMediaList((prev) => (prev || []).filter((m) => m && m.type !== 'store_settings'));

        try {
          await supabase.auth.updateUser({
            data: {
              store_settings: {
                is_store_active: newVal,
                is_map_active: isMapActive,
                is_product_active: isProductViewActive,
              },
            },
          });
        } catch (_) {}
      }
      showAlert(
        'Store Status Updated',
        newVal
          ? '🟢 Your store is now ACTIVE and visible on the map and directory.'
          : '🔴 Your store is now INACTIVE / CLOSED. Buyers will see your store is closed.'
      );
    } catch (e) {
      console.error('Error toggling store status:', e);
      setIsStoreActive(!newVal);
      showAlert('Error', 'Failed to update store status: ' + (e.message || ''));
    } finally {
      setTogglingStatus(false);
    }
  };

  // Seller toggle: Product View Active (Activate / Deactivate All Products)
  const handleToggleMyProducts = async (newVal) => {
    setIsProductViewActive(newVal);
    setTogglingStatus(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await setSellerProductsActiveStatus(user.id, newVal);
        setSellerProducts((prev) => prev.map((p) => ({ ...p, is_active: newVal })));
        setProductStats((prev) => ({ ...prev, active: newVal ? prev.total : 0 }));

        await setSellerStoreActiveStatus(user.id, {
          is_store_active: isStoreActive,
          is_map_active: isMapActive,
          is_product_active: newVal,
          existingMedia: mediaList,
        });

        setMediaList((prev) => (prev || []).filter((m) => m && m.type !== 'store_settings'));

        try {
          await supabase.auth.updateUser({
            data: {
              store_settings: {
                is_store_active: isStoreActive,
                is_map_active: isMapActive,
                is_product_active: newVal,
              },
            },
          });
        } catch (_) {}

        showAlert(
          'Product View Updated',
          newVal
            ? `🟢 All ${productStats.total} products are now ACTIVE and visible in catalog.`
            : `🔴 All ${productStats.total} products are now INACTIVE (hidden from buyers).`
        );
      }
    } catch (e) {
      console.error('Error toggling products:', e);
      setIsProductViewActive(!newVal);
      showAlert('Error', 'Failed to update product visibility.');
    } finally {
      setTogglingStatus(false);
    }
  };

  // Seller toggle: Map Pin Visibility
  const handleToggleMyMap = async (newVal) => {
    setIsMapActive(newVal);
    setTogglingStatus(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await setSellerStoreActiveStatus(user.id, {
          is_store_active: isStoreActive,
          is_map_active: newVal,
          is_product_active: isProductViewActive,
          existingMedia: mediaList,
        });

        setMediaList((prev) => (prev || []).filter((m) => m && m.type !== 'store_settings'));

        try {
          await supabase.auth.updateUser({
            data: {
              store_settings: {
                is_store_active: isStoreActive,
                is_map_active: newVal,
                is_product_active: isProductViewActive,
              },
            },
          });
        } catch (_) {}
      }
      showAlert(
        'Map Visibility Updated',
        newVal
          ? '📍 Your store pin is now SHOWN on the interactive sellers map.'
          : '🚫 Your store pin is now HIDDEN from the interactive sellers map.'
      );
    } catch (e) {
      console.error('Error toggling map visibility:', e);
      setIsMapActive(!newVal);
    } finally {
      setTogglingStatus(false);
    }
  };

  // AppAdmin / Superadmin: Toggle single seller's store active status
  const handleAdminToggleSellerStore = async (sellerId, newVal) => {
    setAdminSellersList((prev) =>
      prev.map((s) => (s.id === sellerId ? { ...s, is_store_active: newVal === true } : s))
    );
    try {
      const targetSeller = adminSellersList.find((s) => s.id === sellerId);
      await setSellerStoreActiveStatus(sellerId, {
        is_store_active: newVal === true,
        is_map_active: targetSeller?.is_map_active === true,
        is_product_active: targetSeller?.is_product_active === true,
        existingMedia: targetSeller?.media_urls,
      });
      showAlert(
        'Admin Action',
        `Store status for "${targetSeller?.full_name || 'Seller'}" set to ${newVal ? 'Active (Open)' : 'Inactive (Closed)'}.`
      );
    } catch (err) {
      console.error('Error updating seller store by admin:', err);
    }
  };

  // AppAdmin / Superadmin: Toggle single seller's products active status
  const handleAdminToggleSellerProducts = async (sellerId, newVal) => {
    setAdminSellersList((prev) =>
      prev.map((s) =>
        s.id === sellerId
          ? { ...s, is_product_active: newVal === true, activeProductCount: newVal ? s.productCount : 0 }
          : s
      )
    );
    try {
      await setSellerProductsActiveStatus(sellerId, newVal);
      const targetSeller = adminSellersList.find((s) => s.id === sellerId);
      await setSellerStoreActiveStatus(sellerId, {
        is_store_active: targetSeller?.is_store_active === true,
        is_map_active: targetSeller?.is_map_active === true,
        is_product_active: newVal === true,
        existingMedia: targetSeller?.media_urls,
      });
      showAlert(
        'Admin Action',
        `All products for "${targetSeller?.full_name || 'Seller'}" set to ${newVal ? 'Active' : 'Inactive'}.`
      );
    } catch (err) {
      console.error('Error updating seller products by admin:', err);
    }
  };

  // AppAdmin / Superadmin: Toggle single seller's map visibility
  const handleAdminToggleSellerMap = async (sellerId, newVal) => {
    setAdminSellersList((prev) =>
      prev.map((s) => (s.id === sellerId ? { ...s, is_map_active: newVal === true } : s))
    );
    try {
      const targetSeller = adminSellersList.find((s) => s.id === sellerId);
      await setSellerStoreActiveStatus(sellerId, {
        is_store_active: targetSeller?.is_store_active === true,
        is_map_active: newVal === true,
        is_product_active: targetSeller?.is_product_active === true,
        existingMedia: targetSeller?.media_urls,
      });
      showAlert(
        'Admin Action',
        `Map visibility for "${targetSeller?.full_name || 'Seller'}" set to ${newVal ? 'Shown on Map' : 'Hidden from Map'}.`
      );
    } catch (err) {
      console.error('Error updating seller map by admin:', err);
    }
  };

  // AppAdmin / Superadmin: Global Activate / Deactivate All Stores
  const handleAdminGlobalToggleStores = async (newVal) => {
    setAdminGlobalStoreActive(newVal === true);
    setAdminSellersList((prev) =>
      prev.map((s) => ({ ...s, is_store_active: newVal === true, is_map_active: newVal === true }))
    );
    try {
      await setAllStoresActiveStatus(newVal === true, adminSellersList);
      showAlert(
        'Admin Action',
        `All stores across the platform set to ${newVal ? 'ACTIVE (Visible on Map & Directory)' : 'INACTIVE (Hidden)'}.`
      );
    } catch (e) {
      console.error('Error in global store toggle:', e);
    }
  };

  // AppAdmin / Superadmin: Global Activate / Deactivate All Products
  const handleAdminGlobalToggleProducts = async (newVal) => {
    setAdminGlobalProductsActive(newVal === true);
    setAdminSellersList((prev) =>
      prev.map((s) => ({
        ...s,
        is_product_active: newVal === true,
        activeProductCount: newVal ? s.productCount : 0,
      }))
    );
    try {
      await setAllProductsActiveStatus(newVal === true);
      showAlert(
        'Admin Action',
        `All products across all sellers set to ${newVal ? 'ACTIVE' : 'INACTIVE'}.`
      );
    } catch (e) {
      console.error('Error in global products toggle:', e);
    }
  };

  const handleUpdateProfile = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        showAlert('Error', 'No authenticated user found. Please log in again.');
        setSaving(false);
        return;
      }

      // 1. Upload any newly added media to Supabase Storage
      const finalMediaList = [];
      for (const item of mediaList) {
        if (item.type === 'store_settings') continue;
        if (item.isNew || item.uri.startsWith('file:') || item.uri.startsWith('blob:') || item.uri.startsWith('data:')) {
          const publicUrl = await uploadProfileMedia(user.id, item.uri, item.type);
          if (publicUrl) {
            finalMediaList.push({ uri: publicUrl, type: item.type });
          } else {
            console.warn('Could not upload media item to storage:', item.uri);
            finalMediaList.push({ uri: item.uri, type: item.type });
          }
        } else {
          finalMediaList.push({ uri: item.uri, type: item.type });
        }
      }

      const firstImage = finalMediaList.find((m) => m.type === 'image');
      const avatarUrl = firstImage ? firstImage.uri : (profile?.avatar_url || null);

      const trimmedName = (name || '').trim();
      const trimmedEmail = (email || '').trim();
      const trimmedMobile = (mobile || '').trim() || null;
      const parsedLat = latitude != null && !isNaN(Number(latitude)) ? Number(latitude) : null;
      const parsedLon = longitude != null && !isNaN(Number(longitude)) ? Number(longitude) : null;

      // Auto-normalize Merchant UPI ID (e.g. 9876543210 -> 9876543210@upi, storename -> storename@upi)
      const rawUpi = (upiId || '').trim();
      const normalizedUpi = normalizeUpiId(rawUpi);
      if (normalizedUpi && !isGenericQrName(normalizedUpi)) {
        setUpiId(normalizedUpi);
        setProfile((prev) => ({ ...(prev || {}), upi_id: normalizedUpi }));
      }

      const updates = {
        id: user.id,
        full_name: trimmedName,
        email: trimmedEmail || user.email || null,
        mobile: trimmedMobile,
        avatar_url: avatarUrl,
        address_line_1: (addressLine1 || '').trim(),
        address_line_2: (addressLine2 || '').trim(),
        city: (city || '').trim(),
        state: (state || '').trim(),
        zip_code: (zipCode || '').trim(),
        latitude: parsedLat,
        longitude: parsedLon,
        upi_id: normalizedUpi && !isGenericQrName(normalizedUpi) ? normalizedUpi : (profile?.upi_id || null),
        enable_tax: printerConfig?.enableTax === true,
        cgst_rate: printerConfig?.cgstRate !== undefined ? Number(printerConfig.cgstRate) : 2.5,
        sgst_rate: printerConfig?.sgstRate !== undefined ? Number(printerConfig.sgstRate) : 2.5,
        enable_service_cost: printerConfig?.enableServiceCost === true,
        service_cost_rate: printerConfig?.serviceCostRate !== undefined ? Number(printerConfig.serviceCostRate) : 0,
        print_tax_breakdown: printerConfig?.printTaxBreakdown !== false,
        enable_delivery: enableDelivery,
        default_delivery_fee: !isNaN(parseFloat(defaultDeliveryFee)) ? parseFloat(defaultDeliveryFee) : 30.00,
        free_delivery_threshold: !isNaN(parseFloat(freeDeliveryThreshold)) ? parseFloat(freeDeliveryThreshold) : 200.00,
        delivery_partner_type: deliveryPartnerType,
        theme_preference: themeMode || 'system',
        updated_at: new Date().toISOString(),
      };

      const effectiveRole =
        profile?.role ||
        currentUser?.user_metadata?.role ||
        user.user_metadata?.role ||
        (userRole || 'customer');

      updates.role = effectiveRole;

      // Try upserting to profiles table
      let { data: updatedData, error: profileError } = await supabase
        .from('profiles')
        .upsert(updates, { onConflict: 'id' })
        .select()
        .maybeSingle();

      if (profileError && (profileError.code === 'PGRST204' || profileError.message?.includes('column'))) {
        console.warn('Retrying profile upsert without tax, theme, delivery, or upi_id columns:', profileError.message);
        const fallbackUpdates = { ...updates };
        delete fallbackUpdates.enable_tax;
        delete fallbackUpdates.cgst_rate;
        delete fallbackUpdates.sgst_rate;
        delete fallbackUpdates.enable_service_cost;
        delete fallbackUpdates.service_cost_rate;
        delete fallbackUpdates.print_tax_breakdown;
        delete fallbackUpdates.enable_delivery;
        delete fallbackUpdates.default_delivery_fee;
        delete fallbackUpdates.free_delivery_threshold;
        delete fallbackUpdates.delivery_partner_type;
        delete fallbackUpdates.theme_preference;
        delete fallbackUpdates.upi_id;
        const retryResult = await supabase.from('profiles').upsert(fallbackUpdates, { onConflict: 'id' }).select().maybeSingle();
        updatedData = retryResult.data;
        profileError = retryResult.error;
      }

      if (profileError) {
        console.error('Error updating profile:', profileError.message);
        showAlert('Error', `Failed to update profile: ${profileError.message}`);
        setSaving(false);
        return;
      }

      // Embed merchant UPI ID into media_urls as persistent backup
      let mediaListWithUpi = finalMediaList;
      if (normalizedUpi && !isGenericQrName(normalizedUpi)) {
        mediaListWithUpi = embedMerchantUpi(finalMediaList, normalizedUpi);
      }

      if (isSeller) {
        // Embed store settings into final media array for profiles
        const finalMediaWithSettings = embedStoreSettings(mediaListWithUpi, {
          is_store_active: isStoreActive,
          is_map_active: isMapActive,
          is_product_active: isProductViewActive,
        });

        // Try updating media_urls column if present in table
        try {
          await supabase
            .from('profiles')
            .update({ media_urls: finalMediaWithSettings })
            .eq('id', user.id);
        } catch (colErr) {
          console.warn('Notice: media_urls column update:', colErr);
        }

        // Also call setSellerStoreActiveStatus to ensure RPC is invoked
        try {
          await setSellerStoreActiveStatus(user.id, {
            is_store_active: isStoreActive,
            is_map_active: isMapActive,
            is_product_active: isProductViewActive,
            existingMedia: finalMediaList,
          });
        } catch (stErr) {
          console.warn('Notice: setSellerStoreActiveStatus:', stErr);
        }
      } else {
        // For buyers or delivery partners, save media_urls directly
        try {
          await supabase
            .from('profiles')
            .update({ media_urls: mediaListWithUpi })
            .eq('id', user.id);
        } catch (colErr) {
          console.warn('Notice: media_urls column update:', colErr);
        }
      }

      // 2. Update auth user metadata (name/full_name/profile_media/store_settings/upi_id) and email if changed
      const authUpdates = {
        data: {
          name: trimmedName,
          full_name: trimmedName,
          avatar_url: avatarUrl,
          profile_media: finalMediaList,
          upi_id: normalizedUpi && !isGenericQrName(normalizedUpi) ? normalizedUpi : (profile?.upi_id || ''),
          mobile: trimmedMobile,
          address_line_1: (addressLine1 || '').trim(),
          address_line_2: (addressLine2 || '').trim(),
          city: (city || '').trim(),
          state: (state || '').trim(),
          zip_code: (zipCode || '').trim(),
          latitude: parsedLat,
          longitude: parsedLon,
          role: effectiveRole,
          tax_settings: {
            enable_tax: printerConfig?.enableTax === true,
            cgst_rate: printerConfig?.cgstRate !== undefined ? Number(printerConfig.cgstRate) : 2.5,
            sgst_rate: printerConfig?.sgstRate !== undefined ? Number(printerConfig.sgstRate) : 2.5,
            enable_service_cost: printerConfig?.enableServiceCost === true,
            service_cost_rate: printerConfig?.serviceCostRate !== undefined ? Number(printerConfig.serviceCostRate) : 0,
            print_tax_breakdown: printerConfig?.printTaxBreakdown !== false,
          },
          ...(isSeller
            ? {
                store_settings: {
                  is_store_active: isStoreActive,
                  is_map_active: isMapActive,
                  is_product_active: isProductViewActive,
                },
              }
            : {}),
        },
      };

      if (normalizedUpi && !isGenericQrName(normalizedUpi)) {
        try {
          await supabase
            .from('profiles')
            .update({ upi_id: normalizedUpi })
            .eq('id', user.id);
        } catch (_) {}
        try {
          const activeQr = await getActiveQrCode(user.id);
          if (activeQr) {
            await updateQrCode(activeQr.id, normalizedUpi, true);
          } else {
            const dynamicQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
              `upi://pay?pa=${encodeURIComponent(normalizedUpi)}&pn=${encodeURIComponent(trimmedName || 'Store')}&cu=INR`
            )}`;
            await addQrCode(user.id, dynamicQrUrl, normalizedUpi, true);
            setUpiQrCodeUrl(dynamicQrUrl);
          }
        } catch (qrSyncErr) {
          console.warn('Notice syncing QR code name:', qrSyncErr);
        }
      }

      if (trimmedEmail && trimmedEmail.toLowerCase() !== (user.email || '').toLowerCase()) {
        authUpdates.email = trimmedEmail;
      }

      try {
        const { error: userUpdateError } = await supabase.auth.updateUser(authUpdates);
        if (userUpdateError) {
          console.warn('Notice updating auth user metadata/email:', userUpdateError.message);
          if (authUpdates.email) {
            showAlert(
              'Notice',
              `Profile updated! Note: Email change to "${trimmedEmail}" requires confirmation or could not be updated (${userUpdateError.message}).`
            );
          } else {
            showAlert('Success', 'Profile updated successfully!');
          }
        } else {
          showAlert('Success', 'Profile updated successfully!');
        }
      } catch (authErr) {
        console.warn('Notice calling auth.updateUser:', authErr);
        showAlert('Success', 'Profile updated successfully!');
      }

      setMediaList(finalMediaList);
      await fetchProfile();
    } catch (err) {
      console.error('Unexpected error in handleUpdateProfile:', err);
      showAlert('Error', err.message || 'An unexpected error occurred while updating profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    showAlert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            const { error } = await supabase.auth.signOut();
            setLoading(false);
            if (error) {
              showAlert('Error', 'Failed to log out: ' + error.message);
            } else {
              navigation.reset({
                index: 0,
                routes: [{ name: 'Welcome' }],
              });
            }
          } catch (err) {
            setLoading(false);
            console.error('Logout error in ProfileScreen:', err);
          }
        },
      },
    ]);
  };

  const reverseGeocodeCoords = async (coords) => {
    if (!coords || coords.latitude == null || coords.longitude == null) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'NeedsTrackingApp/1.0',
            'Accept-Language': 'en',
          },
        }
      );
      const data = await res.json();
      if (data && data.display_name) {
        setSelectedAreaInfo({
          name: data.display_name.split(',')[0] || 'Selected Location',
          fullAddress: data.display_name,
          address: data.address || {},
        });
      }
    } catch (err) {
      console.warn('Reverse geocode notice:', err.message);
    }
  };

  const fetchAreaSuggestions = async (queryText) => {
    if (!queryText || queryText.trim().length === 0) {
      setMapSearchSuggestions([]);
      return;
    }
    setMapSearchLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText.trim())}&limit=6&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'NeedsTrackingApp/1.0',
            'Accept-Language': 'en',
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      const data = await res.json();
      if (Array.isArray(data)) {
        const formatted = data
          .filter((item) => item && item.lat && item.lon)
          .map((item, idx) => ({
            id: `osm-${idx}-${item.place_id || idx}`,
            title: item.display_name ? item.display_name.split(',')[0] : 'Location Area',
            subtitle: item.display_name || '',
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
            rawAddress: item.address || {},
          }));
        setMapSearchSuggestions(formatted);
      } else {
        setMapSearchSuggestions([]);
      }
    } catch (err) {
      console.warn('Area search notice:', err.message);
      setMapSearchSuggestions([]);
    } finally {
      setMapSearchLoading(false);
    }
  };

  const handleAreaSearchChange = (text) => {
    setMapSearchQuery(text);
    if (debounceSearchTimer.current) clearTimeout(debounceSearchTimer.current);
    debounceSearchTimer.current = setTimeout(() => fetchAreaSuggestions(text), 350);
  };

  const handleSelectAreaSuggestion = (item) => {
    if (!item || !item.latitude || !item.longitude) return;
    setMapSearchQuery(item.title);
    setMapSearchSuggestions([]);
    const newCoords = { latitude: item.latitude, longitude: item.longitude };
    setMarkerLocation(newCoords);
    setSelectedAreaInfo({
      name: item.title,
      fullAddress: item.subtitle,
      address: item.rawAddress,
    });
    if (mapRef.current) {
      mapRef.current.centerOnLocation(newCoords, 16);
    }
  };

  const handleMapLocationChange = (coords) => {
    if (!coords) return;
    setMarkerLocation(coords);
    reverseGeocodeCoords(coords);
  };

  const handleUseCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeout: 4500,
        });
        if (loc?.coords) {
          const newCoords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setMarkerLocation(newCoords);
          if (mapRef.current) {
            mapRef.current.centerOnLocation(newCoords, 16);
          }
          reverseGeocodeCoords(newCoords);
        }
      } else {
        showAlert('Permission Denied', 'GPS location permission is required to detect current position.');
      }
    } catch (err) {
      console.warn('GPS location error:', err.message);
      showAlert('Notice', 'Could not obtain current GPS position.');
    }
  };

  const openLocationPicker = async () => {
    try {
      setMapSearchQuery('');
      setMapSearchSuggestions([]);
      let initLat = latitude != null && !isNaN(Number(latitude)) ? Number(latitude) : null;
      let initLon = longitude != null && !isNaN(Number(longitude)) ? Number(longitude) : null;

      if (initLat == null || initLon == null) {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              timeout: 4000,
            });
            if (loc?.coords) {
              initLat = loc.coords.latitude;
              initLon = loc.coords.longitude;
            }
          } catch (e) {
            console.warn('GPS query fallback in ProfileScreen:', e.message);
          }
        }
      }

      const finalLat = initLat || 17.4065;
      const finalLon = initLon || 78.3998;

      setMapInitialRegion({ latitude: finalLat, longitude: finalLon });
      setMarkerLocation({ latitude: finalLat, longitude: finalLon });
      setShowLocationPicker(true);
      reverseGeocodeCoords({ latitude: finalLat, longitude: finalLon });
    } catch (error) {
      console.error('Error in openLocationPicker:', error);
      setShowLocationPicker(true);
    }
  };

  const confirmLocationSelection = () => {
    if (markerLocation && markerLocation.latitude != null && markerLocation.longitude != null) {
      setLatitude(markerLocation.latitude);
      setLongitude(markerLocation.longitude);

      if (autoFillAddress && selectedAreaInfo?.address) {
        const addr = selectedAreaInfo.address;
        const cityName = addr.city || addr.town || addr.village || addr.suburb || addr.county || '';
        const stateName = addr.state || '';
        const postcode = addr.postcode || '';
        const streetName = [addr.road, addr.neighbourhood || addr.suburb].filter(Boolean).join(', ');

        if (cityName) setCity(cityName);
        if (stateName) setState(stateName);
        if (postcode) setZipCode(postcode);
        if (streetName && (!addressLine1 || addressLine1.trim() === '')) {
          setAddressLine1(streetName);
        }
      }

      setShowLocationPicker(false);
      setMapSearchQuery('');
      setMapSearchSuggestions([]);
      showAlert(
        'Location Set',
        `Coordinates set to (${markerLocation.latitude.toFixed(4)}, ${markerLocation.longitude.toFixed(4)}). Tap "Update Profile" below to save your changes.`
      );
    } else {
      showAlert('No Location Selected', 'Please select a location on the map.');
    }
  };

  const handleUpiQrUpload = async (mode = 'gallery') => {
    try {
      if (Platform.OS !== 'web') {
        if (mode === 'camera') {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            showAlert('Permission Denied', 'Camera permission is required to photograph your QR code standee.');
            return;
          }
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            showAlert('Permission Denied', 'Photo library permission is required to upload QR code.');
            return;
          }
        }
      }

      let result;
      if (mode === 'camera' && Platform.OS !== 'web') {
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 1,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: Platform.OS !== 'web',
          aspect: [1, 1],
          quality: 1,
        });
      }

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setScanningQr(true);
        const imageUrl = result.assets[0].uri;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          showAlert('Error', 'User not authenticated.');
          setScanningQr(false);
          return;
        }

        // 1. Immediately scan/decode the local image to extract UPI details
        let scan = null;
        try {
          scan = await decodeQrFromImage(imageUrl);
        } catch (scanErr) {
          console.warn('Initial QR scan error from local image:', scanErr);
        }

        // 2. Upload QR image to Supabase storage
        const uploadedUrl = await uploadQrImage(user.id, imageUrl);

        // 3. Fallback scan on uploaded URL if initial scan didn't find UPI
        if ((!scan || !scan.success || !scan.upiId) && uploadedUrl) {
          try {
            const retryScan = await decodeQrFromImage(uploadedUrl);
            if (retryScan?.success && retryScan.upiId) {
              scan = retryScan;
            }
          } catch (_) {}
        }

        const targetQrUrl = uploadedUrl || imageUrl;

        // 4. If UPI ID / payment URI detected, auto-save to profile, user_qr_codes, and auth metadata!
        if (scan?.success && scan.upiId) {
          const detectedUpi = normalizeUpiId(scan.upiId);
          if (detectedUpi && !isGenericQrName(detectedUpi)) {
            setUpiId(detectedUpi);
            setUpiQrCodeUrl(targetQrUrl);
            setQrSourceInfo('Auto-detected from QR Code');
            setProfile((prev) => ({ ...(prev || {}), upi_id: detectedUpi }));

            // Save active QR record with detected UPI ID
            await addQrCode(user.id, targetQrUrl, detectedUpi, true);

            // Update profiles table upi_id column
            try {
              await supabase.from('profiles').update({ upi_id: detectedUpi }).eq('id', user.id);
            } catch (_) {}

            // Update auth user metadata
            try {
              await supabase.auth.updateUser({ data: { upi_id: detectedUpi } });
            } catch (_) {}

            // Embed into media_urls backup
            try {
              const { data: curProf } = await supabase
                .from('profiles')
                .select('media_urls')
                .eq('id', user.id)
                .maybeSingle();
              const updatedMedia = embedMerchantUpi(curProf?.media_urls || mediaList, detectedUpi);
              await supabase.from('profiles').update({ media_urls: updatedMedia }).eq('id', user.id);
            } catch (_) {}

            // Auto-fill store name from QR payeeName if current name is empty
            if (scan.payeeName && !name.trim()) {
              setName(scan.payeeName);
              try {
                await supabase.from('profiles').update({ full_name: scan.payeeName }).eq('id', user.id);
              } catch (_) {}
            }

            showAlert(
              '🎉 UPI QR Configured Successfully!',
              `Detected UPI ID: "${detectedUpi}"${scan.payeeName ? `\nStore / Payee: "${scan.payeeName}"` : ''}\n\nYour UPI ID and QR code have been saved automatically! Customers can now scan your QR code or pay their exact bill amount directly in Google Pay, PhonePe, or Paytm.`
            );
            setScanningQr(false);
            return;
          }
        }

        // 5. If QR was uploaded but UPI ID couldn't be decoded
        if (targetQrUrl) {
          const qrName = upiId.trim() || 'Store Standee QR';
          await addQrCode(user.id, targetQrUrl, qrName, true);
          setUpiQrCodeUrl(targetQrUrl);
          showAlert(
            'QR Code Uploaded',
            'Your QR standee image was uploaded successfully!\n\nNote: We could not automatically detect the UPI ID from this image. If you would like dynamic bill QR codes at checkout, please verify or enter your UPI ID in the text field below.'
          );
        } else {
          showAlert('Upload Failed', 'Failed to upload QR code image. Please try again.');
        }
        setScanningQr(false);
      }
    } catch (err) {
      console.error('Error during UPI QR upload:', err);
      showAlert('Upload Failed', err.message || 'Could not pick or upload image.');
      setScanningQr(false);
    }
  };

  const handleSelectUpiSuffix = (suffix) => {
    let base = (upiId || '').trim();
    if (base.toLowerCase().includes('upi://pay')) {
      const match = base.match(/[?&]pa=([^&"'\s]+)/i);
      if (match) base = decodeURIComponent(match[1]).trim();
    }
    if (base.includes('@')) {
      base = base.split('@')[0].trim();
    }
    if (!base) {
      base = (mobile || '').replace(/\D/g, '').slice(-10) || (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    const updated = base ? `${base}${suffix}` : suffix;
    setUpiId(updated);
  };

  const handleSaveUpiId = async () => {
    const raw = (upiId || '').trim();
    const normalized = normalizeUpiId(raw);
    if (!normalized || isGenericQrName(normalized)) {
      showAlert(
        'Enter UPI ID / Mobile',
        'Please enter your UPI ID, 10-digit mobile number, or Merchant ID (e.g. 9876543210@upi, store@okaxis, or 9876543210). The @upi handle is added automatically if not specified.'
      );
      return;
    }

    setUpiId(normalized);
    setProfile((prev) => ({ ...(prev || {}), upi_id: normalized }));

    try {
      setSavingUpiId(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showAlert('Error', 'User not authenticated.');
        return;
      }

      // Update user metadata with UPI ID
      await supabase.auth.updateUser({
        data: { upi_id: normalized },
      });

      // Try updating profiles table upi_id column
      try {
        await supabase
          .from('profiles')
          .update({ upi_id: normalized })
          .eq('id', user.id);
      } catch (err) {
        // column may not exist in profiles table
      }

      // Persistent backup in media_urls
      try {
        const { data: curProf } = await supabase
          .from('profiles')
          .select('media_urls')
          .eq('id', user.id)
          .maybeSingle();
        const updatedMedia = embedMerchantUpi(curProf?.media_urls || mediaList, normalized);
        await supabase
          .from('profiles')
          .update({ media_urls: updatedMedia })
          .eq('id', user.id);
      } catch (_) {}

      // Sync with active QR code in user_qr_codes
      const activeQr = await getActiveQrCode(user.id);
      const dynamicQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
        `upi://pay?pa=${encodeURIComponent(normalized)}&pn=${encodeURIComponent(name.trim() || 'Store')}&cu=INR`
      )}`;

      if (activeQr) {
        await updateQrCode(activeQr.id, normalized, true);
      } else {
        await addQrCode(user.id, dynamicQrUrl, normalized, true);
        setUpiQrCodeUrl(dynamicQrUrl);
      }
      setQrSourceInfo('Manually Entered');

      showAlert(
        'UPI ID Saved',
        `Merchant UPI ID configured as "${normalized}". Customers will now see dynamic UPI QR code with their exact order bill amount at checkout.`
      );
    } catch (err) {
      console.error('Error saving UPI ID:', err);
      showAlert('Error', err.message || 'Failed to save UPI ID.');
    } finally {
      setSavingUpiId(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  let photoIndexCounter = 0;

  const userRole = (
    profile?.role ||
    profile?.user_type ||
    currentUser?.user_metadata?.role ||
    currentUser?.user_metadata?.user_type ||
    ''
  ).toLowerCase().trim();
  const isDelivery = userRole === 'delivery_manager' || userRole === 'delivery_partner';
  const isAdmin = userRole === 'admin' || userRole === 'superadmin' || userRole === 'appadmin' || userRole === 'app_admin';
  const isEmployee = userRole === 'seller_employee' || route.params?.isEmployee;
  const isSeller = !isEmployee && !isDelivery && (userRole === 'seller' || isAdmin || (sellerProducts && sellerProducts.length > 0));
  const isBuyer = !isAdmin && !isSeller && !isDelivery && !isEmployee;

  return (
    <View style={[styles.rootWrapper, { backgroundColor: colors.background }]}>
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.scrollContent}>
      <View style={styles.profileHeaderBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {navigation?.canGoBack?.() && (
            <TouchableOpacity
              style={{ marginRight: 12, padding: 4 }}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Back"
            >
              <Icon name="arrow-left" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
          <Text style={[styles.title, { color: colors.text }]}>Profile</Text>
        </View>
        {(profile?.role || profile?.user_type || isAdmin || isDelivery || isSeller || isEmployee) && (
          <View style={[
            styles.profileRoleBadge,
            isAdmin ? styles.roleBadgeAdmin :
            isEmployee ? { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' } :
            isSeller ? styles.roleBadgeSeller :
            isDelivery ? styles.roleBadgeDelivery :
            styles.roleBadgeCustomer
          ]}>
            <Icon
              name={isAdmin ? 'shield' : isEmployee ? 'id-badge' : isSeller ? 'home' : isDelivery ? 'truck' : 'user'}
              size={12}
              color={isAdmin ? '#D97706' : isEmployee ? '#059669' : isSeller ? '#059669' : isDelivery ? '#7C3AED' : '#0284C7'}
              style={{ marginRight: 5 }}
            />
            <Text style={[
              styles.profileRoleBadgeText,
              isAdmin ? styles.roleBadgeTextAdmin :
              isEmployee ? { color: '#065F46', fontWeight: '700' } :
              isSeller ? styles.roleBadgeTextSeller :
              isDelivery ? styles.roleBadgeTextDelivery :
              styles.roleBadgeTextCustomer
            ]}>
              {isAdmin ? (userRole === 'superadmin' ? 'Superadmin' : 'App Admin') : isEmployee ? `Staff: ${route.params?.employeeName || 'Staff Member'} (${route.params?.employeeDesignation || 'Cashier'})` : isSeller ? 'Seller Account' : isDelivery ? 'Delivery Partner' : 'Customer / Buyer'}
            </Text>
          </View>
        )}
      </View>

      {/* SELLER: Store & Product Active Visibility Controls */}
      {isSeller && (
        <View style={styles.storeControlCard}>
          <View style={styles.storeControlHeader}>
            <View style={styles.storeControlTitleRow}>
              <View style={[styles.storeIconCircle, { backgroundColor: isStoreActive ? '#ECFDF5' : '#FEF2F2' }]}>
                <Icon
                  name={isStoreActive ? 'shopping-bag' : 'pause-circle'}
                  size={18}
                  color={isStoreActive ? '#10B981' : '#EF4444'}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.storeControlTitle}>Store & Product Visibility</Text>
                <Text style={styles.storeControlSub}>
                  Control whether your store & catalog are active on the map for buyers
                </Text>
              </View>
            </View>

            {/* Quick Status Pill */}
            <View style={[styles.statusPill, isStoreActive ? styles.statusPillActive : styles.statusPillInactive]}>
              <View style={[styles.statusDot, { backgroundColor: isStoreActive ? '#10B981' : '#EF4444' }]} />
              <Text style={[styles.statusPillText, { color: isStoreActive ? '#065F46' : '#991B1B' }]}>
                {isStoreActive ? 'STORE OPEN / ACTIVE' : 'STORE CLOSED / INACTIVE'}
              </Text>
            </View>
          </View>

          {/* Toggle 1: Store Active / Inactive */}
          <TouchableOpacity
            style={styles.toggleRow}
            activeOpacity={0.7}
            onPress={() => !togglingStatus && handleToggleMyStore(!isStoreActive)}
          >
            <View style={styles.toggleLabelCol}>
              <View style={styles.toggleTitleInline}>
                <Icon name="home" size={14} color="#0F172A" style={{ marginRight: 6 }} />
                <Text style={styles.toggleTitle}>Store Active Status</Text>
              </View>
              <Text style={styles.toggleDesc}>
                {isStoreActive
                  ? 'Your store is live. Buyers can discover your store on the map and view your catalog.'
                  : 'Your store is closed/inactive. Buyers cannot place orders or view inactive listings.'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {togglingStatus && (
                <ActivityIndicator size="small" color="#10B981" style={{ marginRight: 8 }} />
              )}
              <Switch
                value={isStoreActive}
                onValueChange={handleToggleMyStore}
                trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                thumbColor={isStoreActive ? '#10B981' : '#F1F5F9'}
                disabled={togglingStatus}
              />
            </View>
          </TouchableOpacity>

          {/* Toggle 2: Product View (Activate/Deactivate All Products) */}
          <TouchableOpacity
            style={styles.toggleRow}
            activeOpacity={0.7}
            onPress={() => !togglingStatus && handleToggleMyProducts(!isProductViewActive)}
          >
            <View style={styles.toggleLabelCol}>
              <View style={styles.toggleTitleInline}>
                <Icon name="cubes" size={14} color="#0F172A" style={{ marginRight: 6 }} />
                <Text style={styles.toggleTitle}>
                  Product Catalog View ({productStats.active}/{productStats.total} Active)
                </Text>
              </View>
              <Text style={styles.toggleDesc}>
                {isProductViewActive
                  ? 'Products are active and visible in the buyer catalog.'
                  : 'All products are currently paused/inactive.'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {togglingStatus && (
                <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />
              )}
              <Switch
                value={isProductViewActive}
                onValueChange={handleToggleMyProducts}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                thumbColor={isProductViewActive ? '#007AFF' : '#F1F5F9'}
                disabled={togglingStatus}
              />
            </View>
          </TouchableOpacity>

          {/* Toggle 3: Map Visibility */}
          <TouchableOpacity
            style={[styles.toggleRow, { borderBottomWidth: 0 }]}
            activeOpacity={0.7}
            onPress={() => !togglingStatus && handleToggleMyMap(!isMapActive)}
          >
            <View style={styles.toggleLabelCol}>
              <View style={styles.toggleTitleInline}>
                <Icon name="map-marker" size={14} color="#0F172A" style={{ marginRight: 6 }} />
                <Text style={styles.toggleTitle}>Show Pin on Map</Text>
              </View>
              <Text style={styles.toggleDesc}>
                {isMapActive
                  ? 'Store location pin is shown on the interactive map.'
                  : 'Store location pin is hidden from the interactive map.'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {togglingStatus && (
                <ActivityIndicator size="small" color="#8B5CF6" style={{ marginRight: 8 }} />
              )}
              <Switch
                value={isMapActive}
                onValueChange={handleToggleMyMap}
                trackColor={{ false: '#CBD5E1', true: '#C084FC' }}
                thumbColor={isMapActive ? '#8B5CF6' : '#F1F5F9'}
                disabled={togglingStatus}
              />
            </View>
          </TouchableOpacity>

          {/* Quick Action Buttons */}
          <View style={styles.storeQuickActionsRow}>
            <TouchableOpacity
              style={[styles.storeQuickBtn, styles.storeQuickBtnActive, togglingStatus && { opacity: 0.6 }]}
              disabled={togglingStatus}
              onPress={async () => {
                setTogglingStatus(true);
                try {
                  setIsStoreActive(true);
                  setIsMapActive(true);
                  setIsProductViewActive(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    await setSellerProductsActiveStatus(user.id, true);
                    setSellerProducts((prev) => (prev || []).map((p) => ({ ...p, is_active: true })));
                    setProductStats((prev) => ({ ...prev, active: prev.total }));
                    await setSellerStoreActiveStatus(user.id, {
                      is_store_active: true,
                      is_map_active: true,
                      is_product_active: true,
                      existingMedia: mediaList,
                    });
                    setMediaList((prev) => (prev || []).filter((m) => m && m.type !== 'store_settings'));
                    try {
                      await supabase.auth.updateUser({
                        data: {
                          store_settings: {
                            is_store_active: true,
                            is_map_active: true,
                            is_product_active: true,
                          },
                        },
                      });
                    } catch (_) {}
                  }
                  showAlert('Store Activated', '🟢 Store, catalog, and map pin are now ACTIVE!');
                } catch (e) {
                  console.error('Error activating all:', e);
                  showAlert('Error', 'Failed to activate store and products.');
                } finally {
                  setTogglingStatus(false);
                }
              }}
            >
              <Icon name="check-circle" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
              <Text style={styles.storeQuickBtnTextActive}>Activate All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.storeQuickBtn, styles.storeQuickBtnInactive, togglingStatus && { opacity: 0.6 }]}
              disabled={togglingStatus}
              onPress={async () => {
                setTogglingStatus(true);
                try {
                  setIsStoreActive(false);
                  setIsProductViewActive(false);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    await setSellerProductsActiveStatus(user.id, false);
                    setSellerProducts((prev) => (prev || []).map((p) => ({ ...p, is_active: false })));
                    setProductStats((prev) => ({ ...prev, active: 0 }));
                    await setSellerStoreActiveStatus(user.id, {
                      is_store_active: false,
                      is_map_active: isMapActive,
                      is_product_active: false,
                      existingMedia: mediaList,
                    });
                    setMediaList((prev) => (prev || []).filter((m) => m && m.type !== 'store_settings'));
                    try {
                      await supabase.auth.updateUser({
                        data: {
                          store_settings: {
                            is_store_active: false,
                            is_map_active: isMapActive,
                            is_product_active: false,
                          },
                        },
                      });
                    } catch (_) {}
                  }
                  showAlert('Store Deactivated', '🔴 Store and catalog are now INACTIVE / CLOSED.');
                } catch (e) {
                  console.error('Error deactivating all:', e);
                  showAlert('Error', 'Failed to deactivate store and products.');
                } finally {
                  setTogglingStatus(false);
                }
              }}
            >
              <Icon name="pause-circle" size={13} color="#EF4444" style={{ marginRight: 5 }} />
              <Text style={styles.storeQuickBtnTextInactive}>Deactivate All</Text>
            </TouchableOpacity>
          </View>

          {/* Quick shortcut to Sales & Hourly Analytics */}
          <TouchableOpacity
            style={styles.salesReportProfileBtn}
            activeOpacity={0.8}
            onPress={() => {
              const sid = currentUser?.id || profile?.id;
              const sname = profile?.business_name || profile?.full_name || '';
              const nav = navigation?.getParent?.() || navigation;
              nav.navigate('SellerSalesReport', {
                sellerId: sid,
                sellerName: sname,
              });
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={styles.salesReportProfileIcon}>
                <Icon name="bar-chart" size={16} color="#4F46E5" />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.salesReportProfileTitle}>Sales & Hourly Analytics Report</Text>
                <Text style={styles.salesReportProfileSub}>
                  Hourly rush spikes, product contribution & custom date ranges
                </Text>
              </View>
            </View>
            <Icon name="chevron-right" size={14} color="#94A3B8" />
          </TouchableOpacity>

          {/* Quick shortcut to Store Staff & Employees */}
          <TouchableOpacity
            style={[styles.salesReportProfileBtn, { marginTop: 10, borderColor: '#BAE6FD', backgroundColor: '#F0F9FF' }]}
            activeOpacity={0.8}
            onPress={() => {
              const sid = currentUser?.id || profile?.id;
              const sname = profile?.business_name || profile?.full_name || '';
              const nav = navigation?.getParent?.() || navigation;
              nav.navigate('SellerEmployees', {
                sellerId: sid,
                sellerName: sname,
              });
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={[styles.salesReportProfileIcon, { backgroundColor: '#E0F2FE' }]}>
                <Icon name="users" size={16} color="#0284C7" />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={[styles.salesReportProfileTitle, { color: '#0369A1' }]}>Store Staff & Employees</Text>
                <Text style={styles.salesReportProfileSub}>
                  Manage cashiers, order handlers, PINs & operational permissions
                </Text>
              </View>
            </View>
            <Icon name="chevron-right" size={14} color="#0284C7" />
          </TouchableOpacity>
        </View>
      )}

      {/* APP ADMIN / SUPERADMIN: Global Master Controls & Multi-Seller Store Management */}
      {isAdmin && (
        <View style={styles.adminMasterCard}>
          <View style={styles.adminHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={styles.adminCrownBox}>
                <Icon name="shield" size={18} color="#D97706" />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.adminCardTitle}>Superadmin & Admin: Seller Controls</Text>
                <Text style={styles.adminCardSub}>
                  Only Superadmin or Admin can activate/deactivate sellers for Map & Directory (Default Inactive)
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.adminRefreshBtn}
              onPress={fetchAdminSellersList}
              accessibilityLabel="Refresh Sellers"
            >
              <Icon name="refresh" size={14} color="#007AFF" />
            </TouchableOpacity>
          </View>

          {/* Catalog & Sub-Catalog Master Maintenance Action */}
          <View style={{ marginBottom: 12 }}>
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#EFF6FF',
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: '#3B82F6',
              }}
              onPress={() => navigation.navigate('CatalogManagement', { fromTab: 'profile' })}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: '#007AFF',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 10,
                  }}
                >
                  <Icon name="tags" size={15} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#1E3A8A' }}>
                    Manage Catalog & Sub-Catalog
                  </Text>
                  <Text style={{ fontSize: 11, color: '#3B82F6', marginTop: 1 }}>
                    Add, edit, active/inactive categories & subcategories for all users & sellers
                  </Text>
                </View>
              </View>
              <Icon name="chevron-right" size={13} color="#007AFF" />
            </TouchableOpacity>
          </View>

          {/* Global Master Bulk Actions */}
          <View style={styles.adminGlobalActionsBox}>
            <Text style={styles.adminGlobalTitle}>Global Platform Actions (All Stores)</Text>
            <View style={styles.adminGlobalBtnsRow}>
              <TouchableOpacity
                style={[styles.adminGlobalBtn, styles.adminGlobalBtnActive]}
                onPress={() => {
                  handleAdminGlobalToggleStores(true);
                  handleAdminGlobalToggleProducts(true);
                }}
              >
                <Icon name="check-circle" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.adminGlobalBtnText}>Activate All Stores & Products</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.adminGlobalBtn, styles.adminGlobalBtnInactive]}
                onPress={() => {
                  handleAdminGlobalToggleStores(false);
                  handleAdminGlobalToggleProducts(false);
                }}
              >
                <Icon name="ban" size={13} color="#DC2626" style={{ marginRight: 6 }} />
                <Text style={[styles.adminGlobalBtnText, { color: '#DC2626' }]}>
                  Deactivate All Stores & Products
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Sellers */}
          <View style={styles.adminSearchRow}>
            <Icon name="search" size={13} color="#64748B" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.adminSearchInput}
              placeholder="Filter sellers by store name, email or city..."
              placeholderTextColor="#94A3B8"
              value={adminSearchQuery}
              onChangeText={setAdminSearchQuery}
            />
            {adminSearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setAdminSearchQuery('')}>
                <Icon name="times-circle" size={14} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Sellers List Table/Cards */}
          {adminLoading ? (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 20 }} />
          ) : (
            <View style={styles.adminSellersList}>
              {adminSellersList
                .filter((s) => {
                  if (!adminSearchQuery.trim()) return true;
                  const q = adminSearchQuery.toLowerCase();
                  return (
                    (s.full_name || '').toLowerCase().includes(q) ||
                    (s.email || '').toLowerCase().includes(q) ||
                    (s.city || '').toLowerCase().includes(q)
                  );
                })
                .map((seller) => (
                  <View key={`admin-seller-${seller.id}`} style={styles.adminSellerRow}>
                    <View style={styles.adminSellerInfoCol}>
                      <View style={styles.adminSellerNameRow}>
                        <Text style={styles.adminSellerName} numberOfLines={1}>
                          {seller.full_name}
                        </Text>
                        <View
                          style={[
                            styles.miniStatusTag,
                            seller.is_store_active === true
                              ? styles.miniStatusTagActive
                              : styles.miniStatusTagInactive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.miniStatusTagText,
                              {
                                color:
                                  seller.is_store_active === true
                                    ? '#059669'
                                    : '#DC2626',
                              },
                            ]}
                          >
                            {seller.is_store_active === true ? 'Active' : 'Inactive'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.adminSellerMeta} numberOfLines={1}>
                        ✉️ {seller.email || 'No email'}  •  📍 {seller.city || 'Location'}
                      </Text>
                      <Text style={styles.adminSellerMeta}>
                        📦 Products: {seller.activeProductCount}/{seller.productCount} Active
                      </Text>
                    </View>

                    {/* Admin Per-Seller Controls */}
                    <View style={styles.adminSellerControlsCol}>
                      <View style={styles.adminToggleMiniRow}>
                        <Text style={styles.adminToggleMiniLabel}>Store:</Text>
                        <Switch
                          value={seller.is_store_active === true}
                          onValueChange={(val) => handleAdminToggleSellerStore(seller.id, val)}
                          trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                          thumbColor={seller.is_store_active === true ? '#10B981' : '#F1F5F9'}
                          style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                      </View>

                      <View style={styles.adminToggleMiniRow}>
                        <Text style={styles.adminToggleMiniLabel}>Products:</Text>
                        <Switch
                          value={seller.is_product_active === true}
                          onValueChange={(val) => handleAdminToggleSellerProducts(seller.id, val)}
                          trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                          thumbColor={seller.is_product_active === true ? '#007AFF' : '#F1F5F9'}
                          style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                      </View>

                      <View style={styles.adminToggleMiniRow}>
                        <Text style={styles.adminToggleMiniLabel}>Map Pin:</Text>
                        <Switch
                          value={seller.is_map_active === true}
                          onValueChange={(val) => handleAdminToggleSellerMap(seller.id, val)}
                          trackColor={{ false: '#CBD5E1', true: '#C084FC' }}
                          thumbColor={seller.is_map_active === true ? '#8B5CF6' : '#F1F5F9'}
                          style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                      </View>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>
      )}

      {/* Media Upload Section (Max 3 Images, 1 Video) */}
      <View style={styles.mediaSectionCard}>
        <View style={styles.mediaHeaderRow}>
          <Text style={styles.sectionTitle}>Profile Photos & Video</Text>
          <Text style={styles.mediaCounterText}>
            📷 {imageCount}/{MAX_IMAGES}  •  🎥 {videoCount}/{MAX_VIDEOS}
          </Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Upload up to {MAX_IMAGES} photos and {MAX_VIDEOS} video. Tap ✕ on any item to remove and add again.
        </Text>

        {/* Media Add Buttons */}
        <View style={styles.mediaButtonsRow}>
          <TouchableOpacity
            style={[
              styles.mediaActionBtn,
              styles.photoActionBtn,
              imageCount >= MAX_IMAGES && styles.mediaActionBtnDisabled,
            ]}
            onPress={handleAddImage}
            disabled={imageCount >= MAX_IMAGES}
          >
            <Text style={styles.mediaActionBtnText}>
              📷 Add Photo ({imageCount}/{MAX_IMAGES})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.mediaActionBtn,
              styles.videoActionBtn,
              videoCount >= MAX_VIDEOS && styles.mediaActionBtnDisabled,
            ]}
            onPress={handleAddVideo}
            disabled={videoCount >= MAX_VIDEOS}
          >
            <Text style={styles.mediaActionBtnText}>
              🎥 Add Video ({videoCount}/{MAX_VIDEOS})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Media Preview Grid / Carousel */}
        {mediaList.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mediaListContainer}
          >
            {mediaList.map((media, index) => {
              const isVideo = media.type === 'video';
              if (!isVideo) {
                photoIndexCounter += 1;
              }
              const currentPhotoNumber = photoIndexCounter;

              return (
                <View key={`media-${index}-${media.uri}`} style={styles.mediaItemWrapper}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => {
                      setSelectedMediaIndex(index);
                      setShowMediaViewer(true);
                    }}
                    style={styles.mediaThumbnailContainer}
                  >
                    {isVideo ? (
                      <View style={styles.videoThumbnailContainer}>
                        <Video
                          source={{ uri: media.uri }}
                          style={styles.mediaThumbnail}
                          resizeMode={ResizeMode.COVER}
                          useNativeControls={false}
                          isMuted={true}
                          shouldPlay={false}
                        />
                        <View style={styles.videoPlayOverlay}>
                          <Text style={styles.videoPlayIcon}>▶</Text>
                        </View>
                      </View>
                    ) : (
                      <Image
                        source={{ uri: media.uri }}
                        style={styles.mediaThumbnail}
                        resizeMode="cover"
                      />
                    )}

                    {/* Media Type Badge */}
                    <View style={isVideo ? styles.videoBadge : styles.photoBadge}>
                      <Text style={styles.badgeText}>
                        {isVideo ? '🎥 Video' : `📷 Photo ${currentPhotoNumber}`}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Remove Button (✕) to remove and add again */}
                  <TouchableOpacity
                    style={styles.removeMediaBtn}
                    onPress={() => handleRemoveMedia(index)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.removeMediaBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.emptyMediaBox}>
            <Text style={styles.emptyMediaIcon}>🖼️</Text>
            <Text style={styles.emptyMediaText}>No photos or video uploaded yet.</Text>
            <Text style={styles.emptyMediaSubtext}>Use the buttons above to add photos or a video.</Text>
          </View>
        )}
      </View>

      {/* UPI QR Code & Payment Settings Section - Always Visible */}
      <View style={styles.upiSectionCard}>
        <View style={styles.upiHeaderRow}>
          <Text style={styles.sectionTitle}>💳 UPI Payments & QR Code</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          {isDelivery
            ? 'Set your UPI ID (VPA) for receiving direct tips and delivery payouts.'
            : 'Set your Merchant UPI QR code so customers can scan and pay with exact order bill amounts — zero confusion, no manual typing needed!'}
        </Text>

        {/* PRIMARY SETUP: UPLOAD OR SCAN QR CODE */}
        <View style={styles.qrUploadHeroCard}>
          <View style={styles.qrHeroHeader}>
            <View style={styles.qrHeroIconWrap}>
              <Icon name="qrcode" size={24} color="#007AFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.qrHeroTitle}>Set UPI from QR Code (Recommended)</Text>
              <Text style={styles.qrHeroSubtitle}>
                Every customer has a scanner in Google Pay, PhonePe, and Paytm. Upload or snap your shop QR standee to auto-configure your UPI payment without typing!
              </Text>
            </View>
          </View>

          {scanningQr ? (
            <View style={styles.qrScanningBox}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.qrScanningText}>Scanning QR code & extracting UPI ID...</Text>
            </View>
          ) : (
            <View style={styles.qrActionButtonsRow}>
              <TouchableOpacity
                style={styles.qrActionBtnPrimary}
                onPress={() => handleUpiQrUpload('gallery')}
                disabled={scanningQr || saving}
                activeOpacity={0.85}
              >
                <Icon name="image" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.qrActionBtnPrimaryText}>
                  {upiQrCodeUrl ? 'Update QR from Gallery' : 'Upload QR from Gallery'}
                </Text>
              </TouchableOpacity>

              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={styles.qrActionBtnSecondary}
                  onPress={() => handleUpiQrUpload('camera')}
                  disabled={scanningQr || saving}
                  activeOpacity={0.85}
                >
                  <Icon name="camera" size={16} color="#007AFF" style={{ marginRight: 6 }} />
                  <Text style={styles.qrActionBtnSecondaryText}>Take Photo</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ACTIVE UPI BANNER & DYNAMIC AMOUNT PREVIEW */}
        {upiId.trim() ? (
          <View style={styles.dynamicPreviewContainer}>
            <View style={styles.badgeRow}>
              <View style={styles.dynamicBadge}>
                <Icon name="check-circle" size={12} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.dynamicBadgeText}>UPI Active: {normalizeUpiId(upiId) || upiId.trim()}</Text>
              </View>
              {qrSourceInfo ? (
                <Text style={styles.previewHint}>({qrSourceInfo})</Text>
              ) : (
                <Text style={styles.previewHint}>Generates QR with buyer's bill amount</Text>
              )}
            </View>

            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => {
                const activeCleanUpi = normalizeUpiId(upiId) || upiId.trim();
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(
                  `upi://pay?pa=${encodeURIComponent(activeCleanUpi)}&pn=${encodeURIComponent(name.trim() || 'Store')}&am=100&cu=INR&tn=Order%20DEMO%20100001`
                )}`;
                const combined = [
                  { id: 'dynamic-qr', uri: qrUrl, type: 'image', title: `${name || 'Store'} Dynamic UPI QR Code` },
                  ...(upiQrCodeUrl ? [{ id: 'custom-qr', uri: upiQrCodeUrl, type: 'image', title: `${name || 'Store'} Uploaded QR Standee` }] : []),
                  ...mediaList.filter((m) => m && m.type !== 'store_settings'),
                ];
                setViewerCustomMedia(combined);
                setSelectedMediaIndex(0);
                setShowMediaViewer(true);
              }}
              style={styles.previewCard}
            >
              <Image
                source={{
                  uri: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
                    `upi://pay?pa=${encodeURIComponent(normalizeUpiId(upiId) || upiId.trim())}&pn=${encodeURIComponent(name.trim() || 'Store')}&am=100&cu=INR&tn=Order%20DEMO%20100001`
                  )}`,
                }}
                style={styles.previewQrImage}
              />
              <View style={styles.previewInfo}>
                <Text style={styles.previewPayee}>{name.trim() || 'Your Store'}</Text>
                <Text style={styles.previewUpiId}>{normalizeUpiId(upiId) || upiId.trim()}</Text>
                <Text style={styles.previewDesc}>
                  ⚡ Dynamic Bill QR ready! Customers scan this code with Google Pay, PhonePe, or Paytm with their exact bill total pre-filled. (Tap to view full screen)
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Uploaded Store Standee QR Preview */}
        {upiQrCodeUrl && (
          <View style={styles.customQrSection}>
            <Text style={styles.customQrTitle}>Uploaded Store Standee QR</Text>
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => {
                const activeCleanUpi = normalizeUpiId(upiId) || upiId.trim();
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(
                  `upi://pay?pa=${encodeURIComponent(activeCleanUpi)}&pn=${encodeURIComponent(name.trim() || 'Store')}&am=100&cu=INR&tn=Order%20DEMO%20100001`
                )}`;
                const combined = [
                  { id: 'custom-qr', uri: upiQrCodeUrl, type: 'image', title: `${name || 'Store'} Uploaded QR Standee` },
                  ...(activeCleanUpi ? [{ id: 'dynamic-qr', uri: qrUrl, type: 'image', title: `${name || 'Store'} Dynamic UPI QR Code` }] : []),
                  ...mediaList.filter((m) => m && m.type !== 'store_settings'),
                ];
                setViewerCustomMedia(combined);
                setSelectedMediaIndex(0);
                setShowMediaViewer(true);
              }}
              style={styles.qrCodeContainer}
            >
              <Image source={{ uri: upiQrCodeUrl }} style={styles.upiQrImage} />
              <Text style={styles.previewDesc}>Tap to view full screen</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* OPTIONAL MANUAL UPI ID ENTRY / EDIT */}
        <TouchableOpacity
          style={styles.manualToggleBtn}
          onPress={() => setShowManualUpiEdit(!showManualUpiEdit)}
          activeOpacity={0.8}
        >
          <Icon
            name={showManualUpiEdit ? 'chevron-down' : 'chevron-right'}
            size={12}
            color="#64748B"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.manualToggleBtnText}>
            {showManualUpiEdit ? 'Hide Manual UPI ID Input' : '✏️ Or edit / enter UPI ID manually'}
          </Text>
        </TouchableOpacity>

        {showManualUpiEdit && (
          <View style={styles.manualEditSection}>
            <Text style={styles.inputLabel}>Merchant ID / UPI ID</Text>
            <View style={styles.upiInputRow}>
              <TextInput
                style={[styles.input, styles.upiInputFlex]}
                placeholder="e.g. mystore, 9876543210, or store@okaxis"
                value={upiId}
                onChangeText={setUpiId}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.saveUpiBtn, savingUpiId && styles.buttonDisabled]}
                onPress={handleSaveUpiId}
                disabled={savingUpiId}
              >
                {savingUpiId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveUpiBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Quick Suffix Chips */}
            <View style={styles.upiChipsRow}>
              <Text style={styles.upiChipsLabel}>Quick Handles:</Text>
              {['@upi', '@okaxis', '@okhdfcbank', '@ybl', '@paytm'].map((suffix) => {
                const active = upiId.toLowerCase().endsWith(suffix.toLowerCase());
                return (
                  <TouchableOpacity
                    key={suffix}
                    style={[styles.upiChip, active && styles.upiChipActive]}
                    onPress={() => handleSelectUpiSuffix(suffix)}
                  >
                    <Text style={[styles.upiChipText, active && styles.upiChipTextActive]}>
                      {suffix}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.upiInputHelper}>
              💡 Enter your Merchant ID, 10-digit mobile number, or full UPI VPA. Customers will pay directly with their exact order bill amount at Checkout.
            </Text>
          </View>
        )}

        {/* Configurable Seller Setting: Print Dynamic QR Code with Price on Receipt & Orders */}
        {!isBuyer && (
          <View style={styles.upiDynamicQrConfigBox}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.upiDynamicQrConfigTitle}>Print Dynamic QR on Receipts &amp; Orders</Text>
              <Text style={styles.upiDynamicQrConfigSub}>
                Print dynamic UPI payment QR with exact order bill price on thermal receipts, order confirmations, and orders.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printDynamicQr !== false}
              onValueChange={handleTogglePrintDynamicQr}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printDynamicQr !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>
        )}
      </View>

      {/* Input Fields */}
      <View style={styles.formGroup}>
        <Text style={styles.inputLabel}>Full Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Name"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.inputLabel}>Email Address</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>Mobile Number</Text>
        <TextInput
          style={styles.input}
          placeholder="Mobile"
          value={mobile}
          onChangeText={setMobile}
          keyboardType="phone-pad"
        />


        <Text style={styles.inputLabel}>Address Line 1</Text>
        <TextInput
          style={styles.input}
          placeholder="Address Line 1"
          value={addressLine1}
          onChangeText={setAddressLine1}
        />

        <Text style={styles.inputLabel}>Address Line 2</Text>
        <TextInput
          style={styles.input}
          placeholder="Address Line 2"
          value={addressLine2}
          onChangeText={setAddressLine2}
        />

        <View style={styles.rowInputs}>
          <View style={styles.flex1}>
            <Text style={styles.inputLabel}>City</Text>
            <TextInput
              style={styles.input}
              placeholder="City"
              value={city}
              onChangeText={setCity}
            />
          </View>
          <View style={[styles.flex1, { marginLeft: 10 }]}>
            <Text style={styles.inputLabel}>State</Text>
            <TextInput
              style={styles.input}
              placeholder="State"
              value={state}
              onChangeText={setState}
            />
          </View>
        </View>

        <Text style={styles.inputLabel}>Zip / Postal Code</Text>
        <TextInput
          style={styles.input}
          placeholder="Zip Code"
          value={zipCode}
          onChangeText={setZipCode}
          keyboardType="numeric"
        />
      </View>

      <TouchableOpacity style={styles.locationButton} onPress={openLocationPicker}>
        <Text style={styles.locationButtonText}>📍 Select Location on Map</Text>
      </TouchableOpacity>
      {latitude != null && longitude != null && (
        <Text style={styles.locationText}>
          Latitude: {Number(latitude).toFixed(6)}, Longitude: {Number(longitude).toFixed(6)}
        </Text>
      )}

      {/* Update Profile Button */}
      <TouchableOpacity
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={handleUpdateProfile}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Update Profile</Text>
        )}
      </TouchableOpacity>

      {/* App Theme & Appearance Settings Card */}
      <View
        style={[
          styles.themeSectionCard,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
      >
        <View style={styles.themeHeaderRow}>
          <Icon name="adjust" size={18} color={colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.themeSectionTitle, { color: colors.text }]}>
            App Theme & Appearance
          </Text>
        </View>
        <Text style={[styles.themeSectionSub, { color: colors.textSecondary }]}>
          Choose your interface theme. System Default automatically matches your device dark/light settings.
        </Text>

        <View style={styles.themeOptionsRow}>
          {/* Light Mode */}
          <TouchableOpacity
            style={[
              styles.themeOption,
              { backgroundColor: colors.inputBg, borderColor: colors.border },
              themeMode === 'light' && [styles.themeOptionActive, { borderColor: colors.primary, backgroundColor: colors.primaryLight }],
            ]}
            onPress={() => handleSelectTheme('light')}
            activeOpacity={0.8}
            accessibilityLabel="Select Light Theme"
          >
            <View style={styles.themeOptionHeader}>
              <Text style={styles.themeOptionEmoji}>☀️</Text>
              <Text
                style={[
                  styles.themeOptionText,
                  { color: colors.text },
                  themeMode === 'light' && [styles.themeOptionTextActive, { color: colors.primary }],
                ]}
              >
                Light
              </Text>
              {themeMode === 'light' && (
                <Icon name="check-circle" size={15} color={colors.primary} style={{ marginLeft: 5 }} />
              )}
            </View>
            <Text style={[styles.themeOptionSub, { color: colors.textMuted }]}>Bright & crisp</Text>
          </TouchableOpacity>

          {/* Dark Mode */}
          <TouchableOpacity
            style={[
              styles.themeOption,
              { backgroundColor: colors.inputBg, borderColor: colors.border },
              themeMode === 'dark' && [styles.themeOptionActive, { borderColor: colors.primary, backgroundColor: colors.primaryLight }],
            ]}
            onPress={() => handleSelectTheme('dark')}
            activeOpacity={0.8}
            accessibilityLabel="Select Dark Theme"
          >
            <View style={styles.themeOptionHeader}>
              <Text style={styles.themeOptionEmoji}>🌙</Text>
              <Text
                style={[
                  styles.themeOptionText,
                  { color: colors.text },
                  themeMode === 'dark' && [styles.themeOptionTextActive, { color: colors.primary }],
                ]}
              >
                Dark
              </Text>
              {themeMode === 'dark' && (
                <Icon name="check-circle" size={15} color={colors.primary} style={{ marginLeft: 5 }} />
              )}
            </View>
            <Text style={[styles.themeOptionSub, { color: colors.textMuted }]}>Easy on eyes</Text>
          </TouchableOpacity>

          {/* System Mode */}
          <TouchableOpacity
            style={[
              styles.themeOption,
              { backgroundColor: colors.inputBg, borderColor: colors.border },
              themeMode === 'system' && [styles.themeOptionActive, { borderColor: colors.primary, backgroundColor: colors.primaryLight }],
            ]}
            onPress={() => handleSelectTheme('system')}
            activeOpacity={0.8}
            accessibilityLabel="Select System Default Theme"
          >
            <View style={styles.themeOptionHeader}>
              <Text style={styles.themeOptionEmoji}>⚙️</Text>
              <Text
                style={[
                  styles.themeOptionText,
                  { color: colors.text },
                  themeMode === 'system' && [styles.themeOptionTextActive, { color: colors.primary }],
                ]}
              >
                System
              </Text>
              {themeMode === 'system' && (
                <Icon name="check-circle" size={15} color={colors.primary} style={{ marginLeft: 5 }} />
              )}
            </View>
            <Text style={[styles.themeOptionSub, { color: colors.textMuted }]}>
              Auto ({isDark ? 'Dark' : 'Light'})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Voice Announcement Settings Card (Male / Female) */}
      <View style={styles.voiceSectionCard}>
        <View style={styles.voiceHeaderRow}>
          <Icon name="volume-up" size={18} color="#007AFF" style={{ marginRight: 8 }} />
          <Text style={styles.voiceSectionTitle}>Voice Announcement Settings</Text>
        </View>
        <Text style={styles.voiceSectionSub}>
          Select your preferred voice type (Male or Female) for order printout speech and incoming order voice alerts.
        </Text>

        <View style={styles.voiceGenderRow}>
          <TouchableOpacity
            style={[
              styles.voiceGenderOption,
              voiceGender === 'female' && styles.voiceGenderOptionActive,
            ]}
            onPress={() => handleSelectVoiceGender('female')}
            activeOpacity={0.8}
            accessibilityLabel="Select Female Voice"
          >
            <View style={styles.voiceOptionHeader}>
              <Text style={styles.voiceOptionEmoji}>👩</Text>
              <Text
                style={[
                  styles.voiceOptionText,
                  voiceGender === 'female' && styles.voiceOptionTextActive,
                ]}
              >
                Female Voice
              </Text>
              {voiceGender === 'female' && (
                <Icon name="check-circle" size={16} color="#007AFF" style={{ marginLeft: 6 }} />
              )}
            </View>
            <Text style={styles.voiceOptionSub}>Clear & Natural</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.voiceGenderOption,
              voiceGender === 'male' && styles.voiceGenderOptionActive,
            ]}
            onPress={() => handleSelectVoiceGender('male')}
            activeOpacity={0.8}
            accessibilityLabel="Select Male Voice"
          >
            <View style={styles.voiceOptionHeader}>
              <Text style={styles.voiceOptionEmoji}>👨</Text>
              <Text
                style={[
                  styles.voiceOptionText,
                  voiceGender === 'male' && styles.voiceOptionTextActive,
                ]}
              >
                Male Voice
              </Text>
              {voiceGender === 'male' && (
                <Icon name="check-circle" size={16} color="#007AFF" style={{ marginLeft: 6 }} />
              )}
            </View>
            <Text style={styles.voiceOptionSub}>Deep & Professional</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.voiceTestButton}
          onPress={handleTestVoice}
          disabled={testingVoice}
          activeOpacity={0.8}
        >
          {testingVoice ? (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />
          ) : (
            <Icon name="play" size={13} color="#007AFF" style={{ marginRight: 8 }} />
          )}
          <Text style={styles.voiceTestButtonText}>
            {testingVoice ? 'Speaking Sample...' : `Test ${voiceGender === 'male' ? 'Male' : 'Female'} Voice`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Receipt & Thermal Printer Settings Card (Sellers, Delivery, Admins) */}
      {!isBuyer && (
        <View style={styles.printerSectionCard}>
          <View style={styles.printerHeaderRow}>
            <Icon name="print" size={18} color="#007AFF" style={{ marginRight: 8 }} />
            <Text style={styles.printerSectionTitle}>Receipt & Thermal Printer Settings</Text>
          </View>
          <Text style={styles.printerSectionSub}>
            Configure thermal POS printer layout, uncheck header part, and require day-wise token number.
          </Text>

          {/* Toggle 1: Print Receipt Header (Uncheck header part) */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Print Receipt Header</Text>
              <Text style={styles.printerToggleSub}>
                Include Store Name, Address, Contact, and GSTIN. Uncheck this option to skip the header part and save paper.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printHeader !== false}
              onValueChange={handleTogglePrintHeader}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printHeader !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          <View style={styles.printerDivider} />

          {/* Toggle 2: Required Daywise Number */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Required Day-wise Order Number</Text>
              <Text style={styles.printerToggleSub}>
                Prominently print Day-wise Order Number (Daily Token #) on every receipt for kitchen and dispatch.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printDayWiseNumber !== false}
              onValueChange={handleToggleDayWiseNumber}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printDayWiseNumber !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          <View style={styles.printerDivider} />

          {/* Tax & Service Charges Section */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Enable GST (CGST + SGST)</Text>
              <Text style={styles.printerToggleSub}>
                Automatically calculate and add CGST & SGST percentages to bills and receipts.
              </Text>
            </View>
            <Switch
              value={printerConfig?.enableTax === true}
              onValueChange={handleToggleTax}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.enableTax ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          {printerConfig?.enableTax && (
            <View style={styles.profileTaxInputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.profileTaxInputLabel}>CGST Rate (%)</Text>
                <TextInput
                  style={styles.profileTaxInputField}
                  value={String(printerConfig?.cgstRate !== undefined ? printerConfig.cgstRate : '2.5')}
                  onChangeText={handleUpdateCgstRate}
                  placeholder="2.5"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileTaxInputLabel}>SGST Rate (%)</Text>
                <TextInput
                  style={styles.profileTaxInputField}
                  value={String(printerConfig?.sgstRate !== undefined ? printerConfig.sgstRate : '2.5')}
                  onChangeText={handleUpdateSgstRate}
                  placeholder="2.5"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          )}

          <View style={styles.printerDivider} />

          {/* Service Charge Toggle */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Enable Service Charge / Cost</Text>
              <Text style={styles.printerToggleSub}>
                Add restaurant or packaging service charge percentage to the order total.
              </Text>
            </View>
            <Switch
              value={printerConfig?.enableServiceCost === true}
              onValueChange={handleToggleServiceCost}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.enableServiceCost ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          {printerConfig?.enableServiceCost && (
            <View style={[styles.profileTaxInputRow, { marginTop: 4 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileTaxInputLabel}>Service Charge Rate (%)</Text>
                <TextInput
                  style={styles.profileTaxInputField}
                  value={String(printerConfig?.serviceCostRate !== undefined ? printerConfig.serviceCostRate : '5')}
                  onChangeText={handleUpdateServiceCostRate}
                  placeholder="e.g. 5"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          )}

          <View style={styles.printerDivider} />

          {/* Print Tax Breakdown on Receipt Toggle */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Print Tax & Service Breakdown on Receipts</Text>
              <Text style={styles.printerToggleSub}>
                Print separate itemized lines for CGST, SGST, and Service Charge on receipts.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printTaxBreakdown !== false}
              onValueChange={handleTogglePrintTaxBreakdown}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printTaxBreakdown !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          <View style={styles.printerDivider} />

          {/* Toggle: Print Dynamic QR Code with Price on Receipt */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Print Dynamic QR Code with Price</Text>
              <Text style={styles.printerToggleSub}>
                Print dynamic UPI payment QR code with the exact bill price on every receipt so buyers can scan and pay anytime.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printDynamicQr !== false}
              onValueChange={handleTogglePrintDynamicQr}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printDynamicQr !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          <View style={styles.printerDivider} />

          {/* Toggle: Print Order Barcode (Code-128) */}
          <View style={styles.printerToggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.printerToggleTitle}>Print Order Barcode (Code-128)</Text>
              <Text style={styles.printerToggleSub}>
                Print scannable 1D barcode of the order number on receipts for fast tracking using phone camera or scanner.
              </Text>
            </View>
            <Switch
              value={printerConfig?.printOrderBarcode !== false}
              onValueChange={handleTogglePrintOrderBarcode}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={printerConfig?.printOrderBarcode !== false ? '#007AFF' : '#F1F5F9'}
            />
          </View>

          <View style={styles.printerDivider} />

          {/* Barcode & QR Display Size */}
          <View style={{ marginVertical: 6 }}>
            <Text style={styles.printerToggleTitle}>Barcode & QR Code Display Size</Text>
            <Text style={styles.printerToggleSub}>
              Select size to ensure clear scanning from mobile phone cameras (Google Pay, PhonePe, Paytm).
            </Text>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {['normal', 'large', 'extra_large'].map((s) => {
                const isSelected = (!printerConfig?.qrCodeSize && s === 'large') || printerConfig?.qrCodeSize === s;
                const labels = {
                  normal: 'Standard',
                  large: 'Large (Recommended)',
                  extra_large: 'Extra Large',
                };
                return (
                  <TouchableOpacity
                    key={s}
                    style={{
                      flex: 1,
                      backgroundColor: isSelected ? '#F0F7FF' : '#F8FAFC',
                      borderWidth: 1.5,
                      borderColor: isSelected ? '#007AFF' : '#E2E8F0',
                      borderRadius: 8,
                      paddingVertical: 8,
                      paddingHorizontal: 4,
                      marginHorizontal: 3,
                      alignItems: 'center',
                    }}
                    onPress={() => handleSelectQrCodeSize(s)}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: isSelected ? '#007AFF' : '#334155',
                        textAlign: 'center',
                      }}
                    >
                      {labels[s]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Full Printer Setup Modal Button */}
          <TouchableOpacity
            style={styles.printerSetupBtn}
            onPress={() => setShowPrinterSettings(true)}
            activeOpacity={0.8}
          >
            <Icon name="sliders" size={15} color="#007AFF" style={{ marginRight: 8 }} />
            <Text style={styles.printerSetupBtnText}>
              Full Thermal Printer Setup (Bluetooth, 58mm/80mm, Feed, Test Print)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Delivery Partner & Free Delivery Threshold Settings Card */}
      <View style={styles.printerCard}>
        <View style={styles.printerCardHeader}>
          <Icon name="truck" size={18} color="#059669" style={{ marginRight: 8 }} />
          <Text style={styles.printerCardTitle}>Delivery Partner & Fee Settings</Text>
        </View>

        <Text style={styles.printerSectionDesc}>
          Configure your store's customer delivery charges, free delivery threshold (e.g. Orders ≥ ₹200), and rider payout rules.
        </Text>

        <View style={styles.printerToggleRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.printerToggleTitle}>Enable Customer Delivery</Text>
            <Text style={styles.printerToggleSub}>
              Allow buyers to select Parcel / Delivery orders to their doorstep.
            </Text>
          </View>
          <Switch
            value={enableDelivery}
            onValueChange={setEnableDelivery}
            trackColor={{ false: '#CBD5E1', true: '#A7F3D0' }}
            thumbColor={enableDelivery ? '#059669' : '#F1F5F9'}
          />
        </View>

        {enableDelivery && (
          <>
            <View style={styles.printerDivider} />
            <View style={styles.profileTaxInputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.profileTaxInputLabel}>Default Delivery Fee (₹)</Text>
                <TextInput
                  style={styles.profileTaxInputField}
                  value={defaultDeliveryFee}
                  onChangeText={setDefaultDeliveryFee}
                  placeholder="30"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileTaxInputLabel}>Free Delivery Above (₹)</Text>
                <TextInput
                  style={styles.profileTaxInputField}
                  value={freeDeliveryThreshold}
                  onChangeText={setFreeDeliveryThreshold}
                  placeholder="200"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={{ backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', borderRadius: 6, padding: 10, marginTop: 10 }}>
              <Text style={{ fontSize: 12, color: '#065F46', lineHeight: 17 }}>
                💡 <Text style={{ fontWeight: '700' }}>Industry Standard Rule:</Text> Orders total &lt; ₹{freeDeliveryThreshold || '200'} charge ₹{defaultDeliveryFee || '30'} delivery fee. Orders total ≥ ₹{freeDeliveryThreshold || '200'} unlock 100% <Text style={{ fontWeight: '700' }}>FREE Delivery</Text> for customers.
              </Text>
            </View>
          </>
        )}
      </View>

      {Platform.OS === 'web' && (
        <View style={styles.webNotifCard}>
          <View style={styles.webNotifHeader}>
            <Icon name="bell" size={16} color="#007AFF" style={{ marginRight: 8 }} />
            <Text style={styles.webNotifTitle}>Web Browser Notifications</Text>
          </View>
          <Text style={styles.webNotifDesc}>
            {webNotifPermission === 'granted'
              ? '✅ Active: You will receive real-time order alerts and popups on web.'
              : webNotifPermission === 'denied'
              ? '❌ Blocked: Notifications blocked. Allow notifications in browser address bar settings to get alerts.'
              : '⚠️ Not Enabled: Allow browser notifications to get alerts even when working in other tabs.'}
          </Text>
          {webNotifPermission !== 'granted' && (
            <TouchableOpacity
              style={styles.enableNotifBtn}
              onPress={handleEnableWebNotifications}
              activeOpacity={0.8}
            >
              <Text style={styles.enableNotifBtnText}>Enable Browser Notifications</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity
        style={styles.button}
        onPress={handleSendTestNotification}
      >
        <Text style={styles.buttonText}>Send Test Notification</Text>
      </TouchableOpacity>

      {profile && profile.role === 'admin' && (
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('AdminMap')}
        >
          <Text style={styles.buttonText}>View Delivery Managers Map</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>

      {/* Media Fullscreen Preview Modal with Swipe/Scroll Left-Right */}
      <FullScreenImageViewer
        visible={showMediaViewer}
        mediaList={viewerCustomMedia || mediaList.filter((m) => m && m.type !== 'store_settings')}
        initialIndex={selectedMediaIndex}
        onClose={() => {
          setShowMediaViewer(false);
          setViewerCustomMedia(null);
        }}
        title={name ? `${name}'s Media` : 'Profile Photos & Video'}
      />

      {/* Printer Settings Modal */}
      <PrinterSettingsModal
        visible={showPrinterSettings}
        onClose={() => {
          setShowPrinterSettings(false);
          loadPrinterSettings();
        }}
      />

      {/* Interactive Map Area Search & Location Picker Modal */}
      <Modal
        visible={showLocationPicker}
        animationType="slide"
        onRequestClose={() => setShowLocationPicker(false)}
      >
        <SafeAreaView style={styles.mapModalSafeArea}>
          <View style={styles.mapModalContainer}>
            {/* Modal Header */}
            <View style={styles.mapModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mapModalTitle}>📍 Set Location on Map</Text>
                <Text style={styles.mapModalSubtitle}>
                  Search any area or drag / tap marker on the map
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLocationPicker(false)}
                style={styles.mapModalCloseBtn}
              >
                <Icon name="times" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Map Area Search Bar */}
            <View style={styles.mapSearchContainer}>
              <View style={styles.mapSearchInputWrap}>
                <Icon name="search" size={15} color="#007AFF" style={styles.mapSearchIcon} />
                <TextInput
                  value={mapSearchQuery}
                  onChangeText={handleAreaSearchChange}
                  placeholder="Search any area, city or landmark (e.g. Madhapur)..."
                  placeholderTextColor="#94A3B8"
                  style={styles.mapSearchInput}
                  returnKeyType="search"
                />
                {mapSearchLoading && (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />
                )}
                {mapSearchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setMapSearchQuery('');
                      setMapSearchSuggestions([]);
                    }}
                    style={styles.mapSearchClearBtn}
                  >
                    <Icon name="times-circle" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Suggestions Dropdown */}
              {mapSearchSuggestions.length > 0 && (
                <View style={styles.mapSuggestionsListWrap}>
                  <FlatList
                    data={mapSearchSuggestions}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.mapSuggestionRow}
                        onPress={() => handleSelectAreaSuggestion(item)}
                      >
                        <View style={styles.mapSuggestionIconBox}>
                          <Icon name="map-marker" size={14} color="#007AFF" />
                        </View>
                        <View style={styles.mapSuggestionTextBox}>
                          <Text style={styles.mapSuggestionTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.mapSuggestionSubtitle} numberOfLines={1}>
                            {item.subtitle}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}
            </View>

            {/* Map Container */}
            <View style={styles.mapViewBox}>
              {mapInitialRegion && (
                <LeafletMap
                  ref={mapRef}
                  initialRegion={mapInitialRegion}
                  markerCoordinate={markerLocation}
                  onMarkerDragEnd={handleMapLocationChange}
                  onMapPress={handleMapLocationChange}
                />
              )}

              {/* Floating GPS Current Location Button */}
              <TouchableOpacity
                style={styles.mapGpsButton}
                onPress={handleUseCurrentLocation}
                activeOpacity={0.85}
              >
                <Icon name="crosshairs" size={20} color="#007AFF" />
              </TouchableOpacity>
            </View>

            {/* Bottom Info & Confirmation Sheet */}
            <View style={styles.mapBottomCard}>
              <View style={styles.selectedLocationInfoRow}>
                <Icon name="map-pin" size={16} color="#007AFF" style={{ marginTop: 2, marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedLocationName} numberOfLines={1}>
                    {selectedAreaInfo?.name || "Selected Location"}
                  </Text>
                  {selectedAreaInfo?.fullAddress ? (
                    <Text style={styles.selectedLocationAddress} numberOfLines={2}>
                      {selectedAreaInfo.fullAddress}
                    </Text>
                  ) : null}
                  {markerLocation && (
                    <Text style={styles.selectedCoordsText}>
                      Coordinates: {markerLocation.latitude.toFixed(6)}, {markerLocation.longitude.toFixed(6)}
                    </Text>
                  )}
                </View>
              </View>

              {/* Auto-fill address toggle */}
              <TouchableOpacity
                style={styles.autoFillRow}
                onPress={() => setAutoFillAddress(!autoFillAddress)}
                activeOpacity={0.8}
              >
                <Icon
                  name={autoFillAddress ? "check-square" : "square-o"}
                  size={18}
                  color={autoFillAddress ? "#007AFF" : "#94A3B8"}
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.autoFillText}>
                  Auto-fill City, State & Zip from this area
                </Text>
              </TouchableOpacity>

              {/* Action Buttons */}
              <View style={styles.mapModalActionRow}>
                <TouchableOpacity
                  style={styles.mapCancelBtn}
                  onPress={() => setShowLocationPicker(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.mapCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mapConfirmBtn}
                  onPress={confirmLocationSelection}
                  activeOpacity={0.85}
                >
                  <Icon name="check" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.mapConfirmBtnText}>Set This Location</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </ScrollView>

    {/* Persistent Bottom Navigation Footer */}
    <StoreNavigationFooter
      activeTab="profile"
      navigation={navigation}
      route={route}
      forceShow={true}
    />
  </View>
);
};

const styles = StyleSheet.create({
  rootWrapper: {
    flex: 1,
    height: Platform.OS === 'web' ? '100%' : undefined,
    maxHeight: Platform.OS === 'web' ? '100vh' : undefined,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    ...(Platform.OS === 'web' ? { overflowY: 'auto' } : {}),
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 160,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
    color: '#1e293b',
  },
  profileHeaderBox: {
    alignItems: 'center',
    marginBottom: 16,
  },
  profileRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 4,
    borderWidth: 1,
  },
  roleBadgeAdmin: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  roleBadgeSeller: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  roleBadgeDelivery: {
    backgroundColor: '#FAF5FF',
    borderColor: '#E9D5FF',
  },
  roleBadgeCustomer: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  profileRoleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  roleBadgeTextAdmin: {
    color: '#B45309',
  },
  roleBadgeTextSeller: {
    color: '#059669',
  },
  roleBadgeTextDelivery: {
    color: '#7C3AED',
  },
  roleBadgeTextCustomer: {
    color: '#0284C7',
  },
  mediaSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  mediaHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  mediaCounterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284c7',
  },
  mediaButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  mediaActionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActionBtn: {
    backgroundColor: '#0284c7',
  },
  videoActionBtn: {
    backgroundColor: '#7c3aed',
  },
  mediaActionBtnDisabled: {
    backgroundColor: '#cbd5e1',
    opacity: 0.6,
  },
  mediaActionBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  mediaListContainer: {
    flexDirection: 'row',
    paddingVertical: 6,
    gap: 12,
  },
  mediaItemWrapper: {
    position: 'relative',
    marginRight: 10,
  },
  mediaThumbnailContainer: {
    width: 110,
    height: 110,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  mediaThumbnail: {
    width: '100%',
    height: '100%',
  },
  videoThumbnailContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayOverlay: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayIcon: {
    color: '#ffffff',
    fontSize: 16,
    marginLeft: 3,
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(2, 132, 199, 0.85)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(124, 58, 237, 0.85)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  removeMediaBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    zIndex: 10,
  },
  removeMediaBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 14,
  },
  emptyMediaBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  emptyMediaIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  emptyMediaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  emptyMediaSubtext: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  upiSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  upiHeaderRow: {
    marginBottom: 4,
  },
  qrUploadHeroCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginTop: 10,
    marginBottom: 14,
  },
  qrHeroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  qrHeroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrHeroTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  qrHeroSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 16,
  },
  qrActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  qrActionBtnPrimary: {
    flex: 1,
    minWidth: 160,
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  qrActionBtnPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  qrActionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  qrActionBtnSecondaryText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },
  qrScanningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
  },
  qrScanningText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284c7',
  },
  manualToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  manualToggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  manualEditSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  upiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  upiInputFlex: {
    flex: 1,
    marginBottom: 0,
  },
  saveUpiBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveUpiBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  upiChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  upiChipsLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginRight: 2,
  },
  upiChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  upiChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  upiChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  upiChipTextActive: {
    color: '#ffffff',
  },
  upiInputHelper: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 15,
  },
  dynamicPreviewContainer: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 12,
    marginBottom: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  dynamicBadge: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dynamicBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  previewHint: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '500',
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 10,
    gap: 12,
  },
  previewQrImage: {
    width: 90,
    height: 90,
    borderRadius: 6,
  },
  previewInfo: {
    flex: 1,
  },
  previewPayee: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  previewUpiId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
    marginTop: 2,
  },
  previewDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 15,
  },
  customQrSection: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 12,
  },
  customQrTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  qrLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  upiQrImage: {
    width: 140,
    height: 140,
    resizeMode: 'contain',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 13,
  },
  formGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
    color: '#1e293b',
  },
  rowInputs: {
    flexDirection: 'row',
  },
  flex1: {
    flex: 1,
  },
  locationButton: {
    backgroundColor: '#0284c7',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  locationButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  locationText: {
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
    color: '#475569',
  },
  button: {
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  printerButton: {
    backgroundColor: '#0ea5e9',
  },
  logoutButton: {
    backgroundColor: '#dc2626',
    marginTop: 10,
  },
  previewModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewCloseBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    zIndex: 10,
  },
  previewCloseBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  previewMediaBox: {
    width: '100%',
    height: '75%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  fullVideo: {
    width: '100%',
    height: '100%',
  },
  mapModalSafeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mapModalContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  mapModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  mapModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  mapModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  mapModalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  mapSearchContainer: {
    position: 'relative',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 50,
  },
  mapSearchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mapSearchIcon: {
    marginRight: 8,
  },
  mapSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  mapSearchClearBtn: {
    padding: 4,
  },
  mapSuggestionsListWrap: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    maxHeight: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 100,
    overflow: 'hidden',
  },
  mapSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  mapSuggestionIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  mapSuggestionTextBox: {
    flex: 1,
  },
  mapSuggestionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  mapSuggestionSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  mapViewBox: {
    flex: 1,
    position: 'relative',
  },
  mapGpsButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 20,
  },
  mapBottomCard: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 6,
  },
  selectedLocationInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  selectedLocationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectedLocationAddress: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  selectedCoordsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0284C7',
    marginTop: 3,
  },
  autoFillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 10,
  },
  autoFillText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  mapModalActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mapCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  mapConfirmBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  mapConfirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Store & Product Control Card Styles
  storeControlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  storeControlHeader: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  storeControlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeControlTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  storeControlSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusPillActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusPillInactive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  toggleLabelCol: {
    flex: 1,
  },
  toggleTitleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  toggleDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
  },
  storeQuickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  storeQuickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  storeQuickBtnActive: {
    backgroundColor: '#10B981',
  },
  storeQuickBtnInactive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  storeQuickBtnTextActive: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  storeQuickBtnTextInactive: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },

  // AppAdmin Master Card Styles
  adminMasterCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  adminHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  adminCrownBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#92400E',
  },
  adminCardSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
  },
  adminRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  adminGlobalActionsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  adminGlobalTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#78350F',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  adminGlobalBtnsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  adminGlobalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  adminGlobalBtnActive: {
    backgroundColor: '#059669',
  },
  adminGlobalBtnInactive: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  adminGlobalBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  adminSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  adminSearchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
  },
  adminSellersList: {
    gap: 8,
  },
  adminSellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  adminSellerInfoCol: {
    flex: 1,
  },
  adminSellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  adminSellerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  miniStatusTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  miniStatusTagActive: {
    backgroundColor: '#ECFDF5',
  },
  miniStatusTagInactive: {
    backgroundColor: '#FEF2F2',
  },
  miniStatusTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  adminSellerMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  adminSellerControlsCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  adminToggleMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminToggleMiniLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginRight: 2,
  },
  themeSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  themeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  themeSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  themeSectionSub: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOption: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  themeOptionActive: {
    borderColor: '#007AFF',
    backgroundColor: '#EFF6FF',
  },
  themeOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  themeOptionEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  themeOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  themeOptionTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  themeOptionSub: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '500',
    textAlign: 'center',
  },
  voiceSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  voiceSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  voiceSectionSub: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  voiceGenderRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  voiceGenderOption: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  voiceGenderOptionActive: {
    borderColor: '#007AFF',
    backgroundColor: '#EFF6FF',
  },
  voiceOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  voiceOptionEmoji: {
    fontSize: 20,
    marginRight: 6,
  },
  voiceOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  voiceOptionTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  voiceOptionSub: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  voiceTestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 4,
  },
  voiceTestButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
  },
  printerSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  printerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  printerSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  printerSectionSub: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  printerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  printerToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 3,
  },
  printerToggleSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  printerDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  printerSetupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  printerSetupBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
  },
  profileTaxInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  profileTaxInputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  profileTaxInputField: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  webNotifCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  webNotifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  webNotifTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  webNotifDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 10,
  },
  enableNotifBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  enableNotifBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  upiDynamicQrConfigBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  upiDynamicQrConfigTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#15803D',
  },
  upiDynamicQrConfigSub: {
    fontSize: 12,
    color: '#166534',
    marginTop: 3,
    lineHeight: 16,
  },
  salesReportProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  salesReportProfileIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  salesReportProfileTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#312E81',
  },
  salesReportProfileSub: {
    fontSize: 11,
    color: '#4338CA',
    marginTop: 2,
    lineHeight: 15,
  },
});

export default ProfileScreen;