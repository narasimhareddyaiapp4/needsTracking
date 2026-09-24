import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Modal,
  FlatList,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { Picker } from '@react-native-picker/picker';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LeafletMap from '../components/LeafletMap';
import {
  supabase,
  getCart,
  getActiveQrCode,
  updateQrCode,
  getUserAddresses,
  addUserAddress,
  deleteUserAddress,
  extractMerchantUpi,
} from '../services/supabase';
import { getGuestCart, clearGuestCart, getPreferredStore, saveGuestOrderId } from '../services/localStorageService';
import { schedulePushNotification } from '../services/notificationService';
import { showAlert } from '../utils/alertUtils';
import { downloadQrCodeImage } from '../utils/qrDownloadUtils';
import { getPrinterConfig, printReceipt, extractOrderNumbers, announceOrderPrint } from '../services/printerService';
import { getActiveEmployeeSession, resolveEmployeeSession } from '../services/employeeService';
import { useCart } from '../context/CartContext';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import {
  decodeQrFromImage,
  generateQrDataUrl,
  buildUpiPaymentUri,
  buildAndroidIntentUri,
  buildUpiAppLinks,
  openUpiAppIntent,
  parseUpiString,
  normalizeUpiId,
  isGenericQrName,
  resolveUploadedQrDetails,
  formatUpiTransactionNote,
} from '../services/qrScanService';

