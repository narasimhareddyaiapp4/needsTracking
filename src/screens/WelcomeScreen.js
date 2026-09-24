import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Image,
  Dimensions,
  Platform,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useCart } from '../context/CartContext';
import { supabase, extractStoreSettings } from '../services/supabase';
import { showAlert } from '../utils/alertUtils';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import StoreQrModal from '../components/StoreQrModal';
import WelcomeQrModal from '../components/WelcomeQrModal';
import BusinessDigitalizeCard from '../components/BusinessDigitalizeCard';
import { getPreferredStore, setPreferredStore, clearPreferredStore } from '../services/localStorageService';

const { width } = Dimensions.get('window');

// Default fallback coordinate (Hyderabad / Central region)
const DEFAULT_LAT = 17.4065;
const DEFAULT_LON = 78.3998;

function calculateDistance(lat1, lon1, lat2, lon2) {
  try {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371; // Earth radius in km
    const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
    const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((Number(lat1) * Math.PI) / 180) *
        Math.cos((Number(lat2) * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
  } catch (e) {
    return null;
  }
}

function getRawDistanceKm(lat1, lon1, lat2, lon2) {
  try {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 999999;
    const R = 6371;
    const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
    const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((Number(lat1) * Math.PI) / 180) *
        Math.cos((Number(lat2) * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  } catch (e) {
    return 999999;
  }
}

export default function WelcomeScreen() {
  const navigation = useNavigation();
  const { user, role } = useCart();

  // Sellers, loading and location state
  const [sellers, setSellers] = useState([]);
  const [loadingSellers, setLoadingSellers] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fullscreen media viewer modal state with scrolling option
  const [viewerModalVisible, setViewerModalVisible] = useState(false);
  const [viewerMediaList, setViewerMediaList] = useState([]);
  const [viewerActiveIndex, setViewerActiveIndex] = useState(0);
  const [viewerStoreName, setViewerStoreName] = useState('');

  // Store QR Code Modal and Preferred Store state
  const [storeQrModalVisible, setStoreQrModalVisible] = useState(false);
  const [welcomeQrModalVisible, setWelcomeQrModalVisible] = useState(false);
  const [qrModalSeller, setQrModalSeller] = useState(null);
  const [preferredStore, setPreferredStoreState] = useState(null);

  // Sync preferred store on screen focus
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      (async () => {
        try {
          const stored = await getPreferredStore();
          if (isMounted) {
            setPreferredStoreState(stored);
          }
        } catch (err) {
          console.warn('[WelcomeScreen] Error loading preferred store:', err);
        }
      })();
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const handleOpenStoreQr = useCallback((seller) => {
    setQrModalSeller(seller);
    setStoreQrModalVisible(true);
  }, []);

  const handleBrowseStoreFromQr = useCallback((seller) => {
    setPreferredStore(seller.id, seller.full_name);
    setPreferredStoreState({ sellerId: seller.id, sellerName: seller.full_name });
    navigation.navigate('Catalog', {
      sellerId: seller.id,
      sellerName: seller.full_name,
    });
  }, [navigation]);

  const handleOpenMediaViewer = useCallback((seller, initialIndex = 0) => {
    // Compile media from all sellers so user can continuously scroll left or right across all stores!
    const allSellersMedia = [];
    let targetIdx = 0;
    (sellers || []).forEach((s) => {
      const sMedia = (s?.mediaList || []).filter((m) => m && m.uri);
      if (sMedia.length > 0) {
        sMedia.forEach((m, mIdx) => {
          if (String(s.id) === String(seller?.id) && mIdx === initialIndex) {
            targetIdx = allSellersMedia.length;
          }
          allSellersMedia.push({
            id: `sel-${s.id}-m-${mIdx}`,
            uri: m.uri,
            type: m.type || 'image',
            title: sMedia.length > 1 ? `${s.full_name} (${mIdx + 1}/${sMedia.length})` : s.full_name,
            subtitle: s.city || s.address || null,
          });
        });
      } else {
        const photo = s.firstPhoto || s.avatar_url;
        if (photo) {
          if (String(s.id) === String(seller?.id)) {
            targetIdx = allSellersMedia.length;
          }
          allSellersMedia.push({
            id: `sel-${s.id}-photo`,
            uri: photo,
            type: 'image',
            title: s.full_name,
            subtitle: s.city || s.address || null,
          });
        }
      }
    });

    if (allSellersMedia.length === 0 && seller) {
      const items = (seller?.mediaList || []).filter((m) => m && m.uri);
      if (items.length > 0) {
        items.forEach((m, idx) => {
          allSellersMedia.push({
            id: `sel-single-${idx}`,
            uri: m.uri,
            type: m.type || 'image',
            title: items.length > 1 ? `${seller.full_name} (${idx + 1}/${items.length})` : seller.full_name,
            subtitle: seller.city || seller.address || null,
          });
        });
        targetIdx = Math.min(Math.max(0, initialIndex), items.length - 1);
      } else {
        const fallbackUri = seller?.firstPhoto || seller?.avatar_url;
        if (fallbackUri) {
          allSellersMedia.push({
            id: `sel-fallback`,
            uri: fallbackUri,
            type: 'image',
            title: seller.full_name,
            subtitle: seller.city || seller.address || null,
          });
          targetIdx = 0;
        }
      }
    }

    if (allSellersMedia.length > 0) {
      setViewerMediaList(allSellersMedia);
      setViewerActiveIndex(targetIdx);
      setViewerStoreName(seller?.full_name || 'Stores & Media');
      setViewerModalVisible(true);
    }
  }, [sellers]);

  const handleCloseMediaViewer = useCallback(() => {
    setViewerModalVisible(false);
    setViewerMediaList([]);
    setViewerActiveIndex(0);
  }, []);

  const handleNextMedia = useCallback(() => {
    setViewerActiveIndex((prev) => (prev + 1) % viewerMediaList.length);
  }, [viewerMediaList.length]);

  const handlePrevMedia = useCallback(() => {
    setViewerActiveIndex((prev) => (prev - 1 + viewerMediaList.length) % viewerMediaList.length);
  }, [viewerMediaList.length]);

  // Role-based automatic redirection if logged in as delivery manager or seller
  useEffect(() => {
    try {
      if (user) {
        if (role === 'delivery_manager') {
          navigation.replace('DeliveryManagerDashboard');
        } else if (role === 'seller' || role === 'admin') {
          navigation.replace('ProductTabs');
        }
      }
    } catch (e) {
      console.warn('Role redirection notice:', e.message);
    }
  }, [user, role, navigation]);

  // Request location permission non-blockingly
  useEffect(() => {
    async function requestLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              timeout: 4000,
            });
            if (loc?.coords) {
              setUserLocation(loc.coords);
            }
          } catch (_) {
            const lastKnown = await Location.getLastKnownPositionAsync({});
            if (lastKnown?.coords) {
              setUserLocation(lastKnown.coords);
            }
          }
        }
      } catch (err) {
        console.warn('Location lookup in WelcomeScreen:', err.message);
      }
    }
    requestLocation();
  }, []);

  // Fetch sellers data (profiles with role seller/admin or products, plus customer stores)
  const fetchSellers = useCallback(async () => {
    try {
      setLoadingSellers(true);

      // 1. Fetch profiles
      const { data: profilesData, error: profErr } = await supabase
        .from('profiles')
        .select(
          'id, full_name, email, mobile, role, address_line_1, address_line_2, city, state, zip_code, latitude, longitude, avatar_url, media_urls'
        );

      if (profErr) {
        console.warn('WelcomeScreen profiles error:', profErr.message);
      }

      // 2. Fetch products to get product counts & media
      let productsCountMap = {};
      let sellersWithProductsSet = new Set();
      let sellerProductMediaMap = {};

      try {
        const { data: prodData } = await supabase
          .from('products')
          .select('id, user_id, customer_id, product_name, is_active, product_media ( id, media_url, media_type )');

        if (prodData && Array.isArray(prodData)) {
          prodData.forEach((p) => {
            const uId = p?.user_id || p?.customer_id;
            if (uId) {
              productsCountMap[uId] = (productsCountMap[uId] || 0) + 1;
              sellersWithProductsSet.add(uId);

              if (p.product_media && Array.isArray(p.product_media)) {
                if (!sellerProductMediaMap[uId]) {
                  sellerProductMediaMap[uId] = [];
                }
                p.product_media.forEach((pm) => {
                  if (pm?.media_url && !sellerProductMediaMap[uId].some((m) => m.uri === pm.media_url)) {
                    sellerProductMediaMap[uId].push({
                      uri: pm.media_url,
                      type: pm.media_type || 'image',
                    });
                  }
                });
              }
            }
          });
        }
      } catch (prodErr) {
        console.warn('WelcomeScreen products error:', prodErr.message);
      }

      // 3. Fetch customer stores
      let customersData = [];
      try {
        const { data: cData } = await supabase
          .from('customers')
          .select('id, name, mobile, email, address, latitude, longitude');
        if (cData && Array.isArray(cData)) {
          customersData = cData;
        }
      } catch (custErr) {
        console.warn('WelcomeScreen customers error:', custErr.message);
      }

      // 4. Format profiles
      const allProfiles = profilesData || [];
      const formattedProfiles = allProfiles
        .filter((p) => {
          if (!p) return false;
          const r = (p.role || '').toLowerCase();
          const hasProducts = sellersWithProductsSet.has(p.id);
          return (
            r === 'seller' ||
            r === 'admin' ||
            r === 'superadmin' ||
            r === 'appadmin' ||
            r === 'app_admin' ||
            r === 'merchant' ||
            hasProducts ||
            (p.latitude && p.longitude)
          );
        })
        .map((p, index) => {
          const hasCoords = p.latitude != null && p.longitude != null && !isNaN(Number(p.latitude));
          const fallbackLat = DEFAULT_LAT + ((index % 5) - 2) * 0.012;
          const fallbackLon = DEFAULT_LON + (((index + 1) % 5) - 2) * 0.012;

          let mediaList = [];
          if (p.media_urls) {
            try {
              mediaList = typeof p.media_urls === 'string' ? JSON.parse(p.media_urls) : p.media_urls;
            } catch (_) {
              mediaList = [];
            }
          }
          if (!Array.isArray(mediaList)) mediaList = [];

          // Clean mediaList: filter out store_settings and items without valid URI string (fixes photo2 null bug)
          mediaList = mediaList.filter(
            (m) => m && m.type !== 'store_settings' && m.uri && typeof m.uri === 'string' && m.uri.trim().length > 0
          );
          mediaList = mediaList.map((m) => ({
            ...m,
            uri: m.uri.trim(),
            type: m.type === 'video' ? 'video' : 'image',
          }));

          // Add avatar_url if valid and not already in mediaList
          if (
            p.avatar_url &&
            typeof p.avatar_url === 'string' &&
            p.avatar_url.trim().length > 0 &&
            !mediaList.some((m) => m.uri === p.avatar_url.trim())
          ) {
            mediaList.unshift({ uri: p.avatar_url.trim(), type: 'image', isProfile: true });
          }

          // Add product media if valid and not already in mediaList
          const prodMedia = sellerProductMediaMap[p.id] || [];
          prodMedia.forEach((pm) => {
            if (
              pm &&
              pm.uri &&
              typeof pm.uri === 'string' &&
              pm.uri.trim().length > 0 &&
              !mediaList.some((m) => m.uri === pm.uri.trim())
            ) {
              mediaList.push({
                uri: pm.uri.trim(),
                type: pm.type === 'video' ? 'video' : 'image',
              });
            }
          });

          const firstPhoto =
            mediaList.find((m) => m.type === 'image')?.uri ||
            (typeof p.avatar_url === 'string' && p.avatar_url.trim().length > 0 ? p.avatar_url.trim() : null) ||
            prodMedia.find((m) => m.type === 'image')?.uri ||
            null;

          const storeSettings = extractStoreSettings(p.media_urls);
          const isStoreActive = storeSettings.is_store_active !== false;

          const sellerLat = hasCoords ? Number(p.latitude) : fallbackLat;
          const sellerLon = hasCoords ? Number(p.longitude) : fallbackLon;

          return {
            id: p.id,
            full_name: p.full_name || p.email?.split('@')[0] || 'Local Store',
            email: p.email || '',
            mobile: p.mobile || '',
            role: p.role || 'seller',
            city: p.city || '',
            address:
              [p.address_line_1, p.address_line_2, p.city, p.state].filter(Boolean).join(', ') ||
              (p.city ? `${p.city}` : 'Store Location'),
            latitude: sellerLat,
            longitude: sellerLon,
            hasExactCoordinates: hasCoords,
            productCount: productsCountMap[p.id] || 0,
            avatar_url: p.avatar_url,
            firstPhoto: firstPhoto,
            mediaList: mediaList,
            is_store_active: isStoreActive,
            isProfile: true,
          };
        });

      // 5. Format customers as additional store locations
      const existingIds = new Set(formattedProfiles.map((p) => String(p.id)));
      const formattedCustomers = (customersData || [])
        .filter((c) => c && !existingIds.has(String(c.id)))
        .map((c, index) => {
          const hasCoords = c.latitude != null && c.longitude != null && !isNaN(Number(c.latitude));
          const fallbackLat = DEFAULT_LAT + (((index + 2) % 5) - 2) * 0.015;
          const fallbackLon = DEFAULT_LON + (((index + 3) % 5) - 2) * 0.015;
          const custProdMedia = (sellerProductMediaMap[c.id] || []).filter(
            (m) => m && m.uri && typeof m.uri === 'string' && m.uri.trim().length > 0 && m.type !== 'store_settings'
          );
          const custFirstPhoto = custProdMedia.find((m) => m.type === 'image')?.uri || null;

          return {
            id: String(c.id),
            full_name: c.name || 'Store Location',
            email: c.email || '',
            mobile: c.mobile || '',
            role: 'store',
            city: '',
            address: c.address || 'Store Location',
            latitude: hasCoords ? Number(c.latitude) : fallbackLat,
            longitude: hasCoords ? Number(c.longitude) : fallbackLon,
            hasExactCoordinates: hasCoords,
            productCount: productsCountMap[c.id] || 0,
            avatar_url: null,
            firstPhoto: custFirstPhoto,
            mediaList: custProdMedia,
            is_store_active: true,
            isProfile: false,
          };
        });

      let combined = [...formattedProfiles, ...formattedCustomers];

      // Fallback demo sellers if completely empty
      if (combined.length === 0) {
        combined = [
          {
            id: 'seller-demo-1',
            full_name: 'Super Mart & Groceries',
            email: 'grocery@example.com',
            mobile: '+91 9876543210',
            role: 'seller',
            city: 'Hyderabad',
            address: 'Hitech City, Hyderabad, Telangana',
            latitude: 17.4435,
            longitude: 78.3772,
            hasExactCoordinates: true,
            productCount: 12,
            avatar_url: null,
            is_store_active: true,
            isProfile: true,
          },
          {
            id: 'seller-demo-2',
            full_name: 'Fresh Foods & Essentials',
            email: 'freshfoods@example.com',
            mobile: '+91 9876543211',
            role: 'seller',
            city: 'Hyderabad',
            address: 'Madhapur, Hyderabad, Telangana',
            latitude: 17.4483,
            longitude: 78.3915,
            hasExactCoordinates: true,
            productCount: 8,
            avatar_url: null,
            is_store_active: true,
            isProfile: true,
          },
        ];
      }

      // Sort: sellers with products first
      combined.sort((a, b) => (b.productCount || 0) - (a.productCount || 0));

      setSellers(combined);
    } catch (err) {
      console.warn('Error fetching sellers in WelcomeScreen:', err);
    } finally {
      setLoadingSellers(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSellers();
  }, [fetchSellers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSellers();
  }, [fetchSellers]);

  // Compute filtered & sorted sellers list
  const filteredSellers = useMemo(() => {
    let list = [...sellers];

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) => {
        const name = (s.full_name || '').toLowerCase();
        const city = (s.city || '').toLowerCase();
        const address = (s.address || '').toLowerCase();
        const email = (s.email || '').toLowerCase();
        const mobile = (s.mobile || '').toLowerCase();
        return name.includes(q) || city.includes(q) || address.includes(q) || email.includes(q) || mobile.includes(q);
      });
    }

    if (userLocation) {
      list.sort((a, b) => {
        return (
          getRawDistanceKm(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) -
          getRawDistanceKm(userLocation.latitude, userLocation.longitude, b.latitude, b.longitude)
        );
      });
    }

    return list;
  }, [sellers, searchQuery, userLocation]);

  const handleLogout = () => {
    showAlert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase.auth.signOut();
            navigation.reset({
              index: 0,
              routes: [{ name: 'Welcome' }],
            });
          } catch (err) {
            console.error('Logout error:', err);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* Upper Brand / Logo Section */}
        <View style={styles.brandContainer}>
          <View style={styles.brandTopRow}>
            <View style={{ width: 68 }} />
            <View style={styles.logoIconBox}>
              <Icon name="map-marker" size={54} color="#007AFF" />
            </View>
            <TouchableOpacity
              style={styles.headerQrBtn}
              onPress={() => setWelcomeQrModalVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Scan App QR Code"
            >
              <Icon name="qrcode" size={16} color="#007AFF" />
              <Text style={styles.headerQrBtnText}>App QR</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.appName}>Needs Tracker</Text>
          <Text style={styles.tagline}>
            Your Hyperlocal Logistics & Marketplace Platform
          </Text>
          <Text style={styles.description}>
            Find verified local stores near you, purchase products with ease, and track your orders or deliveries in real-time.
          </Text>
        </View>

        {/* Action Buttons Section */}
        <View style={styles.actionsContainer}>
          {/* Main call-to-action: Sellers Map */}
          <TouchableOpacity
            style={styles.mainMapButton}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('SellersMap')}
          >
            <View style={styles.mainButtonContent}>
              <Icon name="map" size={20} color="#FFFFFF" style={styles.buttonIcon} />
              <Text style={styles.mainButtonText}>Browse Sellers Map</Text>
            </View>
            <Icon name="chevron-right" size={14} color="#FFFFFF" />
          </TouchableOpacity>

          {/* App / Welcome Page QR Code Banner */}
          <TouchableOpacity
            style={styles.welcomeQrBanner}
            activeOpacity={0.85}
            onPress={() => setWelcomeQrModalVisible(true)}
          >
            <View style={styles.welcomeQrIconBox}>
              <Icon name="qrcode" size={22} color="#007AFF" />
            </View>
            <View style={styles.welcomeQrInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.welcomeQrTitle}>App QR Code • Scan to Open</Text>
                <View style={styles.welcomeQrBadge}>
                  <Text style={styles.welcomeQrBadgeText}>Instant</Text>
                </View>
              </View>
              <Text style={styles.welcomeQrSubtitle}>
                Scan with any phone camera to open or share this page
              </Text>
            </View>
            <Icon name="chevron-right" size={14} color="#94A3B8" />
          </TouchableOpacity>

          {/* Active Store Lock Banner (when user scanned or selected an individual store) */}
          {preferredStore?.sellerId && (
            <View style={styles.activeStoreBanner}>
              <View style={styles.activeStoreIconBox}>
                <Icon name="shopping-bag" size={16} color="#007AFF" />
              </View>
              <View style={styles.activeStoreInfo}>
                <Text style={styles.activeStoreLabel}>Currently Shopping At:</Text>
                <Text style={styles.activeStoreName} numberOfLines={1}>
                  {preferredStore.sellerName || 'Selected Store'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.activeStoreBrowseBtn}
                onPress={() =>
                  navigation.navigate('Catalog', {
                    sellerId: preferredStore.sellerId,
                    sellerName: preferredStore.sellerName,
                  })
                }
                activeOpacity={0.8}
              >
                <Text style={styles.activeStoreBrowseText}>Shop Now</Text>
                <Icon name="chevron-right" size={10} color="#FFFFFF" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.activeStoreQrBtn}
                onPress={() =>
                  handleOpenStoreQr({
                    id: preferredStore.sellerId,
                    full_name: preferredStore.sellerName,
                  })
                }
                activeOpacity={0.8}
              >
                <Icon name="qrcode" size={13} color="#007AFF" style={{ marginRight: 4 }} />
                <Text style={styles.activeStoreQrText}>QR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.activeStoreClearBtn}
                onPress={async () => {
                  await clearPreferredStore();
                  setPreferredStoreState(null);
                }}
                activeOpacity={0.7}
              >
                <Icon name="times" size={14} color="#64748B" />
              </TouchableOpacity>
            </View>
          )}

          {/* Industry & Business Digitalize Setup / Live Demo Contact Section */}
          <BusinessDigitalizeCard />

          {/* Portal Separator */}
          <Text style={styles.sectionHeader}>Portals & Access</Text>

          <View style={styles.portalsGrid}>
            {/* Buyer Portal */}
            <TouchableOpacity
              style={styles.portalCard}
              activeOpacity={0.8}
              onPress={() => {
                if (user && (role === 'buyer' || role === 'customer')) {
                  navigation.navigate('Catalog');
                } else {
                  navigation.navigate('BuyerLogin');
                }
              }}
            >
              <View style={[styles.portalIconBox, { backgroundColor: '#EFF6FF' }]}>
                <Icon name="shopping-cart" size={24} color="#007AFF" />
              </View>
              <Text style={styles.portalTitle}>Buyer</Text>
              <Text style={styles.portalDesc}>Shop Local Stores</Text>
            </TouchableOpacity>

            {/* Seller / Admin Portal */}
            <TouchableOpacity
              style={styles.portalCard}
              activeOpacity={0.8}
              onPress={() => {
                const r = (role || '').toLowerCase();
                if (user && (r === 'seller' || r === 'admin' || r === 'superadmin' || r === 'appadmin' || r === 'app_admin')) {
                  navigation.navigate('ProductTabs');
                } else {
                  navigation.navigate('SellerLogin');
                }
              }}
            >
              <View style={[styles.portalIconBox, { backgroundColor: '#ECFDF5' }]}>
                <Icon name="home" size={22} color="#10B981" />
              </View>
              <Text style={styles.portalTitle}>Seller / Admin</Text>
              <Text style={styles.portalDesc}>Manage Inventory & Stores</Text>
            </TouchableOpacity>

            {/* Delivery Portal */}
            <TouchableOpacity
              style={styles.portalCard}
              activeOpacity={0.8}
              onPress={() => {
                if (user && role === 'delivery_manager') {
                  navigation.navigate('DeliveryManagerDashboard');
                } else {
                  navigation.navigate('DeliveryManagerLogin');
                }
              }}
            >
              <View style={[styles.portalIconBox, { backgroundColor: '#FAF5FF' }]}>
                <Icon name="truck" size={22} color="#8B5CF6" />
              </View>
              <Text style={styles.portalTitle}>Delivery</Text>
              <Text style={styles.portalDesc}>Track & Deliver</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Respective Sellers & Stores Section */}
        <View style={styles.sellersSectionContainer}>
          <View style={styles.sellersHeaderRow}>
            <View style={styles.sellersTitleRow}>
              <View style={styles.sellersIconBadge}>
                <Icon name="shopping-bag" size={15} color="#007AFF" />
              </View>
              <Text style={styles.sellersSectionTitle}>Respective Sellers & Stores</Text>
              <View style={styles.sellersCountPill}>
                <Text style={styles.sellersCountText}>{filteredSellers.length}</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => navigation.navigate('SellersMap')}
              style={styles.viewMapLink}
              activeOpacity={0.7}
            >
              <Text style={styles.viewMapLinkText}>View on Map</Text>
              <Icon name="angle-right" size={14} color="#007AFF" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>

          <Text style={styles.sellersSectionSub}>
            Discover verified local stores, explore products, and place orders directly.
          </Text>

          {/* Quick Search Bar */}
          <View style={styles.searchContainer}>
            <Icon name="search" size={14} color="#94A3B8" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search sellers by store name or city..."
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
                <Icon name="times-circle" size={15} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Loading Indicator */}
          {loadingSellers ? (
            <View style={styles.sellersLoadingBox}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.sellersLoadingText}>Loading respective sellers...</Text>
            </View>
          ) : filteredSellers.length === 0 ? (
            <View style={styles.emptySellersBox}>
              <Icon name="shopping-bag" size={36} color="#CBD5E1" style={{ marginBottom: 8 }} />
              <Text style={styles.emptySellersTitle}>No Sellers Found</Text>
              <Text style={styles.emptySellersSub}>
                {searchQuery.trim().length > 0
                  ? `No stores match "${searchQuery}". Try clearing search.`
                  : 'No verified stores found at the moment.'}
              </Text>
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.resetSearchBtn}>
                  <Text style={styles.resetSearchText}>View All Sellers</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.sellersList}>
              {filteredSellers.map((seller) => {
                const distanceStr = userLocation
                  ? calculateDistance(
                      userLocation.latitude,
                      userLocation.longitude,
                      seller.latitude,
                      seller.longitude
                    )
                  : null;

                return (
                  <View key={`seller-card-${seller.id}`} style={styles.sellerCard}>
                    <View style={styles.sellerCardTop}>
                      {/* Avatar / Store Photo */}
                      {seller.firstPhoto || seller.avatar_url ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => handleOpenMediaViewer(seller, 0)}
                        >
                          <Image
                            source={{ uri: seller.firstPhoto || seller.avatar_url }}
                            style={styles.sellerImage}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.sellerPlaceholderImage}>
                          <Icon name="building-o" size={24} color="#007AFF" />
                        </View>
                      )}

                      {/* Store Details */}
                      <View style={styles.sellerInfoCol}>
                        <View style={styles.sellerNameRow}>
                          <Text style={styles.sellerName} numberOfLines={1}>
                            {seller.full_name}
                          </Text>
                          <View style={styles.verifiedBadge}>
                            <Icon name="check-circle" size={11} color="#059669" style={{ marginRight: 3 }} />
                            <Text style={styles.verifiedBadgeText}>
                              {seller.role === 'admin' ? 'Admin Store' : 'Verified'}
                            </Text>
                          </View>
                          {seller.is_store_active === false && (
                            <View style={[styles.verifiedBadge, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                              <Text style={[styles.verifiedBadgeText, { color: '#DC2626' }]}>Closed</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.sellerAddress} numberOfLines={1}>
                          <Icon name="map-marker" size={11} color="#64748B" />{' '}
                          {seller.city || seller.address || 'Local Marketplace'}
                        </Text>

                        {/* Meta Tags Row */}
                        <View style={styles.sellerBadgesRow}>
                          <View style={styles.productBadge}>
                            <Icon name="cube" size={11} color="#0284C7" style={{ marginRight: 4 }} />
                            <Text style={styles.productBadgeText}>
                              {seller.productCount > 0 ? `${seller.productCount} Products` : 'Catalog Available'}
                            </Text>
                          </View>

                          {distanceStr && (
                            <View style={styles.distanceBadge}>
                              <Icon name="location-arrow" size={10} color="#6B7280" style={{ marginRight: 4 }} />
                              <Text style={styles.distanceBadgeText}>{distanceStr}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Store Option Images Scrolling Strip */}
                    {seller.mediaList && seller.mediaList.filter((m) => m && m.uri).length > 0 && (
                      <View style={styles.dirMediaSection}>
                        <ScrollView
                          horizontal
                          nestedScrollEnabled={true}
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.dirMediaScroll}
                        >
                          {seller.mediaList
                            .filter((m) => m && m.uri)
                            .map((media, mIdx) => (
                              <TouchableOpacity
                                key={`welcome-thumb-${seller.id}-${mIdx}`}
                                style={styles.dirMediaThumbWrap}
                                activeOpacity={0.85}
                                onPress={() => handleOpenMediaViewer(seller, mIdx)}
                              >
                                {media.type === 'video' ? (
                                  <View style={styles.dirVideoThumb}>
                                    <View style={styles.dirVideoPlayBadge}>
                                      <Text style={styles.dirVideoPlayText}>▶</Text>
                                    </View>
                                    <Text style={styles.dirVideoLabel}>Video</Text>
                                  </View>
                                ) : (
                                  <Image
                                    source={{ uri: media.uri }}
                                    style={styles.dirMediaThumb}
                                    resizeMode="cover"
                                  />
                                )}
                              </TouchableOpacity>
                            ))}
                        </ScrollView>
                      </View>
                    )}

                    {/* Action Buttons Row */}
                    <View style={styles.sellerActionsRow}>
                      <TouchableOpacity
                        style={styles.shopCatalogBtn}
                        activeOpacity={0.8}
                        onPress={() => {
                          setPreferredStore(seller.id, seller.full_name);
                          setPreferredStoreState({ sellerId: seller.id, sellerName: seller.full_name });
                          navigation.navigate('Catalog', {
                            sellerId: seller.id,
                            sellerName: seller.full_name,
                          });
                        }}
                      >
                        <Icon name="shopping-bag" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.shopCatalogBtnText}>Browse Store</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.storeQrBtn}
                        activeOpacity={0.8}
                        onPress={() => handleOpenStoreQr(seller)}
                      >
                        <Icon name="qrcode" size={14} color="#007AFF" style={{ marginRight: 5 }} />
                        <Text style={styles.storeQrBtnText}>Store QR</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.viewOnMapBtn}
                        activeOpacity={0.8}
                        onPress={() =>
                          navigation.navigate('SellersMap', {
                            selectedSellerId: seller.id,
                            sellerId: seller.id,
                          })
                        }
                      >
                        <Icon name="map-marker" size={14} color="#007AFF" style={{ marginRight: 5 }} />
                        <Text style={styles.viewOnMapBtnText}>Map</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Footer Info */}
        <View style={styles.footer}>
          <Text style={styles.footerVersion}>Needs Tracker • Hyperlocal Logistics & Marketplace</Text>
        </View>
      </ScrollView>

      {/* Fullscreen Media Viewer with Horizontal Swipe/Scroll & Thumbnails */}
      <FullScreenImageViewer
        visible={viewerModalVisible}
        mediaList={viewerMediaList}
        initialIndex={viewerActiveIndex}
        onClose={handleCloseMediaViewer}
        title={viewerStoreName || 'Store Media'}
      />

      {/* Individual Store QR Code Modal */}
      <StoreQrModal
        visible={storeQrModalVisible}
        seller={qrModalSeller}
        onClose={() => setStoreQrModalVisible(false)}
        onBrowseStore={handleBrowseStoreFromQr}
      />

      {/* App / Welcome Page QR Code Modal */}
      <WelcomeQrModal
        visible={welcomeQrModalVisible}
        onClose={() => setWelcomeQrModalVisible(false)}
      />

      {/* Persistent Bottom Navigation Footer */}
      <StoreNavigationFooter
        activeTab="stores"
        navigation={navigation}
        forceShow={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    minWidth: '100%',
    backgroundColor: '#F8FAFC',
    height: Platform.OS === 'web' ? '100%' : undefined,
    ...(Platform.OS === 'web' ? { minHeight: '100vh', width: '100%' } : {}),
  },
  scrollView: {
    flex: 1,
    width: '100%',
    minWidth: '100%',
    ...(Platform.OS === 'web' ? { overflowY: 'auto' } : {}),
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    minWidth: '100%',
    paddingBottom: 90,
  },
  brandContainer: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
    marginTop: Platform.OS === 'ios' ? 24 : 36,
  },
  brandTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 340,
    marginBottom: 16,
  },
  headerQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerQrBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  logoIconBox: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginTop: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  actionsContainer: {
    paddingHorizontal: 20,
    width: '100%',
    marginBottom: 16,
  },
  mainMapButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 12,
  },
  welcomeQrBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 12,
  },
  welcomeQrIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  welcomeQrInfo: {
    flex: 1,
  },
  welcomeQrTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  welcomeQrBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  welcomeQrBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  welcomeQrSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  activeStoreBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    marginBottom: 20,
    gap: 10,
  },
  activeStoreIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeStoreInfo: {
    flex: 1,
  },
  activeStoreLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeStoreName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 1,
  },
  activeStoreBrowseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  activeStoreBrowseText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  activeStoreQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  activeStoreQrText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
  },
  activeStoreClearBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 12,
  },
  mainButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingLeft: 4,
  },
  portalsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  portalCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  portalIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  portalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  portalDesc: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
  },

  /* Respective Sellers & Stores Section */
  sellersSectionContainer: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 24,
    width: '100%',
  },
  sellersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sellersTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sellersIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellersSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sellersCountPill: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sellersCountText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  viewMapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  viewMapLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  sellersSectionSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  searchClearBtn: {
    padding: 4,
    marginLeft: 4,
  },
  sellersLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  sellersLoadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  emptySellersBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptySellersTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  emptySellersSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  resetSearchBtn: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  resetSearchText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  sellersList: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    gap: 12,
  },
  sellerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  sellerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sellerImage: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    marginRight: 12,
  },
  sellerPlaceholderImage: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  sellerInfoCol: {
    flex: 1,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  sellerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 6,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  sellerAddress: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 6,
  },
  sellerBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  productBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  productBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369A1',
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  distanceBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#475569',
  },
  sellerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  shopCatalogBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  shopCatalogBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  storeQrBtn: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeQrBtnText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },
  viewOnMapBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOnMapBtnText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },

  footer: {
    alignItems: 'center',
    width: '100%',
    paddingBottom: 24,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  userFooterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  signedInText: {
    fontSize: 12,
    color: '#475569',
    flex: 1,
    marginRight: 10,
  },
  userEmailText: {
    fontWeight: '600',
    color: '#0F172A',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logoutText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
  footerVersion: {
    fontSize: 12,
    color: '#94A3B8',
  },

  /* Option Images Scrolling Strip in Seller Card */
  dirMediaSection: {
    marginTop: 10,
    marginBottom: 4,
  },
  dirMediaScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  dirMediaThumbWrap: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dirMediaThumb: {
    width: 60,
    height: 60,
    borderRadius: 7,
    backgroundColor: '#F1F5F9',
  },
  dirVideoThumb: {
    width: 60,
    height: 60,
    borderRadius: 7,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirVideoPlayBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirVideoPlayText: {
    fontSize: 10,
    color: '#007AFF',
    marginLeft: 2,
  },
  dirVideoLabel: {
    position: 'absolute',
    bottom: 2,
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
  },

  /* Fullscreen Media Viewer Modal Styles with Scrolling Option */
  viewerModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 30,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingHorizontal: 16,
  },
  viewerHeaderBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  viewerHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  viewerStoreTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  viewerCounterText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  viewerCloseBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewerCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  viewerMediaBox: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  viewerFullImage: {
    width: '100%',
    height: '100%',
  },
  viewerFullVideo: {
    width: '100%',
    height: '100%',
  },
  viewerNavBtn: {
    position: 'absolute',
    top: '46%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  viewerNavBtnLeft: {
    left: 8,
  },
  viewerNavBtnRight: {
    right: 8,
  },
  viewerThumbScrollContainer: {
    width: '100%',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  viewerThumbScrollTitle: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    paddingLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  viewerThumbScrollContent: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  viewerThumbItem: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  viewerThumbItemActive: {
    borderColor: '#38BDF8',
    transform: [{ scale: 1.06 }],
  },
  viewerThumbImageSmall: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1E293B',
  },
  viewerVideoThumbSmall: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerVideoPlaySmall: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: 'bold',
  },
  activeDot: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
});