const CheckoutScreen = ({ navigation, route }) => {
  const { cart: initialCart, customerId } = route?.params || {};
  const [cart, setCart] = useState(initialCart || null);
  const cartContext = useCart ? useCart() : null;
  const contextSetCart = cartContext?.setCart;

  // Seller / Employee Fast POS Counter Billing States
  const [activeEmployee, setActiveEmployee] = useState(null);
  const [showPosConfirmModal, setShowPosConfirmModal] = useState(false);
  const [posPaymentMethod, setPosPaymentMethod] = useState('cash'); // 'cash' | 'upi'
  const [posPrintReceipt, setPosPrintReceipt] = useState(false);
  const [isProcessingPos, setIsProcessingPos] = useState(false);
  const [posCustomerName, setPosCustomerName] = useState('');
  const [posCustomerMobile, setPosCustomerMobile] = useState('');
  const [posTableNo, setPosTableNo] = useState('Main counter');
  const [showPosSuccessModal, setShowPosSuccessModal] = useState(false);
  const [posSuccessData, setPosSuccessData] = useState(null);
  const [successCountdown, setSuccessCountdown] = useState(3);

  useEffect(() => {
    if (route?.params?.cart) {
      setCart(route.params.cart);
    }
  }, [route?.params?.cart]);
  const [currentUser, setCurrentUser] = useState(null);
  const [isQrViewerVisible, setIsQrViewerVisible] = useState(false);
  const [qrViewerMedia, setQrViewerMedia] = useState([]);
  const [qrViewerIndex, setQrViewerIndex] = useState(0);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('India');
  const [selectedCoords, setSelectedCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orderType, setOrderType] = useState('Dine-in');
  const [tableNo, setTableNo] = useState('Main counter');

  // Multiple Addresses Management States
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [modalTag, setModalTag] = useState('Home'); // 'Home' | 'Work' | 'Other'
  const [modalRecipientName, setModalRecipientName] = useState('');
  const [modalMobile, setModalMobile] = useState('');
  const [modalAddressLine1, setModalAddressLine1] = useState('');
  const [modalCity, setModalCity] = useState('');
  const [modalState, setModalState] = useState('');
  const [modalZipCode, setModalZipCode] = useState('');
  const [modalCoords, setModalCoords] = useState(null);
  const [mapInitialRegion, setMapInitialRegion] = useState({ latitude: 28.6139, longitude: 77.2090 });
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const [mapSearchSuggestions, setMapSearchSuggestions] = useState([]);
  const [savingAddress, setSavingAddress] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const addressMapRef = useRef(null);

  // Email OTP Mobile Validation States
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [isMobileVerified, setIsMobileVerified] = useState(false);

  // UPI QR Code State (strictly from seller profile)
  const [sellerQr, setSellerQr] = useState(null);
  const [sellerProfile, setSellerProfile] = useState(null);
  const [sellerUpiId, setSellerUpiId] = useState('');
  const [sellerQrPayeeName, setSellerQrPayeeName] = useState('');
  const [sellerRawUpiText, setSellerRawUpiText] = useState('');
  const [loadingSellerQr, setLoadingSellerQr] = useState(false);
  // 6-digit unique payment transaction reference (strictly digits, easy to identify in UPI statements)
  const [uniquePaymentCode, setUniquePaymentCode] = useState(() =>
    Math.floor(100000 + Math.random() * 900000).toString()
  );
  const [dynamicQrDataUrl, setDynamicQrDataUrl] = useState(null);
  const [qrTab, setQrTab] = useState('dynamic'); // 'dynamic' | 'profile'
  const [qrImageLoading, setQrImageLoading] = useState(false);
  const [qrImageError, setQrImageError] = useState(false);
  const [isScanningProfileQr, setIsScanningProfileQr] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [sellerTaxConfig, setSellerTaxConfig] = useState(null);

  // Order Type Modal State (Prompted when user clicks Pay with UPI)
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [orderTypeModalAction, setOrderTypeModalAction] = useState('select_upi'); // 'select_upi' | 'place_order'
  const [orderTypeConfirmed, setOrderTypeConfirmed] = useState(false);


  const normalizeGuestCart = (guestCartData) => ({
    cart_items: (guestCartData || []).map((item) => {
      const existingMedia = item.product_variant_combinations?.products?.product_media;
      const mediaUrl = item.image_url || (Array.isArray(existingMedia) && existingMedia[0]?.media_url) || null;
      return {
        id: item.product_variant_combination_id || item.id,
        quantity: item.quantity || 1,
        product_variant_combinations: {
          id: item.product_variant_combination_id || item.id,
          combination_string: item.combination_string || 'Default',
          price: item.price || 0,
          products: {
            id: item.product_id || item.product_variant_combinations?.products?.id,
            product_name: item.product_name || item.product_variant_combinations?.products?.product_name || 'Product',
            customer_id: item.customer_id || item.product_variant_combinations?.products?.customer_id || null,
            user_id: item.user_id || item.product_variant_combinations?.products?.user_id || null,
            product_media: existingMedia && existingMedia.length > 0
              ? existingMedia
              : (mediaUrl ? [{ media_url: mediaUrl, media_type: 'image' }] : []),
          },
        },
      };
    }),
  });

  const refreshCartAndUser = useCallback(async () => {
    try {
      const { data: { user } = {} } = await supabase.auth.getUser();
      setCurrentUser(user || null);

      if (user) {
        setName((prev) => prev || user.user_metadata?.full_name || user.user_metadata?.name || '');
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        // Check persistent local storage and user metadata for verification
        let isPersistentlyVerified = false;
        try {
          const localVerified = await AsyncStorage.getItem(`@checkout_verified_${user.id}`);
          if (localVerified === 'true') {
            isPersistentlyVerified = true;
          }
        } catch (_) {}

        const isAccountVerified =
          isPersistentlyVerified ||
          Boolean(user.email_confirmed_at) ||
          Boolean(user.confirmed_at) ||
          user.user_metadata?.email_verified === true ||
          user.user_metadata?.mobile_verified === true;

        if (profileData) {
          setProfile(profileData);
          if (profileData.mobile) {
            setMobile((prev) => prev || profileData.mobile);
            setIsMobileVerified(true);
          } else if (user.user_metadata?.mobile || user.phone) {
            setMobile((prev) => prev || user.user_metadata?.mobile || user.phone || '');
          }
          setAddress((prev) => prev || profileData.address_line_1 || '');
          setCity((prev) => prev || profileData.city || '');
          setPostalCode((prev) => prev || profileData.zip_code || '');
          if (profileData.latitude && profileData.longitude) {
            const profCoords = {
              latitude: Number(profileData.latitude),
              longitude: Number(profileData.longitude),
            };
            setSelectedCoords(profCoords);
            setMapInitialRegion(profCoords);
          }
        }

        if (isAccountVerified || profileData?.mobile) {
          setIsMobileVerified(true);
        }

        // Fetch multiple addresses for this buyer
        const addresses = await getUserAddresses(user.id);
        if (addresses && addresses.length > 0) {
          setSavedAddresses(addresses);
          const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
          setSelectedAddressId(defaultAddr.id);
          setName(defaultAddr.recipient_name || '');
          setMobile(defaultAddr.mobile || '');
          setAddress(defaultAddr.address_line_1 || '');
          setCity(defaultAddr.city || '');
          setPostalCode(defaultAddr.zip_code || '');
          if (defaultAddr.latitude && defaultAddr.longitude) {
            setSelectedCoords({
              latitude: Number(defaultAddr.latitude),
              longitude: Number(defaultAddr.longitude),
            });
          }
        }

        // Check active employee / cashier session
        try {
          let emp = await getActiveEmployeeSession();
          if (!emp && user) {
            emp = await resolveEmployeeSession(user);
          }
          if (emp) {
            setActiveEmployee(emp);
          }
        } catch (empErr) {
          console.warn('Notice checking employee session in checkout:', empErr);
        }

        const userCart = await getCart(user.id);
        if (userCart && userCart.cart_items && userCart.cart_items.length > 0) {
          setCart(userCart);
        } else if (initialCart?.cart_items && initialCart.cart_items.length > 0) {
          setCart(initialCart);
        }
      } else {
        if (!initialCart || !initialCart.cart_items || initialCart.cart_items.length === 0) {
          const guestCartData = await getGuestCart();
          setCart(normalizeGuestCart(guestCartData));
        }
      }
    } catch (err) {
      console.warn('Error in refreshCartAndUser:', err);
    }
  }, [initialCart]);

  // Sync active employee details from route parameters if passed
  useEffect(() => {
    if (route?.params?.employeeId || route?.params?.employeeName) {
      setActiveEmployee((prev) => ({
        ...(prev || {}),
        id: route.params.employeeId || prev?.id,
        name: route.params.employeeName || prev?.name,
        seller_id: route.params.sellerId || prev?.seller_id,
        designation: route.params.employeeDesignation || prev?.designation,
      }));
    }
  }, [route?.params]);

  const isEmployee = Boolean(
    activeEmployee ||
    route?.params?.isEmployee ||
    route?.params?.role === 'seller_employee' ||
    profile?.role === 'seller_employee' ||
    currentUser?.user_metadata?.role === 'seller_employee'
  );

  const isSeller = Boolean(
    !isEmployee && (
      profile?.role === 'seller' ||
      currentUser?.user_metadata?.role === 'seller' ||
      route?.params?.role === 'seller'
    )
  );

  const isSellerOrEmployee = isSeller || isEmployee;

  useEffect(() => {
    refreshCartAndUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        refreshCartAndUser();
      } else {
        setCurrentUser(null);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe?.();
    };
  }, [refreshCartAndUser]);

  const [shippingAddress, setShippingAddress] = useState({
    name: '',
    mobile: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
    country: 'India',
    latitude: null,
    longitude: null,
  });

  useEffect(() => {
    setShippingAddress({
      name,
      mobile: (mobile || '').trim(),
      phone: (mobile || '').trim(),
      address,
      city,
      postalCode,
      country,
      latitude: selectedCoords?.latitude || null,
      longitude: selectedCoords?.longitude || null,
    });
  }, [name, mobile, address, city, postalCode, country, selectedCoords]);

  const cartItems = cart?.cart_items || [];
  const subtotal = cartItems.reduce(
    (total, item) =>
      total +
      (Number(item?.product_variant_combinations?.price || item?.price || 0) *
        Number(item?.quantity || 1)),
    0
  );

  const isTaxEnabled = sellerTaxConfig?.enableTax === true;
  const isServiceCostEnabled = sellerTaxConfig?.enableServiceCost === true;

  const cgstRate = isTaxEnabled ? Number(sellerTaxConfig?.cgstRate !== undefined ? sellerTaxConfig.cgstRate : 2.5) : 0;
  const sgstRate = isTaxEnabled ? Number(sellerTaxConfig?.sgstRate !== undefined ? sellerTaxConfig.sgstRate : 2.5) : 0;
  const serviceCostRate = isServiceCostEnabled ? Number(sellerTaxConfig?.serviceCostRate !== undefined ? sellerTaxConfig.serviceCostRate : 0) : 0;

  const cgstAmount = isTaxEnabled && subtotal > 0 ? Math.round(subtotal * (cgstRate / 100) * 100) / 100 : 0;
  const sgstAmount = isTaxEnabled && subtotal > 0 ? Math.round(subtotal * (sgstRate / 100) * 100) / 100 : 0;
  const serviceCost = isServiceCostEnabled && subtotal > 0 && serviceCostRate > 0 ? Math.round(subtotal * (serviceCostRate / 100) * 100) / 100 : 0;

  const totalAmount = subtotal + cgstAmount + sgstAmount + serviceCost;

  const tableOptions = ['Main counter', ...Array.from({ length: 10 }, (_, i) => (i + 1).toString())];

  useEffect(() => {
    getPrinterConfig()
      .then((cfg) => {
        if (cfg) {
          setSellerTaxConfig({
            enableTax: Boolean(cfg.enableTax),
            cgstRate: cfg.cgstRate !== undefined ? Number(cfg.cgstRate) : 2.5,
            sgstRate: cfg.sgstRate !== undefined ? Number(cfg.sgstRate) : 2.5,
            enableServiceCost: Boolean(cfg.enableServiceCost),
            serviceCostRate: cfg.serviceCostRate !== undefined ? Number(cfg.serviceCostRate) : 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Fetch Seller QR Code & UPI Information whenever cart, seller or mount changes
  const fetchSellerUpiInfo = useCallback(async () => {
    try {
      setLoadingSellerQr(true);
      // Determine primary seller ID from route, params, cart, preferred store or seller profile
      let targetSellerId = route?.params?.sellerId || customerId || null;
      if (!targetSellerId && cart?.cart_items && cart.cart_items.length > 0) {
        const prod = cart.cart_items[0]?.product_variant_combinations?.products;
        targetSellerId = prod?.user_id || prod?.customer_id || null;
      }
      if (!targetSellerId) {
        try {
          const pref = await getPreferredStore();
          if (pref?.sellerId) {
            targetSellerId = pref.sellerId;
          }
        } catch (_) {}
      }
      if (!targetSellerId && profile?.role === 'seller' && currentUser?.id) {
        targetSellerId = currentUser.id;
      }
      if (!targetSellerId && activeEmployee?.seller_id) {
        targetSellerId = activeEmployee.seller_id;
      }

      let configuredUpiId = '';
      let configuredQr = null;

      if (targetSellerId) {
        // 1. Primary source of truth: Seller's profile in 'profiles' table
        let profData = null;
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, mobile, email, media_urls, upi_id')
            .eq('id', targetSellerId)
            .maybeSingle();

          if (data) {
            profData = data;
          } else if (error && error.message?.includes('upi_id')) {
            const { data: fallbackData } = await supabase
              .from('profiles')
              .select('id, full_name, mobile, email, media_urls')
              .eq('id', targetSellerId)
              .maybeSingle();
            profData = fallbackData;
          }
        } catch (e) {
          console.warn('Notice fetching seller profile in checkout:', e);
        }

        if (profData) {
          setSellerProfile(profData);
          const profUpi =
            normalizeUpiId(profData.upi_id) ||
            normalizeUpiId(extractMerchantUpi(profData.media_urls));
          if (profUpi && !isGenericQrName(profUpi)) {
            configuredUpiId = profUpi;
          }
        }

        // 2. Active QR code record from 'user_qr_codes' (Primary authority for payment details)
        const qrData = await getActiveQrCode(targetSellerId);
        if (qrData) {
          configuredQr = qrData;
          setSellerQr(qrData);

          try {
            setIsScanningProfileQr(true);
            const qrDetails = await resolveUploadedQrDetails(qrData);
            if (qrDetails?.upiId) {
              configuredUpiId = qrDetails.upiId;
            }
            if (qrDetails?.payeeName) {
              setSellerQrPayeeName(qrDetails.payeeName);
            }
            if (qrDetails?.rawText) {
              setSellerRawUpiText(qrDetails.rawText);
            }
          } catch (qrErr) {
            console.warn('Notice resolving uploaded QR details in checkout:', qrErr);
          } finally {
            setIsScanningProfileQr(false);
          }
        }
      } else if (currentUser?.id) {
        let userProf = null;
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, mobile, email, media_urls, upi_id')
            .eq('id', currentUser.id)
            .maybeSingle();
          if (data) {
            userProf = data;
          } else if (error && error.message?.includes('upi_id')) {
            const { data: fallbackData } = await supabase
              .from('profiles')
              .select('id, full_name, mobile, email, media_urls')
              .eq('id', currentUser.id)
              .maybeSingle();
            userProf = fallbackData;
          }
        } catch (_) {}

        if (userProf) {
          setSellerProfile(userProf);
          const profUpi =
            normalizeUpiId(userProf.upi_id) ||
            normalizeUpiId(extractMerchantUpi(userProf.media_urls));
          if (profUpi && !isGenericQrName(profUpi)) {
            configuredUpiId = profUpi;
          }
        }

        if (!configuredUpiId && currentUser.user_metadata?.upi_id) {
          const metaUpi = normalizeUpiId(currentUser.user_metadata.upi_id);
          if (metaUpi && !isGenericQrName(metaUpi)) {
            configuredUpiId = metaUpi;
          }
        }

        const qrData = await getActiveQrCode(currentUser.id);
        if (qrData) {
          configuredQr = qrData;
          setSellerQr(qrData);
          try {
            const qrDetails = await resolveUploadedQrDetails(qrData);
            if (qrDetails?.upiId) {
              configuredUpiId = qrDetails.upiId;
            }
            if (qrDetails?.payeeName) {
              setSellerQrPayeeName(qrDetails.payeeName);
            }
            if (qrDetails?.rawText) {
              setSellerRawUpiText(qrDetails.rawText);
            }
          } catch (_) {}
        }
      }

      setSellerUpiId(configuredUpiId);

      const hasUpi = Boolean(
        configuredUpiId ||
        (configuredQr && (configuredQr.qr_image_url || configuredQr.qr_code_url || configuredQr.name))
      );

      // Prioritize dynamic bill QR if UPI ID is configured, otherwise show uploaded standee
      if (configuredUpiId) {
        setQrTab('dynamic');
      } else if (configuredQr && (configuredQr.qr_image_url || configuredQr.qr_code_url)) {
        setQrTab('profile');
      } else {
        setQrTab('dynamic');
      }

      // If seller has not configured UPI, lock payment method to 'cod'
      if (!hasUpi) {
        setPaymentMethod('cod');
      } else {
        setPaymentMethod((prev) => prev || 'upi');
      }
    } catch (err) {
      console.warn('Error fetching seller UPI info:', err);
    } finally {
      setLoadingSellerQr(false);
    }
  }, [cart, customerId, profile, currentUser, activeEmployee]);

  useEffect(() => {
    fetchSellerUpiInfo();
  }, [fetchSellerUpiInfo]);

  // Derive active UPI parameters strictly from seller profile
  const activeUpiId =
    (sellerUpiId && !isGenericQrName(sellerUpiId) ? normalizeUpiId(sellerUpiId) : '') ||
    (sellerProfile?.upi_id && !isGenericQrName(sellerProfile.upi_id) ? normalizeUpiId(sellerProfile.upi_id) : '') ||
    normalizeUpiId(extractMerchantUpi(sellerProfile?.media_urls)) ||
    (profile?.upi_id && !isGenericQrName(profile.upi_id) ? normalizeUpiId(profile.upi_id) : '') ||
    normalizeUpiId(extractMerchantUpi(profile?.media_urls)) ||
    (currentUser?.user_metadata?.upi_id && !isGenericQrName(currentUser.user_metadata.upi_id) ? normalizeUpiId(currentUser.user_metadata.upi_id) : '') ||
    '';

  const isUpiConfigured = Boolean(
    activeUpiId ||
    (sellerQr && (sellerQr.qr_image_url || sellerQr.qr_code_url || sellerQr.name))
  );

  // Store / Shop display name for UI labels (strictly for checkout display, e.g. "Pay to Store: ABC")
  const storeDisplayName =
    route?.params?.sellerName ||
    sellerProfile?.store_name ||
    sellerProfile?.full_name ||
    sellerProfile?.name ||
    profile?.store_name ||
    profile?.full_name ||
    'Store';

  // For dynamic bill QR loading, strictly use payee name from uploaded QR code details ONLY (never profile name)
  const dynamicPayeeName = sellerQrPayeeName || '';

  // Alphanumeric with spaces only - strictly NO '#' or special characters so UPI apps (GPay, PhonePe, Paytm) never fail
  const orderNote = formatUpiTransactionNote({
    cartId: cart?.id,
    uniqueCode: uniquePaymentCode,
    fallbackRef: (profile?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase(),
  });

  // Official UPI Payment URI format (supported across all Indian UPI apps)
  const dynamicUpiUri = activeUpiId
    ? buildUpiPaymentUri({
        upiId: activeUpiId,
        payeeName: dynamicPayeeName,
        amount: totalAmount,
        note: orderNote,
        rawText: sellerRawUpiText,
        tr: uniquePaymentCode,
      })
    : '';

  // Static UPI URI without amount/tr parameters (works reliably across all UPI apps on Web and Mobile)
  const staticUpiUri = activeUpiId
    ? buildUpiPaymentUri({
        upiId: activeUpiId,
        payeeName: dynamicPayeeName,
        rawText: sellerRawUpiText,
      })
    : '';

  // Local instant high-resolution QR code generator (no external API delay)
  useEffect(() => {
    let isMounted = true;
    if (dynamicUpiUri) {
      generateQrDataUrl(dynamicUpiUri, { width: 350, margin: 2 }).then((dataUrl) => {
        if (isMounted && dataUrl) {
          setDynamicQrDataUrl(dataUrl);
          setQrImageError(false);
        }
      }).catch(() => {});
    } else {
      setDynamicQrDataUrl(null);
    }
    return () => {
      isMounted = false;
    };
  }, [dynamicUpiUri]);

  // Fallback web QR Code image URL
  const fallbackDynamicQrUrl = dynamicUpiUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(dynamicUpiUri)}`
    : null;

  // Available UPI App Intent links (Google Pay, PhonePe, Paytm, BHIM, All Apps)
  const upiAppList = useMemo(() => {
    return buildUpiAppLinks({
      upiId: activeUpiId || sellerUpiId,
      payeeName: dynamicPayeeName,
      amount: totalAmount,
      note: orderNote,
      rawText: sellerRawUpiText,
      tr: uniquePaymentCode,
    });
  }, [activeUpiId, sellerUpiId, dynamicPayeeName, totalAmount, orderNote, sellerRawUpiText, uniquePaymentCode]);

  const getAppWebHref = (app) => {
    if (!app || Platform.OS !== 'web' || typeof navigator === 'undefined') return undefined;
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) {
      return app.androidIntent;
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return app.iosUri || app.standardUri;
    }
    return app.standardUri;
  };

  // Profile-uploaded QR image URL (from user_qr_codes table)
  const profileQrImageUrl = sellerQr?.qr_image_url || sellerQr?.qr_code_url || null;

  // Unified QR code image URL to display: If qrTab is 'profile' and profileQrImageUrl exists, use it. Otherwise use dynamic QR with exact order bill amount.
  const displayedQrUri =
    qrTab === 'profile' && profileQrImageUrl
      ? profileQrImageUrl
      : (dynamicQrDataUrl || fallbackDynamicQrUrl || profileQrImageUrl);

  const [isDownloadingQr, setIsDownloadingQr] = useState(false);

  const handleDownloadQrCode = async () => {
    let targetUri = displayedQrUri;
    if (!targetUri && dynamicUpiUri) {
      try {
        targetUri = await generateQrDataUrl(dynamicUpiUri, { width: 400, margin: 2 });
      } catch (_) {
        targetUri = fallbackDynamicQrUrl;
      }
    }
    if (!targetUri) {
      targetUri = profileQrImageUrl;
    }
    if (!targetUri) {
      showAlert('QR Code Unavailable', 'Payment QR code is still generating. Please wait a moment.');
      return;
    }
    setIsDownloadingQr(true);
    try {
      const sellerTag = resolvedSellerName ? `-${resolvedSellerName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
      const fileName = `Order-Payment-QR-Rs${Math.round(totalAmount)}${sellerTag}`;
      await downloadQrCodeImage(targetUri, fileName);
    } catch (err) {
      console.warn('QR download error in checkout:', err);
      showAlert('Download Error', 'Could not download QR code: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDownloadingQr(false);
    }
  };

  // Prompt Order Type when Pay with UPI is clicked
  const handlePayWithUpiPress = (action = 'select_upi') => {
    if (!isUpiConfigured) {
      showAlert(
        'UPI Not Configured',
        'Store seller has not configured UPI details. Please choose Cash on Delivery / Counter.'
      );
      setPaymentMethod('cod');
      return;
    }
    setOrderTypeModalAction(action);
    setShowOrderTypeModal(true);
  };

  const handleSelectDineIn = () => {
    setOrderType('Dine-in');
    setOrderTypeConfirmed(true);
    setPaymentMethod('upi');
    setShowOrderTypeModal(false);
    if (orderTypeModalAction === 'place_order') {
      handlePlaceOrder({ forcedOrderType: 'Dine-in', forcedPaymentMethod: 'upi' });
    }
  };

  const handleSelectParcel = () => {
    setOrderType('Parcel');
    setOrderTypeConfirmed(true);
    setPaymentMethod('upi');
    setShowOrderTypeModal(false);
    if (!currentUser) {
      showAlert(
        'Sign In Required for Parcel Order',
        'Parcel orders require delivery & contact details. Please sign in or create an account to proceed.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign In / Sign Up',
            onPress: () =>
              navigation.navigate('BuyerLogin', {
                redirectTo: 'Checkout',
                redirectParams: { cart, customerId },
              }),
          },
        ]
      );
      return;
    }

    if (!mobile.trim() || !address.trim()) {
      showAlert(
        'Delivery Address Required',
        'Please enter your 10-digit mobile number and delivery address below for your parcel order.'
      );
    } else if (orderTypeModalAction === 'place_order') {
      handlePlaceOrder({ forcedOrderType: 'Parcel', forcedPaymentMethod: 'upi' });
    }
  };


  const handleCopyUpiId = async () => {
    try {
      if (Clipboard && Clipboard.setStringAsync) {
        await Clipboard.setStringAsync(activeUpiId);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(activeUpiId);
      }
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    } catch (_) {}
  };

  const handleOpenDirectUpiPay = async (appId = 'any') => {
    let resolvedUpi = activeUpiId || sellerUpiId;

    // If still missing, try decoding profile QR image immediately
    if (!resolvedUpi && profileQrImageUrl) {
      try {
        const scan = await decodeQrFromImage(profileQrImageUrl);
        if (scan?.success && scan.upiId) {
          resolvedUpi = scan.upiId;
          setSellerUpiId(scan.upiId);
        }
      } catch (_) {}
    }

    // Check if on Desktop Web browser where UPI handler apps don't exist
    const isDesktopWeb =
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isDesktopWeb) {
      if (resolvedUpi) {
        handleCopyUpiId();
      }
      showAlert(
        'Scan QR Code with Phone',
        `UPI payment apps (Google Pay, PhonePe, Paytm) run on mobile devices.\n\n` +
        `1. Scan the QR code displayed on screen using your mobile phone's camera or UPI app.\n` +
        (resolvedUpi ? `2. Or pay ₹${totalAmount.toFixed(2)} directly to UPI ID: ${resolvedUpi} (copied to clipboard!).` : '')
      );
      return;
    }

    if (!resolvedUpi && !profileQrImageUrl) {
      showAlert(
        'Scan Store QR Code',
        `Please scan the Seller's QR code displayed on screen with Google Pay, PhonePe, Paytm, or any UPI app to pay ₹${totalAmount.toFixed(2)}.`
      );
      return;
    }

    const launchResult = await openUpiAppIntent({
      appId,
      upiId: resolvedUpi,
      payeeName: dynamicPayeeName,
      amount: totalAmount,
      note: orderNote,
      rawText: sellerRawUpiText,
      tr: uniquePaymentCode,
      LinkingInstance: Linking,
    });

    if (!launchResult?.success) {
      if (resolvedUpi) {
        handleCopyUpiId();
      }
      showAlert(
        'Open UPI App',
        `Could not open ${launchResult?.app?.name || 'UPI app'} directly. Please scan the QR code on screen using Google Pay, PhonePe, or Paytm, or pay to:\n\n${resolvedUpi || 'Merchant'}\n(Copied to clipboard!)`
      );
    }
  };

  // Handle Address selection
  const handleSelectAddress = (addr) => {
    setSelectedAddressId(addr.id);
    setName(addr.recipient_name || '');
    setMobile(addr.mobile || '');
    setAddress(addr.address_line_1 || '');
    setCity(addr.city || '');
    setPostalCode(addr.zip_code || '');
    if (addr.latitude && addr.longitude) {
      setSelectedCoords({ latitude: Number(addr.latitude), longitude: Number(addr.longitude) });
    } else {
      setSelectedCoords(null);
    }
  };

  const handleOpenAddAddressModal = () => {
    setModalTag('Home');
    setModalRecipientName(name || currentUser?.user_metadata?.full_name || '');
    setModalMobile(mobile || profile?.mobile || '');
    setModalAddressLine1('');
    setModalCity(city || profile?.city || '');
    setModalState(profile?.state || '');
    setModalZipCode(postalCode || profile?.zip_code || '');
    if (selectedCoords) {
      setModalCoords(selectedCoords);
      setMapInitialRegion(selectedCoords);
    } else if (profile?.latitude && profile?.longitude) {
      const c = { latitude: Number(profile.latitude), longitude: Number(profile.longitude) };
      setModalCoords(c);
      setMapInitialRegion(c);
    } else {
      const defCoords = { latitude: 28.6139, longitude: 77.2090 };
      setModalCoords(defCoords);
      setMapInitialRegion(defCoords);
    }
    setMapSearchQuery('');
    setMapSearchSuggestions([]);
    setShowAddressModal(true);
  };

  const reverseGeocodeAddress = async (lat, lon) => {
    if (lat == null || lon == null) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'NeedsTrackingApp/1.0',
            'Accept-Language': 'en',
          },
        }
      );
      const data = await res.json();
      if (data && data.address) {
        const addr = data.address;
        const street = [addr.road, addr.suburb, addr.neighbourhood].filter(Boolean).join(', ') || data.display_name?.split(',')[0] || '';
        const cityName = addr.city || addr.town || addr.village || addr.county || '';
        const stateName = addr.state || '';
        const zip = addr.postcode || '';

        if (street) setModalAddressLine1(street);
        if (cityName) setModalCity(cityName);
        if (stateName) setModalState(stateName);
        if (zip) setModalZipCode(zip);
      }
    } catch (err) {
      console.warn('Reverse geocode error in checkout:', err);
    }
  };

  const handleUseCurrentLocation = async () => {
    setLocatingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission Denied', 'Permission to access current GPS location was denied.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (loc && loc.coords) {
        const newCoords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setModalCoords(newCoords);
        setMapInitialRegion(newCoords);
        if (addressMapRef.current?.centerOnLocation) {
          addressMapRef.current.centerOnLocation(newCoords, 16);
        }
        await reverseGeocodeAddress(newCoords.latitude, newCoords.longitude);
      }
    } catch (err) {
      console.warn('GPS location error:', err);
      showAlert('GPS Notice', 'Could not fetch GPS automatically. Please tap directly on the map.');
    } finally {
      setLocatingGps(false);
    }
  };

  const handleMapSearchChange = async (text) => {
    setMapSearchQuery(text);
    if (!text || text.trim().length < 3) {
      setMapSearchSuggestions([]);
      return;
    }
    setMapSearchLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text.trim())}&limit=5&addressdetails=1`,
        {
          headers: { 'User-Agent': 'NeedsTrackingApp/1.0', 'Accept-Language': 'en' },
        }
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        setMapSearchSuggestions(
          data.map((item) => ({
            id: String(item.place_id || Math.random()),
            title: item.display_name?.split(',')[0] || item.name,
            subtitle: item.display_name,
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
            address: item.address,
          }))
        );
      }
    } catch (e) {
      console.warn('Area search error:', e);
    } finally {
      setMapSearchLoading(false);
    }
  };

  const handleSelectAreaSuggestion = (item) => {
    const coords = { latitude: item.latitude, longitude: item.longitude };
    setModalCoords(coords);
    setMapInitialRegion(coords);
    setMapSearchQuery(item.title);
    setMapSearchSuggestions([]);

    if (item.address) {
      const addr = item.address;
      const street = [addr.road, addr.suburb, addr.neighbourhood].filter(Boolean).join(', ') || item.title;
      if (street) setModalAddressLine1(street);
      if (addr.city || addr.town || addr.village) setModalCity(addr.city || addr.town || addr.village);
      if (addr.state) setModalState(addr.state);
      if (addr.postcode) setModalZipCode(addr.postcode);
    }

    if (addressMapRef.current?.centerOnLocation) {
      addressMapRef.current.centerOnLocation(coords, 16);
    }
  };

  const handleSaveModalAddress = async () => {
    if (!modalRecipientName.trim()) {
      showAlert('Required', 'Please enter recipient name.');
      return;
    }
    const cleanMob = modalMobile.trim().replace(/[\s\-()]/g, '');
    if (!cleanMob || !/^(?:\+91|91)?[6-9]\d{9}$/.test(cleanMob)) {
      showAlert('Invalid Mobile', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!modalAddressLine1.trim()) {
      showAlert('Required', 'Please enter street or address details.');
      return;
    }
    if (!modalCity.trim()) {
      showAlert('Required', 'Please enter city.');
      return;
    }

    setSavingAddress(true);
    try {
      const user = currentUser || (await supabase.auth.getUser()).data.user;
      if (!user) {
        showAlert('Sign In Required', 'Please sign in to save addresses.');
        return;
      }

      const addrData = {
        tag: modalTag,
        recipient_name: modalRecipientName.trim(),
        mobile: cleanMob.slice(-10),
        address_line_1: modalAddressLine1.trim(),
        city: modalCity.trim(),
        state: modalState.trim(),
        zip_code: modalZipCode.trim(),
        latitude: modalCoords?.latitude || null,
        longitude: modalCoords?.longitude || null,
        is_default: savedAddresses.length === 0,
      };

      const saved = await addUserAddress(user.id, addrData);
      const updatedList = [saved, ...savedAddresses];
      setSavedAddresses(updatedList);
      setSelectedAddressId(saved.id);

      setName(saved.recipient_name);
      setMobile(saved.mobile);
      setAddress(saved.address_line_1);
      setCity(saved.city);
      setPostalCode(saved.zip_code);
      setSelectedCoords(modalCoords);

      if (!profile?.mobile) {
        await supabase
          .from('profiles')
          .update({ mobile: cleanMob.slice(-10), updated_at: new Date().toISOString() })
          .eq('id', user.id);
        setProfile((prev) => ({ ...(prev || {}), mobile: cleanMob.slice(-10) }));
      }

      setShowAddressModal(false);
      showAlert('Address Saved', 'New delivery address added and selected!');
    } catch (err) {
      console.warn('Error saving address:', err);
      showAlert('Error', err.message || 'Failed to save address.');
    } finally {
      setSavingAddress(false);
    }
  };

  // Email OTP Handlers
  const handleSendEmailOtp = async (targetMobile) => {
    const mob = (targetMobile || mobile).trim().replace(/[\s\-()]/g, '');
    if (!mob || !/^(?:\+91|91)?[6-9]\d{9}$/.test(mob)) {
      showAlert('Invalid Mobile', 'Please enter a valid 10-digit mobile number first.');
      return;
    }

    const emailToSend = currentUser?.email || (await supabase.auth.getUser()).data?.user?.email;
    if (!emailToSend) {
      showAlert('Email Missing', 'No registered email found for this account. Please sign in with an email account.');
      return;
    }

    setSendingEmailOtp(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailToSend,
      });

      if (error) throw error;

      showAlert(
        'Code Sent to Email',
        `A 6-digit verification code has been sent to ${emailToSend}. Enter it below to verify your contact number.`
      );
      setShowOtpModal(true);
    } catch (err) {
      console.warn('Error sending email OTP:', err);
      showAlert('Failed to Send Code', err.message || 'Could not send verification code.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    if (!otpCode.trim()) {
      showAlert('Enter Code', 'Please enter the 6-digit code received on your email.');
      return;
    }

    setVerifyingEmailOtp(true);
    try {
      const user = currentUser || (await supabase.auth.getUser()).data.user;
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: user.email,
        token: otpCode.trim(),
        type: 'email',
      });

      if (verifyError) throw verifyError;

      const cleanMobile = mobile.trim().replace(/[\s\-()]/g, '').slice(-10);

      // 1. Permanently remember on this device so user is never asked again
      try {
        await AsyncStorage.setItem(`@checkout_verified_${user.id}`, 'true');
        if (cleanMobile) {
          await AsyncStorage.setItem(`@checkout_verified_mobile_${user.id}`, cleanMobile);
        }
      } catch (storageErr) {
        console.warn('AsyncStorage verification persist notice:', storageErr);
      }

      // 2. Persist to auth user_metadata
      await supabase.auth.updateUser({
        data: {
          mobile: cleanMobile,
          mobile_verified: true,
          email_verified: true,
        },
      }).catch(() => {});

      // 3. Persist to profiles table
      const { error: profError } = await supabase
        .from('profiles')
        .update({
          mobile: cleanMobile,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (profError) {
        console.warn('Profile update notice:', profError);
      }

      setIsMobileVerified(true);
      setShowOtpModal(false);
      setOtpCode('');
      setProfile((prev) => ({ ...(prev || {}), mobile: cleanMobile }));

      showAlert('✅ Verified', 'Your contact details have been verified! You will not be asked again.');
    } catch (err) {
      showAlert('Verification Failed', err.message || 'Invalid or expired code. Please try again.');
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  const handlePlaceOrder = async (overrideOpts = {}) => {
    const activeMethod = overrideOpts?.forcedPaymentMethod || paymentMethod;
    const activeType = overrideOpts?.forcedOrderType || orderType;
    const isDineIn = activeType === 'Dine-in';

    if (!activeMethod) {
      showAlert('Payment Method', 'Please select a payment method.');
      return;
    }

    if (activeMethod === 'upi' && !isUpiConfigured) {
      showAlert(
        'UPI Not Configured',
        'Store seller has not configured UPI payment details. Please proceed with Cash payment.'
      );
      setPaymentMethod('cod');
      return;
    }

    const { data: { user } = {} } = await supabase.auth.getUser();
    const orderUserId = user?.id || null;

    // Validation rules: Mandatory login & address for Parcel; optional/skipped for Dine-in
    if (!isDineIn) {
      if (!orderUserId) {
        showAlert(
          'Sign In Required for Parcel',
          'Parcel orders require account sign-in to save delivery details. Please sign in or create an account to place your order.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Sign In / Sign Up',
              onPress: () =>
                navigation.navigate('BuyerLogin', {
                  redirectTo: 'Checkout',
                  redirectParams: { cart, customerId },
                }),
            },
          ]
        );
        return;
      }

      if (!name.trim()) {
        showAlert('Shipping Details', 'Please enter your full name for parcel delivery.');
        return;
      }

      const cleanMobile = (mobile || '').trim().replace(/[\s\-()]/g, '');
      if (!cleanMobile) {
        showAlert('Mobile Required', 'Please provide a 10-digit mobile number for order delivery.');
        return;
      }

      if (!/^(?:\+91|91)?[6-9]\d{9}$/.test(cleanMobile)) {
        showAlert('Invalid Mobile', 'Please enter a valid 10-digit mobile number.');
        return;
      }

      const isShopOrder = profile && profile.role === 'seller';

      // Check if buyer has already verified via profile, session state, user metadata, saved addresses, or persistent AsyncStorage
      let alreadyVerified = isMobileVerified || Boolean(profile?.mobile);
      if (!alreadyVerified && orderUserId) {
        try {
          const localCheck = await AsyncStorage.getItem(`@checkout_verified_${orderUserId}`);
          if (
            localCheck === 'true' ||
            Boolean(user?.email_confirmed_at) ||
            Boolean(user?.confirmed_at) ||
            user?.user_metadata?.email_verified === true ||
            user?.user_metadata?.mobile_verified === true ||
            (savedAddresses && savedAddresses.length > 0)
          ) {
            alreadyVerified = true;
            setIsMobileVerified(true);
          }
        } catch (_) {}
      }

      if (!isShopOrder && !alreadyVerified) {
        showAlert(
          'Verify Contact Number',
          `For your first checkout, please verify your mobile number. We will send a 6-digit verification code to your registered email (${user?.email || 'your account'}).`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Send Code to Email',
              onPress: () => handleSendEmailOtp(cleanMobile),
            },
          ]
        );
        return;
      }

      if (!address.trim()) {
        showAlert('Shipping Details', 'Please enter your delivery address.');
        return;
      }
    }

    setLoading(true);

    const cleanMobile = (mobile || '').trim().replace(/[\s\-()]/g, '');

    // Persist mobile to profile if missing (when logged in)
    if (orderUserId && cleanMobile) {
      if (!profile?.mobile || profile.mobile !== cleanMobile.slice(-10)) {
        try {
          await supabase
            .from('profiles')
            .update({
              mobile: cleanMobile.slice(-10),
              updated_at: new Date().toISOString(),
            })
            .eq('id', orderUserId);
          setProfile((prev) => ({ ...(prev || {}), mobile: cleanMobile.slice(-10) }));
        } catch (profErr) {
          console.warn('Profile mobile sync notice:', profErr);
        }
      }

      // Persist verified status to AsyncStorage and user_metadata permanently
      try {
        await AsyncStorage.setItem(`@checkout_verified_${orderUserId}`, 'true');
        await AsyncStorage.setItem(`@checkout_verified_mobile_${orderUserId}`, cleanMobile.slice(-10));
        await supabase.auth.updateUser({
          data: { mobile: cleanMobile.slice(-10), mobile_verified: true, email_verified: true },
        }).catch(() => {});
      } catch (_) {}
    }

    const orderStatus = activeMethod === 'cod' ? 'processing' : 'pending_payment';

    // Group cart items by seller (product vendor user_id)
    const itemsBySeller = {};
    for (const item of cartItems) {
      const prod = item.product_variant_combinations?.products;
      const sellerId = prod?.user_id || prod?.customer_id || 'store';
      if (!itemsBySeller[sellerId]) {
        itemsBySeller[sellerId] = {
          sellerId: sellerId === 'store' ? null : sellerId,
          items: [],
          subtotal: 0,
        };
      }
      const itemPrice = Number(item.product_variant_combinations?.price || 0);
      const itemQty = Number(item.quantity || 1);
      itemsBySeller[sellerId].items.push(item);
      itemsBySeller[sellerId].subtotal += itemPrice * itemQty;
    }

    const sellerKeys = Object.keys(itemsBySeller);
    if (sellerKeys.length === 0) {
      setLoading(false);
      showAlert('Empty Cart', 'No items in cart to checkout.');
      return;
    }

    const createdOrders = [];

    try {
      for (const sellerKey of sellerKeys) {
        const sellerGroup = itemsBySeller[sellerKey];
        const rawSellerId = sellerGroup.sellerId && sellerGroup.sellerId !== 'store'
          ? sellerGroup.sellerId
          : (resolvedSellerId || (profile?.role === 'seller' ? profile?.id : null));
        const isValidUUID = (val) =>
          typeof val === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
        const targetSellerId = isValidUUID(rawSellerId) ? rawSellerId.trim() : null;

        const groupSubtotal = sellerGroup.subtotal;
        const groupCgst = isTaxEnabled && groupSubtotal > 0 ? Math.round(groupSubtotal * (cgstRate / 100) * 100) / 100 : 0;
        const groupSgst = isTaxEnabled && groupSubtotal > 0 ? Math.round(groupSubtotal * (sgstRate / 100) * 100) / 100 : 0;
        const groupService = isServiceCostEnabled && groupSubtotal > 0 && serviceCostRate > 0 ? Math.round(groupSubtotal * (serviceCostRate / 100) * 100) / 100 : 0;
        const groupTotal = groupSubtotal + groupCgst + groupSgst + groupService;

        const billingBreakdown = {
          subtotal: groupSubtotal,
          cgst_amount: groupCgst,
          sgst_amount: groupSgst,
          service_cost: groupService,
          cgst_rate: cgstRate,
          sgst_rate: sgstRate,
          service_cost_rate: serviceCostRate,
          total: groupTotal,
        };

        const shippingWithBilling = isDineIn
          ? {
              type: 'Dine-in',
              table_no: tableNo || 'Main counter',
              name: name.trim() || 'Guest Diner',
              mobile: cleanMobile || (profile?.mobile || ''),
              address: `Dine-in (${tableNo || 'Main counter'})`,
              city: city || '',
              postalCode: postalCode || '',
              billing: billingBreakdown,
              payment_reference: uniquePaymentCode,
              payment_note: orderNote,
              payment_status: 'pending',
            }
          : {
              ...(typeof shippingAddress === 'object' ? shippingAddress : { address: shippingAddress }),
              billing: billingBreakdown,
              payment_reference: uniquePaymentCode,
              payment_note: orderNote,
              payment_status: 'pending',
            };

        const orderPayload = {
          user_id: orderUserId,
          seller_id: targetSellerId,
          shipping_address: shippingWithBilling,
          total_amount: groupTotal,
          subtotal: groupSubtotal,
          cgst_amount: groupCgst,
          sgst_amount: groupSgst,
          service_cost: groupService,
          cgst_rate: cgstRate,
          sgst_rate: sgstRate,
          service_cost_rate: serviceCostRate,
          status: orderStatus,
          payment_method: activeMethod,
          payment_reference: uniquePaymentCode,
          payment_status: 'pending',
          order_type: 'shop-order', // Dine-in and parcel shop orders go directly to seller
          table_no: isDineIn ? (tableNo || 'Main counter') : 'Parcel',
        };

        let order = null;
        let orderError = null;

        // If unauthenticated guest, try SECURITY DEFINER RPC to bypass client-side RLS limits
        if (!orderUserId) {
          try {
            const rawItemsPayload = sellerGroup.items.map((item) => ({
              product_variant_combination_id: item.product_variant_combinations.id,
              quantity: item.quantity,
              price: item.product_variant_combinations.price,
            }));
            const { data: rpcData, error: rpcErr } = await supabase.rpc('create_guest_dine_in_order', {
              p_order: orderPayload,
              p_items: rawItemsPayload,
            });
            if (!rpcErr && rpcData) {
              order = rpcData;
            } else if (rpcErr) {
              console.warn('RPC create_guest_dine_in_order notice, falling back to direct table insert:', rpcErr.message);
            }
          } catch (rpcCatchErr) {
            console.warn('RPC create_guest_dine_in_order exception, falling back to direct insert:', rpcCatchErr);
          }
        }

        // Direct table insert if order not yet created by RPC
        if (!order) {
          let res = await supabase
            .from('orders')
            .insert(orderPayload)
            .select()
            .single();
          order = res.data;
          orderError = res.error;

          if (orderError && (orderError.code === 'PGRST204' || (orderError.message && orderError.message.includes('column')))) {
            console.warn('Retrying sub-order creation without extra columns:', orderError.message);
            const fallbackPayload = {
              user_id: orderUserId,
              seller_id: targetSellerId,
              shipping_address: shippingWithBilling,
              total_amount: groupTotal,
              status: orderStatus,
              payment_method: activeMethod,
              payment_reference: uniquePaymentCode,
              order_type: 'shop-order',
              table_no: isDineIn ? (tableNo || 'Main counter') : 'Parcel',
            };
            if (orderError.message && orderError.message.includes('payment_reference')) {
              delete fallbackPayload.payment_reference;
            }
            let retry = await supabase.from('orders').insert(fallbackPayload).select().single();
            if (retry.error && (retry.error.code === 'PGRST204' || (retry.error.message && retry.error.message.includes('seller_id')))) {
              delete fallbackPayload.seller_id;
              retry = await supabase.from('orders').insert(fallbackPayload).select().single();
            }
            if (retry.error && (retry.error.code === 'PGRST204' || (retry.error.message && (retry.error.message.includes('payment_reference') || retry.error.message.includes('column'))))) {
              delete fallbackPayload.payment_reference;
              retry = await supabase.from('orders').insert(fallbackPayload).select().single();
            }
            order = retry.data;
            orderError = retry.error;
          }

          if (orderError) {
            console.error('Error creating sub-order:', orderError.message);
            throw orderError;
          }

          const orderItemsPayload = sellerGroup.items.map((item) => ({
            order_id: order.id,
            product_variant_combination_id: item.product_variant_combinations.id,
            quantity: item.quantity,
            price: item.product_variant_combinations.price,
          }));

          const { error: orderItemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload);

          if (orderItemsError) {
            console.error('Error creating order items:', orderItemsError.message);
            throw orderItemsError;
          }
        }

        if (order) {
          order.billing = billingBreakdown;
          order.subtotal = groupSubtotal;
          order.cgst_amount = groupCgst;
          order.sgst_amount = groupSgst;
          order.service_cost = groupService;
          order.cgst_rate = cgstRate;
          order.sgst_rate = sgstRate;
          order.service_cost_rate = serviceCostRate;
          order.order_items = sellerGroup.items;
        }

        createdOrders.push(order);
        if (!orderUserId && order?.id) {
          saveGuestOrderId(order.id);
        }

        // Dine-in orders never assign delivery manager - orders go directly to seller only!
        if (!isDineIn && activeType === 'delivery') {
          try {
            await supabase.functions.invoke('assign-delivery-manager', {
              body: { order: { id: order.id } },
            });
          } catch (assignErr) {
            console.warn('Assign delivery manager notice:', assignErr);
          }
        }

        // Send local confirmation notification
        try {
          const notificationTitle = isDineIn
            ? `🍽️ Order Placed for Table #${tableNo || 'Main counter'}`
            : '📦 Parcel Order Placed!';
          const notificationBody = `Order #${order.order_number || order.id.substring(0, 8)} for ₹${groupTotal.toFixed(2)} is confirmed with store.`;

          await schedulePushNotification(
            notificationTitle,
            notificationBody,
            { orderId: order.id }
          );
        } catch (notifErr) {
          console.warn('Push notification notice:', notifErr);
        }
      }

      // Clear the user's cart in database if cart.id is present
      if (cart?.id) {
        await supabase.from('cart_items').delete().eq('cart_id', cart.id);
      }
      // Also clear local guest cart
      await clearGuestCart();
      setCart({ cart_items: [] });
      if (contextSetCart) {
        contextSetCart({ cart_items: [] });
      }

      setLoading(false);

      if (createdOrders.length > 1) {
        showAlert(
          '🎉 Multi-Store Orders Placed!',
          `Your cart contained products from ${createdOrders.length} different sellers. ${createdOrders.length} separate orders have been created so each store can dispatch independently.`,
          [
            {
              text: 'View My Orders',
              onPress: () => navigation.navigate('OrderList'),
            },
          ]
        );
      } else if (createdOrders.length === 1) {
        setUniquePaymentCode(Math.floor(100000 + Math.random() * 900000).toString());
        navigation.navigate('OrderConfirmation', {
          order: createdOrders[0],
          paymentReference: uniquePaymentCode,
          sellerId: resolvedSellerId,
          sellerName: resolvedSellerName,
          customerId: resolvedCustomerId,
        });
      } else {
        setUniquePaymentCode(Math.floor(100000 + Math.random() * 900000).toString());
        navigation.navigate('OrderList');
      }
    } catch (err) {
      setLoading(false);
      showAlert('Checkout Error', err.message || 'Failed to place order. Please try again.');
    }
  };

  const resolvedSellerId =
    route?.params?.sellerId ||
    cartItems?.[0]?.product_variant_combinations?.products?.user_id ||
    cartItems?.[0]?.product_variant_combinations?.products?.customer_id ||
    activeEmployee?.seller_id ||
    (isSeller ? (profile?.id || currentUser?.id) : null) ||
    sellerProfile?.id ||
    null;
  const resolvedSellerName = route?.params?.sellerName || sellerProfile?.full_name || null;
  const resolvedCustomerId = customerId || currentUser?.id || null;

  // Prompt before completing Fast POS Order (Cash or UPI)
  const promptFastOrderConfirmation = (method) => {
    setPosPaymentMethod(method);
    setPosCustomerName(name || '');
    setPosCustomerMobile(mobile || '');
    setPosTableNo(tableNo || 'Main counter');
    setPosPrintReceipt(false);
    setShowPosConfirmModal(true);
  };

  // Fast Navigation back to Catalog / POS Billing for next customer
  const navigateToCatalog = (orderInfo) => {
    setShowPosSuccessModal(false);
    setPosSuccessData(null);
    const catalogParams = {
      sellerId: resolvedSellerId,
      sellerName: resolvedSellerName,
      customerId: resolvedCustomerId,
      lastCompletedOrderId: orderInfo?.id,
      freshSale: Date.now(),
    };

    const state = navigation.getState ? navigation.getState() : null;
    const routeNames = state?.routeNames || [];
    if (routeNames.includes('Catalog')) {
      navigation.navigate('Catalog', catalogParams);
    } else {
      try {
        navigation.navigate('CatalogTab', {
          screen: 'Catalog',
          params: catalogParams,
        });
      } catch (_) {
        try {
          navigation.navigate('Catalog', catalogParams);
        } catch (__) {
          navigation.goBack();
        }
      }
    }
  };

  // Auto-redirect timer for Fast POS Success (3s countdown)
  useEffect(() => {
    let timer = null;
    let countdownInterval = null;
    if (showPosSuccessModal && posSuccessData) {
      setSuccessCountdown(3);
      countdownInterval = setInterval(() => {
        setSuccessCountdown((prev) => (prev > 1 ? prev - 1 : 1));
      }, 1000);

      timer = setTimeout(() => {
        navigateToCatalog(posSuccessData?.order);
      }, 3000);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [showPosSuccessModal, posSuccessData]);

  // Fast POS Counter Billing Order Placement (Paid by Cash / Paid by UPI)
  const handleFastPosOrder = async (method, options = {}) => {
    const isCash = method === 'cash';
    const chosenMethod = isCash ? 'cod' : 'upi';
    const chosenStatus = 'completed';
    const chosenPayStatus = 'paid';
    const printOnFinish = Boolean(options.printReceipt);
    const customerDisplayName = (options.customerName || name || '').trim() || 'Counter Customer';
    const customerMobile = (options.customerMobile || mobile || '').trim().replace(/[\s\-()]/g, '');
    const activeTable = options.tableNo || tableNo || 'Main counter';

    if (cartItems.length === 0) {
      showAlert('Empty Cart', 'Cart has no items to bill.');
      return;
    }

    if (!isCash && !isUpiConfigured) {
      showAlert(
        'UPI Not Configured',
        'Store UPI details are not configured. Please collect payment in Cash.'
      );
      return;
    }

    setIsProcessingPos(true);
    setLoading(true);

    try {
      const { data: { user } = {} } = await supabase.auth.getUser();
      const orderUserId = user?.id || null;

      // Group cart items by seller
      const itemsBySeller = {};
      for (const item of cartItems) {
        const prod = item.product_variant_combinations?.products;
        const sellerId = prod?.user_id || prod?.customer_id || 'store';
        if (!itemsBySeller[sellerId]) {
          itemsBySeller[sellerId] = {
            sellerId: sellerId === 'store' ? null : sellerId,
            items: [],
            subtotal: 0,
          };
        }
        const itemPrice = Number(item.product_variant_combinations?.price || 0);
        const itemQty = Number(item.quantity || 1);
        itemsBySeller[sellerId].items.push(item);
        itemsBySeller[sellerId].subtotal += itemPrice * itemQty;
      }

      const sellerKeys = Object.keys(itemsBySeller);
      const createdOrders = [];

      for (const sellerKey of sellerKeys) {
        const sellerGroup = itemsBySeller[sellerKey];
        const rawSellerId = sellerGroup.sellerId && sellerGroup.sellerId !== 'store'
          ? sellerGroup.sellerId
          : (resolvedSellerId || (profile?.role === 'seller' ? profile?.id : null));

        const isValidUUID = (val) =>
          typeof val === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
        const targetSellerId = isValidUUID(rawSellerId) ? rawSellerId.trim() : null;

        const groupSubtotal = sellerGroup.subtotal;
        const groupCgst = isTaxEnabled && groupSubtotal > 0 ? Math.round(groupSubtotal * (cgstRate / 100) * 100) / 100 : 0;
        const groupSgst = isTaxEnabled && groupSubtotal > 0 ? Math.round(groupSubtotal * (sgstRate / 100) * 100) / 100 : 0;
        const groupService = isServiceCostEnabled && groupSubtotal > 0 && serviceCostRate > 0 ? Math.round(groupSubtotal * (serviceCostRate / 100) * 100) / 100 : 0;
        const groupTotal = groupSubtotal + groupCgst + groupSgst + groupService;

        const billingBreakdown = {
          subtotal: groupSubtotal,
          cgst_amount: groupCgst,
          sgst_amount: groupSgst,
          service_cost: groupService,
          cgst_rate: cgstRate,
          sgst_rate: sgstRate,
          service_cost_rate: serviceCostRate,
          total: groupTotal,
        };

        const cashierTitle = isEmployee
          ? `${activeEmployee?.name || 'Staff'} (${activeEmployee?.designation || 'Cashier'})`
          : (profile?.full_name || 'Store Owner');

        const shippingWithBilling = {
          type: 'Dine-in',
          table_no: activeTable,
          name: customerDisplayName,
          mobile: customerMobile || (profile?.mobile || ''),
          address: `POS Counter Bill (${activeTable})`,
          city: city || profile?.city || '',
          postalCode: postalCode || profile?.zip_code || '',
          billing: billingBreakdown,
          payment_reference: uniquePaymentCode,
          payment_note: orderNote,
          payment_status: 'paid',
          cashier_name: cashierTitle,
          cashier_id: activeEmployee?.id || null,
        };

        const orderPayload = {
          user_id: orderUserId,
          seller_id: targetSellerId,
          shipping_address: shippingWithBilling,
          total_amount: groupTotal,
          subtotal: groupSubtotal,
          cgst_amount: groupCgst,
          sgst_amount: groupSgst,
          service_cost: groupService,
          cgst_rate: cgstRate,
          sgst_rate: sgstRate,
          service_cost_rate: serviceCostRate,
          status: chosenStatus,
          payment_method: chosenMethod,
          payment_reference: uniquePaymentCode,
          payment_status: chosenPayStatus,
          order_type: 'shop-order',
          table_no: activeTable,
        };

        let order = null;
        let orderError = null;

        // Direct table insert
        let res = await supabase
          .from('orders')
          .insert(orderPayload)
          .select()
          .single();
        order = res.data;
        orderError = res.error;

        if (orderError && (orderError.code === 'PGRST204' || (orderError.message && orderError.message.includes('column')))) {
          console.warn('Retrying POS sub-order creation without extra columns:', orderError.message);
          const fallbackPayload = {
            user_id: orderUserId,
            seller_id: targetSellerId,
            shipping_address: shippingWithBilling,
            total_amount: groupTotal,
            status: chosenStatus,
            payment_method: chosenMethod,
            payment_reference: uniquePaymentCode,
            order_type: 'shop-order',
            table_no: activeTable,
          };
          if (orderError.message && orderError.message.includes('payment_reference')) {
            delete fallbackPayload.payment_reference;
          }
          let retry = await supabase.from('orders').insert(fallbackPayload).select().single();
          if (retry.error && (retry.error.code === 'PGRST204' || (retry.error.message && retry.error.message.includes('seller_id')))) {
            delete fallbackPayload.seller_id;
            retry = await supabase.from('orders').insert(fallbackPayload).select().single();
          }
          if (retry.error && (retry.error.code === 'PGRST204' || (retry.error.message && (retry.error.message.includes('payment_reference') || retry.error.message.includes('column'))))) {
            delete fallbackPayload.payment_reference;
            retry = await supabase.from('orders').insert(fallbackPayload).select().single();
          }
          order = retry.data;
          orderError = retry.error;
        }

        if (orderError) {
          console.error('Error creating POS sub-order:', orderError.message);
          throw orderError;
        }

        const orderItemsPayload = sellerGroup.items.map((item) => ({
          order_id: order.id,
          product_variant_combination_id: item.product_variant_combinations.id,
          quantity: item.quantity,
          price: item.product_variant_combinations.price,
        }));

        const { error: orderItemsError } = await supabase
          .from('order_items')
          .insert(orderItemsPayload);

        if (orderItemsError) {
          console.error('Error creating POS order items:', orderItemsError.message);
          throw orderItemsError;
        }

        if (order) {
          order.billing = billingBreakdown;
          order.subtotal = groupSubtotal;
          order.cgst_amount = groupCgst;
          order.sgst_amount = groupSgst;
          order.service_cost = groupService;
          order.cgst_rate = cgstRate;
          order.sgst_rate = sgstRate;
          order.service_cost_rate = serviceCostRate;
          order.order_items = sellerGroup.items;
          order.payment_status = 'paid';
          order.status = 'completed';
        }

        createdOrders.push(order);
        if (!orderUserId && order?.id) {
          saveGuestOrderId(order.id);
        }
      }

      // Clear the user's cart in database if cart.id is present
      if (cart?.id) {
        await supabase.from('cart_items').delete().eq('cart_id', cart.id);
      }
      await clearGuestCart();
      setCart({ cart_items: [] });
      if (contextSetCart) {
        contextSetCart({ cart_items: [] });
      }

      // Reset payment code for next transaction
      setUniquePaymentCode(Math.floor(100000 + Math.random() * 900000).toString());

      const firstOrder = createdOrders[0];

      // Auto-print receipt if requested
      if (printOnFinish && firstOrder) {
        try {
          await printReceipt(firstOrder, {
            storeName: resolvedSellerName || profile?.store_name || profile?.full_name,
          });
        } catch (printErr) {
          console.warn('POS receipt print error:', printErr);
        }
      }

      // Voice announcement if enabled
      if (firstOrder) {
        try {
          announceOrderPrint(firstOrder);
        } catch (_) {}
      }

      setShowPosConfirmModal(false);
      setIsProcessingPos(false);
      setLoading(false);

      // Open Fast Success Modal with Next Customer countdown / 1-tap reload of Catalog!
      setPosSuccessData({
        order: firstOrder,
        orderCount: createdOrders.length,
        method: isCash ? 'Cash' : 'UPI',
        amount: totalAmount,
      });
      setShowPosSuccessModal(true);

    } catch (err) {
      setIsProcessingPos(false);
      setLoading(false);
      showAlert('Billing Error', err.message || 'Failed to complete fast bill. Please try again.');
    }
  };

  const openQrImageViewer = () => {
    const list = [];
    const activeDynamicUrl = dynamicQrDataUrl || fallbackDynamicQrUrl;
    if (activeDynamicUrl) {
      list.push({
        id: 'checkout-dynamic-qr',
        uri: activeDynamicUrl,
        type: 'image',
        title: `Dynamic UPI QR Code (₹${totalAmount.toFixed(2)})`,
        subtitle: `Scan to pay ₹${totalAmount.toFixed(2)} to ${resolvedSellerName || 'Store'}`,
      });
    }
    if (profileQrImageUrl) {
      list.push({
        id: 'checkout-profile-qr',
        uri: profileQrImageUrl,
        type: 'image',
        title: `Seller Store Standee QR Code - ${resolvedSellerName || 'Store'}`,
        subtitle: `UPI ID: ${activeUpiId || 'Store QR'}`,
      });
    }
    (cartItems || []).forEach((ci) => {
      const prod = ci?.product_variant_combinations?.products;
      const pMedia = (prod?.product_media || []).filter((m) => m && (m.media_url || m.uri));
      const prodName = prod?.product_name || 'Cart Item';
      const prodPrice = ci?.product_variant_combinations?.price || prod?.amount;
      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          list.push({
            id: `ci-${ci.id}-m-${mIdx}`,
            uri: m.media_url || m.uri,
            type: m.media_type || 'image',
            title: prodName,
            subtitle: prodPrice ? `₹${prodPrice}` : null,
          });
        });
      } else if (prod?.image_url || ci?.image_url) {
        list.push({
          id: `ci-${ci.id}-img`,
          uri: prod?.image_url || ci?.image_url,
          type: 'image',
          title: prodName,
          subtitle: prodPrice ? `₹${prodPrice}` : null,
        });
      }
    });

    if (list.length > 0) {
      setQrViewerMedia(list);
      setQrViewerIndex(0);
      setIsQrViewerVisible(true);
    }
  };

  if (!cartItems || cartItems.length === 0) {
    return (
      <View
        style={[
          styles.mainContainer,
          Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backHeaderBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={16} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
            <Icon name="close" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyCartContainer}>
          <Icon name="shopping-cart" size={64} color="#cbd5e1" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyCartTitle}>Your cart is empty</Text>
          <Text style={styles.emptyCartSubtitle}>
            Add items from the catalog to proceed to checkout.
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => navigation.navigate('Catalog', { sellerId: resolvedSellerId, sellerName: resolvedSellerName, customerId })}
          >
            <Text style={styles.browseButtonText}>Browse Catalog</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Navigation Footer (Store, Cart, Orders) */}
        <StoreNavigationFooter
          activeTab="cart"
          navigation={navigation}
          route={route}
          sellerId={resolvedSellerId}
          sellerName={resolvedSellerName}
          customerId={customerId}
          forceShow={true}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.mainContainer,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      {/* Header with Back button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHeaderBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Cart"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
          <Icon name="close" size={20} color="#64748B" />
        </TouchableOpacity>
      </View>

      {/* Scrollable Container with Visible Scroll Indicator */}
      <ScrollView
        style={[
          styles.scrollView,
          Platform.OS === 'web' ? { flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : null,
        ]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 150 }]}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
      >
        {/* Guest Sign-In Notice Banner (Only mandatory for Parcel orders) */}
        {!currentUser && orderType === 'Parcel' && (
          <View style={styles.guestBanner}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.guestBannerTitle}>🛍️ Sign in to complete parcel order</Text>
              <Text style={styles.guestBannerSubtitle}>
                Log in or create an account to save your address and deliver parcel orders.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.guestSignInButton}
              onPress={() =>
                navigation.navigate('BuyerLogin', {
                  redirectTo: 'Checkout',
                  redirectParams: { cart, customerId },
                })
              }
            >
              <Text style={styles.guestSignInButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Order Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          <Text style={styles.summaryItems}>
            {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in cart
          </Text>
          {(isTaxEnabled || (isServiceCostEnabled && serviceCost > 0)) && (
            <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 13, color: '#64748B' }}>Items Subtotal</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>₹{subtotal.toFixed(2)}</Text>
              </View>
              {isTaxEnabled && cgstAmount > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: '#64748B' }}>CGST ({cgstRate}%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{cgstAmount.toFixed(2)}</Text>
                </View>
              )}
              {isTaxEnabled && sgstAmount > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: '#64748B' }}>SGST ({sgstRate}%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{sgstAmount.toFixed(2)}</Text>
                </View>
              )}
              {isServiceCostEnabled && serviceCost > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: '#64748B' }}>Service Charge ({serviceCostRate}%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{serviceCost.toFixed(2)}</Text>
                </View>
              )}
            </View>
          )}
          <Text style={styles.summaryTotal}>Total: ₹{totalAmount.toFixed(2)}</Text>
        </View>

        {/* ============================================================ */}
        {/* FAST COUNTER POS BILLING CARD (Seller / Cashier Employee)    */}
        {/* ============================================================ */}
        {isSellerOrEmployee && (
          <View style={styles.posBillingCard}>
            {/* Card Header */}
            <View style={styles.posCardHeader}>
              <View style={styles.posHeaderLeft}>
                <View style={styles.posBadgePill}>
                  <Icon name="bolt" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
                  <Text style={styles.posBadgePillText}>FAST COUNTER POS</Text>
                </View>
                <Text style={styles.posCardTitle}>Direct Counter Checkout</Text>
              </View>
              <View style={styles.posRoleBadge}>
                <Icon
                  name={isEmployee ? 'id-badge' : 'star'}
                  size={11}
                  color="#0F766E"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.posRoleBadgeText}>
                  {isEmployee
                    ? `Staff: ${activeEmployee?.name || 'Cashier'}`
                    : (profile?.full_name || 'Store Owner')}
                </Text>
              </View>
            </View>

            <Text style={styles.posSubtitle}>
              Customer at counter? Show the QR code or collect cash, then tap below to finish the bill instantly and load catalog for the next customer.
            </Text>

            {/* QR Code Section */}
            {isUpiConfigured ? (
              <View style={styles.posQrWrapper}>
                <View style={styles.posQrCard}>
                  <View style={styles.posQrHeaderRow}>
                    <Icon name="qrcode" size={16} color="#007AFF" style={{ marginRight: 6 }} />
                    <Text style={styles.posQrHeaderTitle}>⚡ Scan &amp; Pay Exact Bill</Text>
                    <View style={styles.posQrAmountBadge}>
                      <Text style={styles.posQrAmountBadgeText}>₹{totalAmount.toFixed(2)}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.posQrImageBtn}
                    onPress={openQrImageViewer}
                    activeOpacity={0.88}
                    accessibilityLabel="Tap to enlarge QR Code full screen for customer"
                  >
                    <Image
                      source={{ uri: displayedQrUri }}
                      style={styles.posQrImage}
                      resizeMode="contain"
                    />
                    <View style={styles.posQrEnlargeOverlay}>
                      <Icon name="expand" size={10} color="#007AFF" style={{ marginRight: 4 }} />
                      <Text style={styles.posQrEnlargeText}>Tap to Enlarge for Customer</Text>
                    </View>
                  </TouchableOpacity>

                  {activeUpiId ? (
                    <View style={styles.posUpiPill}>
                      <Text style={styles.posUpiLabel}>UPI ID:</Text>
                      <Text style={styles.posUpiValue} numberOfLines={1}>{activeUpiId}</Text>
                      <TouchableOpacity
                        style={styles.posCopyBtn}
                        onPress={handleCopyUpiId}
                        activeOpacity={0.8}
                      >
                        <Icon name={copiedUpi ? 'check' : 'clone'} size={11} color="#007AFF" />
                        <Text style={styles.posCopyBtnText}>{copiedUpi ? 'Copied' : 'Copy'}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <Text style={styles.posAcceptedAppsText}>
                    Google Pay • PhonePe • Paytm • BHIM • Any UPI App
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.posNoUpiBox}>
                <Icon name="info-circle" size={15} color="#D97706" style={{ marginRight: 6 }} />
                <Text style={styles.posNoUpiText}>
                  Store UPI is not configured. Customer can pay directly with Cash.
                </Text>
              </View>
            )}

            {/* Paid by Cash & Paid by UPI Buttons */}
            <View style={styles.posActionButtonsRow}>
              {/* Paid by Cash Button */}
              <TouchableOpacity
                style={[
                  styles.posCashButton,
                  loading && styles.posButtonDisabled,
                ]}
                onPress={() => promptFastOrderConfirmation('cash')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.posCashIconCircle}>
                  <Icon name="money" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.posButtonLabel}>Paid by Cash</Text>
                  <Text style={styles.posButtonAmount}>Collect ₹{totalAmount.toFixed(2)}</Text>
                </View>
                <Icon name="check-circle" size={16} color="#FFFFFF" style={{ opacity: 0.9 }} />
              </TouchableOpacity>

              {/* Paid by UPI Button */}
              <TouchableOpacity
                style={[
                  styles.posUpiButton,
                  (!isUpiConfigured || loading) && styles.posButtonDisabled,
                ]}
                onPress={() => {
                  if (!isUpiConfigured) {
                    showAlert(
                      'UPI Not Configured',
                      'Store seller has not set up UPI ID. Please collect cash payment.'
                    );
                    return;
                  }
                  promptFastOrderConfirmation('upi');
                }}
                disabled={loading || !isUpiConfigured}
                activeOpacity={0.85}
              >
                <View style={styles.posUpiIconCircle}>
                  <Icon name="qrcode" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.posButtonLabel}>Paid by UPI</Text>
                  <Text style={styles.posButtonAmount}>Received ₹{totalAmount.toFixed(2)}</Text>
                </View>
                <Icon name="bolt" size={16} color="#FFFFFF" style={{ opacity: 0.9 }} />
              </TouchableOpacity>
            </View>

            <View style={styles.posFooterHintRow}>
              <Icon name="lightbulb-o" size={13} color="#64748B" style={{ marginRight: 5 }} />
              <Text style={styles.posFooterHintText}>
                Confirms payment, prints receipt &amp; reloads catalog for next customer automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Order Type Selector (Dine-in Default vs Parcel) */}
        <View style={styles.orderTypeCard}>
          <Text style={styles.sectionHeading}>Order Type</Text>
          <View style={styles.orderTypeSegmentedRow}>
            <TouchableOpacity
              style={[
                styles.orderTypeSegmentBtn,
                orderType === 'Dine-in' && styles.orderTypeSegmentBtnActive,
              ]}
              onPress={() => {
                setOrderType('Dine-in');
                setOrderTypeConfirmed(true);
              }}
              activeOpacity={0.8}
            >
              <Icon
                name="cutlery"
                size={15}
                color={orderType === 'Dine-in' ? '#FFFFFF' : '#007AFF'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.orderTypeSegmentText,
                  orderType === 'Dine-in' && styles.orderTypeSegmentTextActive,
                ]}
              >
                🍽️ Dine-in (Default)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.orderTypeSegmentBtn,
                orderType === 'Parcel' && styles.orderTypeSegmentBtnActive,
              ]}
              onPress={() => {
                setOrderType('Parcel');
                setOrderTypeConfirmed(true);
                if (!currentUser) {
                  showAlert(
                    'Sign In Required for Parcel',
                    'Parcel orders require delivery & contact details. Please sign in or create an account to proceed.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Sign In / Sign Up',
                        onPress: () =>
                          navigation.navigate('BuyerLogin', {
                            redirectTo: 'Checkout',
                            redirectParams: { cart, customerId },
                          }),
                      },
                    ]
                  );
                }
              }}
              activeOpacity={0.8}
            >
              <Icon
                name="cube"
                size={15}
                color={orderType === 'Parcel' ? '#FFFFFF' : '#007AFF'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.orderTypeSegmentText,
                  orderType === 'Parcel' && styles.orderTypeSegmentTextActive,
                ]}
              >
                📦 Parcel / Takeaway
              </Text>
            </TouchableOpacity>
          </View>

          {orderType === 'Dine-in' ? (
            <View style={styles.dineInDetailsBox}>
              <View style={styles.dineInHeaderRow}>
                <Icon name="check-circle" size={14} color="#10B981" style={{ marginRight: 6 }} />
                <Text style={styles.dineInNoticeText}>
                  Dining in at store. Login and delivery address are not mandatory!
                </Text>
              </View>

              <Text style={styles.formFieldLabel}>Select Table / Counter:</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={tableNo}
                  onValueChange={(itemValue) => setTableNo(itemValue)}
                  style={styles.picker}
                >
                  {tableOptions.map((option) => (
                    <Picker.Item
                      key={option}
                      label={option === 'Main counter' ? 'Main Counter (Self Pick-up)' : `Table #${option}`}
                      value={option}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={[styles.formFieldLabel, { marginTop: 10 }]}>Customer Name (Optional):</Text>
              <TextInput
                style={styles.input}
                placeholder="Guest Customer (Optional)"
                placeholderTextColor="#94a3b8"
                value={name}
                onChangeText={setName}
              />
            </View>
          ) : (
            <View style={styles.parcelNoticeBox}>
              <Icon name="info-circle" size={14} color="#D97706" style={{ marginRight: 6 }} />
              <Text style={styles.parcelNoticeText}>
                Parcel Order: Contact number, delivery address & sign-in are mandatory.
              </Text>
            </View>
          )}
        </View>

        {/* Delivery Address & Contact (Rendered ONLY when orderType is Parcel) */}
        {orderType === 'Parcel' && (
          <View>
            <View style={styles.addressSectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionHeading}>Delivery Address & Contact *</Text>
                <Text style={styles.sectionSubheading}>Choose saved address or pick location with GPS map</Text>
              </View>
              <TouchableOpacity
                style={styles.addAddressHeaderBtn}
                onPress={handleOpenAddAddressModal}
                activeOpacity={0.8}
              >
                <Icon name="map-marker" size={12} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.addAddressHeaderBtnText}>+ Add / Map</Text>
              </TouchableOpacity>
            </View>

            {/* Saved Addresses Horizontal Carousel */}
            {savedAddresses && savedAddresses.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.savedAddressesScroll}
              >
                {savedAddresses.map((addr) => {
                  const isSelected = selectedAddressId === addr.id;
                  return (
                    <TouchableOpacity
                      key={addr.id}
                      style={[styles.addressCard, isSelected && styles.addressCardSelected]}
                      onPress={() => handleSelectAddress(addr)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.addressCardTopRow}>
                        <View
                          style={[
                            styles.addressTagBadge,
                            addr.tag === 'Work'
                              ? styles.tagWork
                              : addr.tag === 'Other'
                              ? styles.tagOther
                              : styles.tagHome,
                          ]}
                        >
                          <Icon
                            name={addr.tag === 'Work' ? 'briefcase' : addr.tag === 'Other' ? 'map-pin' : 'home'}
                            size={11}
                            color="#0F172A"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.addressTagText}>{addr.tag || 'Home'}</Text>
                        </View>
                        <Icon
                          name={isSelected ? 'check-circle' : 'circle-o'}
                          size={18}
                          color={isSelected ? '#007AFF' : '#94A3B8'}
                        />
                      </View>

                      <Text style={styles.addressCardName} numberOfLines={1}>
                        {addr.recipient_name}
                      </Text>
                      <Text style={styles.addressCardMobile}>
                        <Icon name="phone" size={11} color="#64748B" /> {addr.mobile}
                      </Text>
                      <Text style={styles.addressCardDetails} numberOfLines={2}>
                        {addr.address_line_1}, {addr.city} {addr.zip_code ? `- ${addr.zip_code}` : ''}
                      </Text>

                      {addr.latitude && addr.longitude && (
                        <View style={styles.addressGpsBadge}>
                          <Icon name="crosshairs" size={10} color="#10B981" style={{ marginRight: 4 }} />
                          <Text style={styles.addressGpsText}>GPS Pinned</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <TouchableOpacity
                style={styles.emptyAddressBanner}
                onPress={handleOpenAddAddressModal}
                activeOpacity={0.8}
              >
                <View style={styles.emptyAddressIconCircle}>
                  <Icon name="map-marker" size={20} color="#007AFF" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.emptyAddressTitle}>Set Delivery Location on Map</Text>
                  <Text style={styles.emptyAddressSubtitle}>
                    Tap to pick location from map and save your delivery address
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color="#94A3B8" />
              </TouchableOpacity>
            )}

            {/* Active Address Form Fields */}
            <View style={styles.addressFormBox}>
              <Text style={styles.formFieldLabel}>Recipient Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Full Name *"
                placeholderTextColor="#94a3b8"
                value={name}
                onChangeText={setName}
              />

              <View style={styles.mobileInputHeaderRow}>
                <Text style={styles.formFieldLabel}>Mobile Number (10 digits) *</Text>
                {isMobileVerified || profile?.mobile ? (
                  <View style={styles.verifiedBadge}>
                    <Icon name="check-circle" size={12} color="#10B981" style={{ marginRight: 4 }} />
                    <Text style={styles.verifiedBadgeText}>Verified</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleSendEmailOtp()}
                    disabled={sendingEmailOtp}
                    style={styles.verifyOtpLinkBtn}
                  >
                    {sendingEmailOtp ? (
                      <ActivityIndicator size="small" color="#007AFF" />
                    ) : (
                      <Text style={styles.verifyOtpLinkText}>Verify via Email OTP</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.mobileInputWrap}>
                <Text style={styles.countryCodePrefix}>+91</Text>
                <TextInput
                  style={[styles.input, styles.mobileInputInner]}
                  placeholder="10-digit mobile number *"
                  placeholderTextColor="#94a3b8"
                  value={mobile}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 10);
                    setMobile(cleaned);
                  }}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>

              <Text style={styles.formFieldLabel}>Address / Street / Landmark *</Text>
              <TextInput
                style={styles.input}
                placeholder="Address / Street / Landmark *"
                placeholderTextColor="#94a3b8"
                value={address}
                onChangeText={setAddress}
              />

              <View style={styles.addressCityRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.formFieldLabel}>City *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="City *"
                    placeholderTextColor="#94a3b8"
                    value={city}
                    onChangeText={setCity}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.formFieldLabel}>Postal Code</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Postal Code"
                    placeholderTextColor="#94a3b8"
                    value={postalCode}
                    onChangeText={setPostalCode}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {selectedCoords && (
                <View style={styles.activeCoordsRow}>
                  <Icon name="crosshairs" size={13} color="#10B981" style={{ marginRight: 6 }} />
                  <Text style={styles.activeCoordsText}>
                    GPS Coordinates: {selectedCoords.latitude.toFixed(5)}, {selectedCoords.longitude.toFixed(5)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        <Text style={styles.sectionHeading}>Payment Method</Text>
        <View style={styles.paymentMethodContainer}>
          {isUpiConfigured && (
            <TouchableOpacity
              style={[styles.paymentButton, paymentMethod === 'upi' && styles.selectedPaymentButton]}
              onPress={() => handlePayWithUpiPress('select_upi')}
              activeOpacity={0.8}
            >
              <Icon
                name="qrcode"
                size={22}
                color={paymentMethod === 'upi' ? '#FFFFFF' : '#007AFF'}
                style={{ marginBottom: 6 }}
              />
              <Text
                style={[
                  styles.paymentButtonText,
                  paymentMethod === 'upi' && styles.selectedPaymentButtonText,
                ]}
              >
                Pay with UPI
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.paymentButton,
              paymentMethod === 'cod' && styles.selectedPaymentButton,
              !isUpiConfigured && { flex: 1 },
            ]}
            onPress={() => setPaymentMethod('cod')}
            activeOpacity={0.8}
          >
            <Icon
              name="money"
              size={22}
              color={paymentMethod === 'cod' ? '#FFFFFF' : '#007AFF'}
              style={{ marginBottom: 6 }}
            />
            <Text
              style={[
                styles.paymentButtonText,
                paymentMethod === 'cod' && styles.selectedPaymentButtonText,
              ]}
            >
              {orderType === 'Dine-in' ? 'Pay at Counter (Cash)' : 'Cash on Delivery'}
            </Text>
          </TouchableOpacity>
        </View>

        {!isUpiConfigured && (
          <View style={styles.noUpiBanner}>
            <Icon name="info-circle" size={13} color="#64748B" style={{ marginRight: 6 }} />
            <Text style={styles.noUpiBannerText}>
              Cash payment only (Seller has not configured UPI details).
            </Text>
          </View>
        )}

        {/* UPI PAYMENT CARD (Displayed strictly from seller profile when UPI is configured) */}
        {paymentMethod === 'upi' && isUpiConfigured && (
          <View style={styles.upiCardContainer}>
            {/* Header */}
            <View style={styles.upiCardHeader}>
              <View style={styles.upiHeaderLeft}>
                <View style={styles.upiIconCircle}>
                  <Icon name="qrcode" size={18} color="#007AFF" />
                </View>
                <View>
                  <Text style={styles.upiCardTitle}>Instant UPI Payment</Text>
                  <Text style={styles.upiCardSubtitle}>
                    Pay to: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{storeDisplayName}</Text>
                  </Text>
                </View>
              </View>
              <View style={styles.upiVerifiedBadge}>
                <Icon name="check-circle" size={12} color="#10B981" style={{ marginRight: 4 }} />
                <Text style={styles.upiVerifiedText}>Active</Text>
              </View>
            </View>

            {/* Bill Amount Banner */}
            <View style={styles.upiAmountPill}>
              <View>
                <Text style={styles.upiAmountLabel}>Order Bill Amount:</Text>
                <Text style={styles.upiAmountSub}>
                  {Platform.OS === 'web'
                    ? "Scan Dynamic Bill QR or copy UPI ID below"
                    : "Scan Profile QR or tap 'Pay in UPI App' below"}
                </Text>
              </View>
              <Text style={styles.upiAmountValue}>₹{totalAmount.toFixed(2)}</Text>
            </View>

            {/* UPI Payment Reference Code Pill (Unique 6-digit reference for bank/UPI reconciliation) */}
            <View style={styles.paymentRefPill}>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentRefLabel}>UPI Transaction Note / Ref:</Text>
                <Text style={styles.paymentRefValue}>{orderNote}</Text>
              </View>
              <View style={styles.paymentRefCodeBadge}>
                <Text style={styles.paymentRefCodeText}>{uniquePaymentCode}</Text>
              </View>
            </View>

            {/* QR Mode Switcher (Dynamic Bill QR vs Store Standee QR) */}
            {profileQrImageUrl && (dynamicUpiUri || dynamicQrDataUrl) ? (
              <View style={styles.qrTabContainer}>
                <TouchableOpacity
                  style={[styles.qrTabButton, qrTab === 'dynamic' && styles.qrTabButtonActive]}
                  onPress={() => setQrTab('dynamic')}
                  activeOpacity={0.8}
                >
                  <Icon
                    name="qrcode"
                    size={14}
                    color={qrTab === 'dynamic' ? '#007AFF' : '#64748B'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.qrTabText, qrTab === 'dynamic' && styles.qrTabTextActive]}>
                    ⚡ Dynamic Bill QR (₹{totalAmount.toFixed(2)})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.qrTabButton, qrTab === 'profile' && styles.qrTabButtonActive]}
                  onPress={() => setQrTab('profile')}
                  activeOpacity={0.8}
                >
                  <Icon
                    name="image"
                    size={14}
                    color={qrTab === 'profile' ? '#007AFF' : '#64748B'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.qrTabText, qrTab === 'profile' && styles.qrTabTextActive]}>
                    🏪 Store Standee QR
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* QR Code Container - Displays Dynamic or Profile QR Code */}
            <View style={styles.qrBox}>
              {loadingSellerQr ? (
                <View style={styles.qrLoadingBox}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.qrLoadingText}>Loading QR Code...</Text>
                </View>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={openQrImageViewer}
                  style={styles.qrImageTouchable}
                  accessibilityLabel="Tap to view full screen QR code"
                >
                  <Image
                    source={{
                      uri: displayedQrUri,
                    }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                  <View style={styles.qrAmountOverlay}>
                    <Text style={styles.qrAmountOverlayText}>
                      Exact Bill: ₹{totalAmount.toFixed(2)}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            {/* Highlighted QR Code Download to Device Button */}
            <TouchableOpacity
              style={styles.downloadQrHighlightBtn}
              onPress={handleDownloadQrCode}
              disabled={isDownloadingQr}
              activeOpacity={0.84}
              accessibilityLabel="Download QR code image to device"
            >
              {isDownloadingQr ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
              ) : (
                <View style={styles.downloadIconBadge}>
                  <Icon name="download" size={17} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.downloadQrTextContainer}>
                <Text style={styles.downloadQrBtnText}>Download QR Code to Device</Text>
                <Text style={styles.downloadQrBtnSubText}>Save QR to gallery &amp; pay anytime with any UPI app</Text>
              </View>
              <Icon name="chevron-right" size={14} color="#FFFFFF" style={{ opacity: 0.85, marginLeft: 6 }} />
            </TouchableOpacity>

            <Text style={styles.qrScanInstruction}>
              {qrTab === 'profile' && profileQrImageUrl
                ? `Scan Seller's Store Standee QR code with Google Pay, PhonePe, Paytm or any UPI app to pay ₹${totalAmount.toFixed(2)}.`
                : `Scan with Google Pay, PhonePe, Paytm or any UPI app. Bill amount (₹${totalAmount.toFixed(2)}) and payee are pre-filled automatically!`}
            </Text>

            {/* Direct 1-Tap UPI Apps & Intent Links - Disabled on Web */}
            {Platform.OS !== 'web' && (
              <View style={styles.upiAppsSection}>
                <View style={styles.upiAppsSectionHeader}>
                  <Text style={styles.upiAppsSectionTitle}>🚀 Instant 1-Tap Pay via UPI App</Text>
                  <Text style={styles.upiAppsSectionSub}>Tap your app to pay ₹{totalAmount.toFixed(2)} with pre-filled bill total</Text>
                </View>

                <View style={styles.upiAppsGrid}>
                  {upiAppList
                    .filter((a) => a.id !== 'any')
                    .map((app) => {
                      const webHref = getAppWebHref(app);
                      return (
                        <TouchableOpacity
                          key={app.id}
                          style={[
                            styles.upiAppCard,
                            { borderColor: app.borderColor, backgroundColor: app.bgColor },
                          ]}
                          onPress={() => handleOpenDirectUpiPay(app.id)}
                          accessibilityRole={Platform.OS === 'web' && webHref ? 'link' : 'button'}
                          href={webHref}
                          target="_top"
                          rel="noopener noreferrer"
                          activeOpacity={0.8}
                        >
                          <View style={[styles.upiAppIconCircle, { backgroundColor: '#FFFFFF' }]}>
                            <Icon name={app.icon} size={15} color={app.color} />
                          </View>
                          <View style={styles.upiAppTextCol}>
                            <Text style={[styles.upiAppName, { color: app.color }]}>{app.name}</Text>
                            <Text style={styles.upiAppActionText}>Pay ₹{totalAmount.toFixed(2)}</Text>
                          </View>
                          <Icon name="chevron-right" size={11} color={app.color} style={{ opacity: 0.6 }} />
                        </TouchableOpacity>
                      );
                    })}
                </View>

                {/* All Apps / System Chooser Intent Button */}
                {(() => {
                  const anyApp = upiAppList.find((a) => a.id === 'any') || upiAppList[0];
                  const anyHref = anyApp ? getAppWebHref(anyApp) : undefined;
                  return (
                    <TouchableOpacity
                      style={styles.directUpiPayButton}
                      onPress={() => handleOpenDirectUpiPay('any')}
                      accessibilityRole={Platform.OS === 'web' && anyHref ? 'link' : 'button'}
                      href={anyHref}
                      target="_top"
                      rel="noopener noreferrer"
                      activeOpacity={0.85}
                    >
                      <Icon name="mobile-phone" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.directUpiPayButtonText}>
                        Pay ₹{totalAmount.toFixed(2)} in Any UPI App
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
            )}

            {/* Google Pay / UPI Security Guidance - Disabled on Web */}
            {Platform.OS !== 'web' && (
              <View style={styles.upiSecurityTipCard}>
                <Icon name="shield" size={15} color="#0D9488" style={{ marginTop: 2, marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.upiSecurityTipTitle}>Smooth UPI Checkout Tip</Text>
                  <Text style={styles.upiSecurityTipText}>
                    If Google Pay displays a &quot;Transaction may be risky&quot; warning when tapping a link to an individual seller, simply scan the QR code above with your Google Pay camera, or choose PhonePe / Paytm / Any UPI App for 1-tap payment!
                  </Text>
                </View>
              </View>
            )}

            {/* Payee UPI ID & 1-Tap Copy */}
            <View style={styles.upiIdRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.upiIdLabel}>Merchant UPI ID / VPA:</Text>
                <Text style={styles.upiIdText} numberOfLines={1}>
                  {activeUpiId}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.copyUpiBtn, copiedUpi && styles.copyUpiBtnCopied]}
                onPress={handleCopyUpiId}
                activeOpacity={0.8}
              >
                <Icon
                  name={copiedUpi ? 'check' : 'clone'}
                  size={12}
                  color={copiedUpi ? '#FFFFFF' : '#007AFF'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.copyUpiBtnText, copiedUpi && { color: '#FFFFFF' }]}>
                  {copiedUpi ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Docked Action Footer Bar (Visible on Web & Mobile, Never disappears) */}
      <View style={styles.dockedFooterBar}>
        <TouchableOpacity
          style={styles.footerBackBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Icon name="arrow-left" size={14} color="#0F172A" style={{ marginRight: 6 }} />
          <Text style={styles.footerBackBtnText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.footerTotalBox}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalAmount}>₹{totalAmount.toFixed(2)}</Text>
        </View>

        <TouchableOpacity
          style={[styles.footerPlaceOrderBtn, loading && styles.placeOrderButtonDisabled]}
          onPress={() => {
            if (paymentMethod === 'upi' && !orderTypeConfirmed) {
              handlePayWithUpiPress('place_order');
            } else {
              handlePlaceOrder();
            }
          }}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Icon
                name={paymentMethod === 'upi' ? 'qrcode' : 'check-circle'}
                size={15}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.footerPlaceOrderBtnText}>
                {paymentMethod === 'upi'
                  ? (orderType === 'Dine-in' ? 'Pay with UPI (Dine-in)' : 'Pay with UPI (Parcel)')
                  : (orderType === 'Dine-in' ? 'Confirm Dine-in Order' : 'Place Order')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Bottom Navigation Footer (Store, Cart, Orders) */}
      <StoreNavigationFooter
        activeTab="cart"
        navigation={navigation}
        route={route}
        sellerId={resolvedSellerId}
        sellerName={resolvedSellerName}
        customerId={customerId}
        forceShow={true}
      />

      {/* ORDER TYPE SELECTION MODAL (Prompted when user clicks Pay with UPI) */}
      <Modal
        visible={showOrderTypeModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowOrderTypeModal(false)}
      >
        <View style={styles.orderTypeModalOverlay}>
          <View style={styles.orderTypeModalCard}>
            <View style={styles.orderTypeModalHeader}>
              <View style={styles.orderTypeModalIconWrap}>
                <Icon name="question-circle" size={26} color="#007AFF" />
              </View>
              <Text style={styles.orderTypeModalTitle}>Select Order Type</Text>
              <Text style={styles.orderTypeModalSub}>
                Is this order for Dine-in at the store or Parcel takeaway?
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.modalOptionCard,
                orderType === 'Dine-in' && styles.modalOptionCardActive,
              ]}
              onPress={handleSelectDineIn}
              activeOpacity={0.8}
            >
              <View style={styles.modalOptionIconCircle}>
                <Icon name="cutlery" size={18} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={styles.modalOptionTitle}>🍽️ Dine-in (Default)</Text>
                  <View style={styles.modalOptionBadgeGreen}>
                    <Text style={styles.modalOptionBadgeGreenText}>No Login Needed</Text>
                  </View>
                </View>
                <Text style={styles.modalOptionDesc}>
                  Eat at store. Select your table or counter. No login or delivery address required.
                </Text>
              </View>
              <Icon name="chevron-right" size={14} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modalOptionCard,
                orderType === 'Parcel' && styles.modalOptionCardActive,
              ]}
              onPress={handleSelectParcel}
              activeOpacity={0.8}
            >
              <View style={styles.modalOptionIconCircleOrange}>
                <Icon name="cube" size={18} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={styles.modalOptionTitle}>📦 Parcel / Takeaway</Text>
                  <View style={styles.modalOptionBadgeOrange}>
                    <Text style={styles.modalOptionBadgeOrangeText}>Sign In Required</Text>
                  </View>
                </View>
                <Text style={styles.modalOptionDesc}>
                  Delivery or takeaway. Requires contact number and delivery address.
                </Text>
              </View>
              <Icon name="chevron-right" size={14} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.orderTypeModalCancelBtn}
              onPress={() => setShowOrderTypeModal(false)}
            >
              <Text style={styles.orderTypeModalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* EMAIL OTP VERIFICATION MODAL */}
      <Modal
        visible={showOtpModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowOtpModal(false)}
      >
        <View style={styles.otpModalOverlay}>
          <View style={styles.otpModalCard}>
            <View style={styles.otpModalHeader}>
              <View style={styles.otpIconWrap}>
                <Icon name="envelope-o" size={24} color="#007AFF" />
              </View>
              <Text style={styles.otpModalTitle}>Verify Contact Details</Text>
              <Text style={styles.otpModalSub}>
                We sent a 6-digit verification code to:
              </Text>
              <Text style={styles.otpModalEmail}>{currentUser?.email}</Text>
            </View>

            <TextInput
              style={styles.otpInput}
              placeholder="Enter 6-digit code"
              placeholderTextColor="#94A3B8"
              value={otpCode}
              onChangeText={setOtpCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus={true}
            />

            <View style={styles.otpModalActions}>
              <TouchableOpacity
                style={styles.otpCancelBtn}
                onPress={() => setShowOtpModal(false)}
                disabled={verifyingEmailOtp}
              >
                <Text style={styles.otpCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.otpVerifyBtn}
                onPress={handleVerifyEmailOtp}
                disabled={verifyingEmailOtp}
              >
                {verifyingEmailOtp ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.otpVerifyBtnText}>Verify & Continue</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.otpResendBtn}
              onPress={() => handleSendEmailOtp()}
              disabled={sendingEmailOtp}
            >
              <Text style={styles.otpResendText}>
                {sendingEmailOtp ? 'Resending...' : "Didn't receive code? Resend"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ADD / SELECT ADDRESS WITH MAP MODAL */}
      <Modal
        visible={showAddressModal}
        animationType="slide"
        onRequestClose={() => setShowAddressModal(false)}
      >
        <SafeAreaView style={styles.mapModalSafeArea}>
          <View style={styles.mapModalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mapModalTitle}>📍 Delivery Address & Map</Text>
              <Text style={styles.mapModalSubtitle}>
                Pinpoint your delivery location or search your area
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowAddressModal(false)}
              style={styles.mapModalCloseBtn}
            >
              <Icon name="times" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Search Area Input */}
          <View style={styles.mapSearchContainer}>
            <View style={styles.mapSearchInputWrap}>
              <Icon name="search" size={14} color="#007AFF" style={{ marginRight: 8 }} />
              <TextInput
                value={mapSearchQuery}
                onChangeText={handleMapSearchChange}
                placeholder="Search area, landmark or street..."
                placeholderTextColor="#94A3B8"
                style={styles.mapSearchInput}
                returnKeyType="search"
              />
              {mapSearchLoading && <ActivityIndicator size="small" color="#007AFF" />}
            </View>
            {mapSearchSuggestions && mapSearchSuggestions.length > 0 && (
              <View style={styles.mapSuggestionsDropdown}>
                {mapSearchSuggestions.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.suggestionRow}
                    onPress={() => handleSelectAreaSuggestion(item)}
                  >
                    <Icon name="map-marker" size={13} color="#007AFF" style={{ marginRight: 8, marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.suggestionSub} numberOfLines={1}>{item.subtitle}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Interactive Leaflet Map Box */}
          <View style={styles.mapViewportBox}>
            <LeafletMap
              ref={addressMapRef}
              initialRegion={mapInitialRegion}
              markerCoordinate={modalCoords || mapInitialRegion}
              onMarkerDragEnd={(coords) => {
                setModalCoords(coords);
                reverseGeocodeAddress(coords.latitude, coords.longitude);
              }}
              onMapPress={(coords) => {
                setModalCoords(coords);
                reverseGeocodeAddress(coords.latitude, coords.longitude);
              }}
            />
            {/* GPS Floating Button */}
            <TouchableOpacity
              style={styles.mapGpsFloatingBtn}
              onPress={handleUseCurrentLocation}
              disabled={locatingGps}
              activeOpacity={0.8}
            >
              {locatingGps ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : (
                <Icon name="crosshairs" size={20} color="#007AFF" />
              )}
            </TouchableOpacity>
          </View>

          {/* Address Form Scroll */}
          <ScrollView style={styles.modalFormScroll} contentContainerStyle={{ padding: 16 }}>
            {/* Tag Selection: Home, Work, Other */}
            <Text style={styles.formFieldLabel}>Address Tag</Text>
            <View style={styles.tagSelectorRow}>
              {['Home', 'Work', 'Other'].map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagOptionBtn, modalTag === tag && styles.tagOptionBtnSelected]}
                  onPress={() => setModalTag(tag)}
                >
                  <Icon
                    name={tag === 'Work' ? 'briefcase' : tag === 'Other' ? 'map-pin' : 'home'}
                    size={13}
                    color={modalTag === tag ? '#FFFFFF' : '#475569'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.tagOptionText, modalTag === tag && styles.tagOptionTextSelected]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formFieldLabel}>Recipient Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. John Doe"
              placeholderTextColor="#94a3b8"
              value={modalRecipientName}
              onChangeText={setModalRecipientName}
            />

            <Text style={styles.formFieldLabel}>Mobile Number (10 digits) *</Text>
            <TextInput
              style={styles.input}
              placeholder="10-digit mobile number"
              placeholderTextColor="#94a3b8"
              value={modalMobile}
              onChangeText={(text) => setModalMobile(text.replace(/[^0-9]/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              maxLength={10}
            />

            <Text style={styles.formFieldLabel}>House / Flat / Street / Landmark *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Flat 302, Green Valley Apartments"
              placeholderTextColor="#94a3b8"
              value={modalAddressLine1}
              onChangeText={setModalAddressLine1}
            />

            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.formFieldLabel}>City *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="City"
                  placeholderTextColor="#94a3b8"
                  value={modalCity}
                  onChangeText={setModalCity}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.formFieldLabel}>Postal Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Postal Code"
                  placeholderTextColor="#94a3b8"
                  value={modalZipCode}
                  onChangeText={setModalZipCode}
                  keyboardType="numeric"
                />
              </View>
            </View>

            {modalCoords && (
              <View style={styles.coordsIndicatorRow}>
                <Icon name="check-circle" size={13} color="#10B981" style={{ marginRight: 6 }} />
                <Text style={styles.coordsIndicatorText}>
                  GPS Pinned: {modalCoords.latitude.toFixed(5)}, {modalCoords.longitude.toFixed(5)}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.saveAddressModalBtn, savingAddress && { opacity: 0.7 }]}
              onPress={handleSaveModalAddress}
              disabled={savingAddress}
              activeOpacity={0.85}
            >
              {savingAddress ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveAddressModalBtnText}>Save Delivery Address</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* FAST POS CONFIRMATION MODAL (Prompt before paid order) */}
      <Modal
        visible={showPosConfirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isProcessingPos) setShowPosConfirmModal(false);
        }}
      >
        <View style={styles.posModalOverlay}>
          <View style={styles.posModalCard}>
            {/* Header */}
            <View
              style={[
                styles.posModalHeader,
                posPaymentMethod === 'cash' ? styles.posModalHeaderCash : styles.posModalHeaderUpi,
              ]}
            >
              <View style={styles.posModalHeaderIcon}>
                <Icon
                  name={posPaymentMethod === 'cash' ? 'money' : 'qrcode'}
                  size={24}
                  color="#FFFFFF"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.posModalHeaderTitle}>
                  {posPaymentMethod === 'cash' ? 'Confirm Paid by Cash' : 'Confirm Paid by UPI'}
                </Text>
                <Text style={styles.posModalHeaderSub}>
                  {posPaymentMethod === 'cash'
                    ? 'Customer paid cash at the counter'
                    : 'Customer paid via UPI QR / App'}
                </Text>
              </View>
            </View>

            <ScrollView style={styles.posModalBody} keyboardShouldPersistTaps="handled">
              {/* Total Amount Box */}
              <View style={styles.posModalAmountBox}>
                <Text style={styles.posModalAmountLabel}>Bill Total Amount</Text>
                <Text style={styles.posModalAmountValue}>₹{totalAmount.toFixed(2)}</Text>
                <Text style={styles.posModalItemsCount}>
                  {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in bill
                </Text>
              </View>

              {/* Table / Counter selector */}
              <Text style={styles.posModalInputLabel}>Counter / Table:</Text>
              <View style={styles.posModalPickerWrap}>
                <Picker
                  selectedValue={posTableNo}
                  onValueChange={(val) => setPosTableNo(val)}
                  style={styles.picker}
                >
                  {tableOptions.map((opt) => (
                    <Picker.Item
                      key={opt}
                      label={opt === 'Main counter' ? 'Main Counter (Self Pick-up)' : `Table #${opt}`}
                      value={opt}
                    />
                  ))}
                </Picker>
              </View>

              {/* Customer Name (Optional) */}
              <Text style={styles.posModalInputLabel}>Customer Name (Optional):</Text>
              <TextInput
                style={styles.posModalInput}
                placeholder="Walk-in Customer"
                placeholderTextColor="#94A3B8"
                value={posCustomerName}
                onChangeText={setPosCustomerName}
              />

              {/* Customer Mobile (Optional) */}
              <Text style={styles.posModalInputLabel}>Customer Mobile (Optional):</Text>
              <TextInput
                style={styles.posModalInput}
                placeholder="10-digit mobile number"
                placeholderTextColor="#94A3B8"
                value={posCustomerMobile}
                onChangeText={(t) => setPosCustomerMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
                keyboardType="phone-pad"
                maxLength={10}
              />

              {/* Print Receipt Toggle */}
              <TouchableOpacity
                style={styles.posPrintToggleRow}
                onPress={() => setPosPrintReceipt(!posPrintReceipt)}
                activeOpacity={0.8}
              >
                <Icon
                  name={posPrintReceipt ? 'check-square' : 'square-o'}
                  size={18}
                  color={posPrintReceipt ? '#007AFF' : '#64748B'}
                  style={{ marginRight: 8 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.posPrintToggleLabel}>Print Bill Receipt</Text>
                  <Text style={styles.posPrintToggleSub}>
                    Automatically send receipt to thermal printer
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Info Notice */}
              <View style={styles.posModalNotice}>
                <Icon name="check-circle" size={13} color="#10B981" style={{ marginRight: 6 }} />
                <Text style={styles.posModalNoticeText}>
                  Order will be marked as PAID. After completing, Catalog will automatically reload for the next customer.
                </Text>
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={styles.posModalActions}>
              <TouchableOpacity
                style={styles.posModalCancelBtn}
                onPress={() => setShowPosConfirmModal(false)}
                disabled={isProcessingPos}
              >
                <Text style={styles.posModalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.posModalConfirmBtn,
                  posPaymentMethod === 'cash'
                    ? styles.posModalConfirmBtnCash
                    : styles.posModalConfirmBtnUpi,
                  isProcessingPos && styles.posButtonDisabled,
                ]}
                onPress={() => {
                  handleFastPosOrder(posPaymentMethod, {
                    printReceipt: posPrintReceipt,
                    customerName: posCustomerName,
                    customerMobile: posCustomerMobile,
                    tableNo: posTableNo,
                  });
                }}
                disabled={isProcessingPos}
                activeOpacity={0.85}
              >
                {isProcessingPos ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="check" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.posModalConfirmBtnText}>
                      Confirm &amp; Complete (₹{totalAmount.toFixed(2)})
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* FAST POS SUCCESS MODAL (Fast Catalog Reload for Next Customer) */}
      <Modal
        visible={showPosSuccessModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => navigateToCatalog(posSuccessData?.order)}
      >
        <View style={styles.posSuccessOverlay}>
          <View style={styles.posSuccessCard}>
            <View style={styles.posSuccessIconCircle}>
              <Icon name="check" size={32} color="#FFFFFF" />
            </View>

            <Text style={styles.posSuccessTitle}>Bill Paid &amp; Completed!</Text>
            <Text style={styles.posSuccessSubtitle}>
              Order #{posSuccessData?.order ? extractOrderNumbers(posSuccessData.order).orderNumber : ''} confirmed.
            </Text>

            <View style={styles.posSuccessDetailsBox}>
              <View style={styles.posSuccessRow}>
                <Text style={styles.posSuccessRowLabel}>Amount Paid:</Text>
                <Text style={styles.posSuccessRowVal}>₹{posSuccessData?.amount ? posSuccessData.amount.toFixed(2) : totalAmount.toFixed(2)}</Text>
              </View>
              <View style={styles.posSuccessRow}>
                <Text style={styles.posSuccessRowLabel}>Payment Mode:</Text>
                <Text style={styles.posSuccessRowVal}>
                  {posSuccessData?.method === 'Cash' ? '💵 Cash' : '⚡ UPI'} (PAID)
                </Text>
              </View>
              <View style={styles.posSuccessRow}>
                <Text style={styles.posSuccessRowLabel}>Receipt:</Text>
                <Text style={styles.posSuccessRowVal}>
                  {posPrintReceipt ? '🖨️ Sent to Printer' : 'Not Printed'}
                </Text>
              </View>
            </View>

            <View style={styles.posCountdownBanner}>
              <Icon name="clock-o" size={13} color="#007AFF" style={{ marginRight: 5 }} />
              <Text style={styles.posCountdownText}>
                Loading catalog for next customer in {successCountdown}s...
              </Text>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              style={styles.posNextCustomerBtn}
              onPress={() => navigateToCatalog(posSuccessData?.order)}
              activeOpacity={0.85}
            >
              <Icon name="shopping-bag" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.posNextCustomerBtnText}>Next Customer (Catalog)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.posViewOrderBtn}
              onPress={() => {
                setShowPosSuccessModal(false);
                if (posSuccessData?.order) {
                  navigation.navigate('OrderConfirmation', {
                    order: posSuccessData.order,
                    paymentReference: uniquePaymentCode,
                    sellerId: resolvedSellerId,
                    sellerName: resolvedSellerName,
                    customerId: resolvedCustomerId,
                  });
                }
              }}
              activeOpacity={0.8}
            >
              <Icon name="file-text-o" size={13} color="#007AFF" style={{ marginRight: 6 }} />
              <Text style={styles.posViewOrderBtnText}>View Receipt / Order Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-Screen QR & Item Media Viewer */}
      <FullScreenImageViewer
        visible={isQrViewerVisible}
        mediaList={qrViewerMedia}
        initialIndex={qrViewerIndex}
        onClose={() => setIsQrViewerVisible(false)}
        title="UPI Payment QR Code"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    height: Platform.OS === 'web' ? '100%' : undefined,
    maxHeight: Platform.OS === 'web' ? '100vh' : undefined,
    minHeight: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexShrink: 0,
  },
  backHeaderBtn: {
    padding: 8,
    marginRight: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  scrollView: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 150,
  },
  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  guestBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 3,
  },
  guestBannerSubtitle: {
    fontSize: 12,
    color: '#3B82F6',
    lineHeight: 16,
  },
  guestSignInButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  guestSignInButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryItems: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 4,
  },
  summaryTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 10,
    marginTop: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
    color: '#1E293B',
  },
  pickerContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginBottom: 14,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    width: '100%',
  },
  paymentMethodContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  paymentButton: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  selectedPaymentButton: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  paymentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  selectedPaymentButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* UPI Card Styles */
  upiCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  upiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  upiHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  upiIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  upiCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  upiCardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  upiVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  upiVerifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  upiAmountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  upiAmountLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  upiAmountSub: {
    fontSize: 11,
    color: '#0284C7',
    marginTop: 1,
  },
  upiAmountValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0284C7',
  },
  paymentRefPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  paymentRefLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paymentRefValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  paymentRefCodeBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  paymentRefCodeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  qrTabContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  qrTabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  qrTabButtonActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#007AFF',
  },
  qrTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  qrTabTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  qrBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 12,
  },
  qrImageTouchable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 220,
    height: 220,
    borderRadius: 8,
  },
  qrLoadingBox: {
    height: 220,
    width: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrLoadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
  },
  qrAmountOverlay: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  qrAmountOverlayText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  downloadQrHighlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669', // Vivid emerald green highlight
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#047857',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  downloadIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  downloadQrTextContainer: {
    flex: 1,
  },
  downloadQrBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  downloadQrBtnSubText: {
    fontSize: 11,
    color: '#D1FAE5',
    marginTop: 2,
    fontWeight: '500',
  },
  qrScanInstruction: {
    fontSize: 12,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  upiAppsSection: {
    marginBottom: 14,
  },
  upiAppsSectionHeader: {
    marginBottom: 8,
  },
  upiAppsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  upiAppsSectionSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  upiAppsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  upiAppCard: {
    flex: 1,
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    gap: 8,
  },
  upiAppIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  upiAppTextCol: {
    flex: 1,
  },
  upiAppName: {
    fontSize: 12,
    fontWeight: '700',
  },
  upiAppActionText: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
    fontWeight: '500',
  },
  directUpiPayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: 14,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  directUpiPayButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  upiSecurityTipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  upiSecurityTipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
    marginBottom: 2,
  },
  upiSecurityTipText: {
    fontSize: 11,
    color: '#115E59',
    lineHeight: 16,
  },
  upiIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  upiIdLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
  },
  upiIdText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  copyUpiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 10,
  },
  copyUpiBtnCopied: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  copyUpiBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  orderTypeCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  orderTypeSegmentedRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  orderTypeSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  orderTypeSegmentBtnActive: {
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  orderTypeSegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  orderTypeSegmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dineInDetailsBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  dineInHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dineInNoticeText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
  },
  parcelNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  parcelNoticeText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
  },
  noUpiBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  noUpiBannerText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    flex: 1,
  },
  orderTypeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  orderTypeModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  orderTypeModalHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  orderTypeModalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  orderTypeModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  orderTypeModalSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  modalOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  modalOptionCardActive: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F7FF',
  },
  modalOptionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modalOptionIconCircleOrange: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modalOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 8,
  },
  modalOptionDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  modalOptionBadgeGreen: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  modalOptionBadgeGreenText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  modalOptionBadgeOrange: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  modalOptionBadgeOrangeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
  },
  orderTypeModalCancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  orderTypeModalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },

  /* Docked Action Footer Bar */
  dockedFooterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 6,
    flexShrink: 0,
  },
  footerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  footerBackBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  footerTotalBox: {
    alignItems: 'center',
  },
  footerTotalLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  footerTotalAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  footerPlaceOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  placeOrderButtonDisabled: {
    opacity: 0.7,
  },
  footerPlaceOrderBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  /* Empty Cart */
  emptyCartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyCartTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
  },
  emptyCartSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  browseButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },

  /* Multiple Addresses & Map Selection */
  addressSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 18,
  },
  sectionSubheading: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  addAddressHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  addAddressHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  savedAddressesScroll: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  addressCard: {
    width: 230,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  addressCardSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F9FF',
  },
  addressCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addressTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagHome: {
    backgroundColor: '#E0F2FE',
  },
  tagWork: {
    backgroundColor: '#FEF3C7',
  },
  tagOther: {
    backgroundColor: '#F1F5F9',
  },
  addressTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  addressCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  addressCardMobile: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  addressCardDetails: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  addressGpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  addressGpsText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#10B981',
  },
  emptyAddressBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  emptyAddressIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAddressTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
  },
  emptyAddressSubtitle: {
    fontSize: 12,
    color: '#3B82F6',
    marginTop: 2,
    lineHeight: 16,
  },
  addressFormBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  formFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 5,
    marginTop: 4,
  },
  mobileInputHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 5,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  verifyOtpLinkBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  verifyOtpLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  mobileInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryCodePrefix: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    marginBottom: 12,
  },
  mobileInputInner: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  addressCityRow: {
    flexDirection: 'row',
  },
  activeCoordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  activeCoordsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },

  /* Email OTP Modal */
  otpModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  otpModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  otpModalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  otpIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  otpModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  otpModalSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  otpModalEmail: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
    marginTop: 2,
  },
  otpInput: {
    borderWidth: 1.5,
    borderColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 8,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginBottom: 16,
  },
  otpModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  otpCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    marginRight: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  otpCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  otpVerifyBtn: {
    flex: 1,
    paddingVertical: 11,
    marginLeft: 6,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  otpVerifyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  otpResendBtn: {
    marginTop: 14,
    alignItems: 'center',
  },
  otpResendText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
  },

  /* Address Map Modal */
  mapModalSafeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mapModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  mapModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  mapModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  mapModalCloseBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  mapSearchContainer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 99,
  },
  mapSearchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  mapSearchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
  },
  mapSuggestionsDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
    maxHeight: 160,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  suggestionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  suggestionSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  mapViewportBox: {
    height: 220,
    width: '100%',
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  mapGpsFloatingBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: '#FFFFFF',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
  },
  modalFormScroll: {
    flex: 1,
  },
  tagSelectorRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  tagOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  tagOptionBtnSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  tagOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  tagOptionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  coordsIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 8,
    borderRadius: 6,
    marginBottom: 14,
  },
  coordsIndicatorText: {
    fontSize: 11,
    color: '#065F46',
    fontWeight: '600',
  },
  saveAddressModalBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  saveAddressModalBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // ==========================================
  // Fast POS Counter Billing Styles
  // ==========================================
  posBillingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#0D9488',
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  posCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 6,
  },
  posHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  posBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D9488',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  posBadgePillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  posCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  posRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  posRoleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
  },
  posSubtitle: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
    marginBottom: 12,
  },
  posQrWrapper: {
    alignItems: 'center',
    marginBottom: 14,
  },
  posQrCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    alignItems: 'center',
  },
  posQrHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
  },
  posQrHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
  },
  posQrAmountBadge: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  posQrAmountBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  posQrImageBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 8,
  },
  posQrImage: {
    width: 170,
    height: 170,
  },
  posQrEnlargeOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F0F9FF',
    borderRadius: 6,
  },
  posQrEnlargeText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#007AFF',
  },
  posUpiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 4,
    maxWidth: '100%',
  },
  posUpiLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginRight: 4,
  },
  posUpiValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  posCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  posCopyBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#007AFF',
    marginLeft: 3,
  },
  posAcceptedAppsText: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 6,
  },
  posNoUpiBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  posNoUpiText: {
    fontSize: 12,
    color: '#B45309',
    flex: 1,
  },
  posActionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  posCashButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  posUpiButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  posCashIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  posUpiIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  posButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  posButtonAmount: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    fontWeight: '600',
  },
  posButtonDisabled: {
    opacity: 0.5,
  },
  posFooterHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  posFooterHintText: {
    fontSize: 10.5,
    color: '#64748B',
    flex: 1,
  },

  // POS Confirm Modal
  posModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  posModalCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  posModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  posModalHeaderCash: {
    backgroundColor: '#059669',
  },
  posModalHeaderUpi: {
    backgroundColor: '#0284C7',
  },
  posModalHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  posModalHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  posModalHeaderSub: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 1,
  },
  posModalBody: {
    padding: 16,
  },
  posModalAmountBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  posModalAmountLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  posModalAmountValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginVertical: 2,
  },
  posModalItemsCount: {
    fontSize: 11,
    color: '#64748B',
  },
  posModalInputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 5,
    marginTop: 8,
  },
  posModalPickerWrap: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  posModalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  posPrintToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
  posPrintToggleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  posPrintToggleSub: {
    fontSize: 10.5,
    color: '#0284C7',
    marginTop: 1,
  },
  posModalNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 8,
    borderRadius: 6,
    marginTop: 12,
    marginBottom: 4,
  },
  posModalNoticeText: {
    fontSize: 11,
    color: '#065F46',
    flex: 1,
    lineHeight: 15,
  },
  posModalActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 12,
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  posModalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  posModalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  posModalConfirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  posModalConfirmBtnCash: {
    backgroundColor: '#059669',
  },
  posModalConfirmBtnUpi: {
    backgroundColor: '#0284C7',
  },
  posModalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // POS Success Modal
  posSuccessOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  posSuccessCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  posSuccessIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  posSuccessTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  posSuccessSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 14,
  },
  posSuccessDetailsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 12,
  },
  posSuccessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  posSuccessRowLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  posSuccessRowVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  posCountdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 14,
  },
  posCountdownText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  posNextCustomerBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D9488',
    paddingVertical: 13,
    borderRadius: 10,
    marginBottom: 8,
  },
  posNextCustomerBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  posViewOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  posViewOrderBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
});

export default CheckoutScreen;