import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  Modal,
  SafeAreaView,
  Dimensions,
  ScrollView,
  RefreshControl,
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import UniversalWebView from "../components/UniversalWebView";
import { supabase, extractStoreSettings } from "../services/supabase";
import { FontAwesome as Icon } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import { useCart } from "../context/CartContext";
import { showAlert } from "../utils/alertUtils";
import { Video, ResizeMode } from "expo-av";
import StoreNavigationFooter from "../components/StoreNavigationFooter";
import FullScreenImageViewer from "../components/FullScreenImageViewer";

const { width } = Dimensions.get("window");

// Default geographic reference (Hyderabad / Central region fallback)
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

export default function SellersMapScreen({ route }) {
  const navigation = useNavigation();
  const { user, role } = useCart();
  const { width: windowWidth } = useWindowDimensions();
  const isWideScreen = windowWidth >= 768;

  // Core state
  const [sellers, setSellers] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [viewerMediaItem, setViewerMediaItem] = useState(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerMediaList, setViewerMediaList] = useState([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [viewerTitle, setViewerTitle] = useState("");

  const handleOpenMediaViewer = useCallback((targetSeller, initialIndex = 0, title = "Store Media") => {
    const allMedia = [];
    let targetIdx = 0;

    (sellers || []).forEach((s) => {
      const sMedia = (s?.mediaList || []).filter((m) => m && (m.uri || m.url || m.media_url));
      if (sMedia.length > 0) {
        sMedia.forEach((m, mIdx) => {
          if ((String(s.id) === String(targetSeller?.id) || s.full_name === targetSeller?.full_name) && mIdx === initialIndex) {
            targetIdx = allMedia.length;
          }
          allMedia.push({
            id: `sel-map-${s.id}-m-${mIdx}`,
            uri: m.uri || m.url || m.media_url,
            type: m.type || "image",
            title: sMedia.length > 1 ? `${s.full_name} (${mIdx + 1}/${sMedia.length})` : s.full_name,
            subtitle: s.city || s.address || null,
          });
        });
      } else if (s.firstPhoto) {
        if (String(s.id) === String(targetSeller?.id) || s.full_name === targetSeller?.full_name) {
          targetIdx = allMedia.length;
        }
        allMedia.push({
          id: `sel-map-${s.id}-photo`,
          uri: s.firstPhoto,
          type: "image",
          title: s.full_name,
          subtitle: s.city || s.address || null,
        });
      }
    });

    if (allMedia.length === 0 && targetSeller) {
      if (Array.isArray(targetSeller)) {
        targetSeller.forEach((m, idx) => {
          allMedia.push({
            id: `direct-${idx}`,
            uri: m.uri || m.url || m.media_url || m,
            type: m.type || "image",
            title: title || "Store Media",
          });
        });
      } else if (targetSeller.mediaList) {
        targetSeller.mediaList.forEach((m, idx) => {
          allMedia.push({
            id: `sel-direct-${idx}`,
            uri: m.uri || m.url || m.media_url || m,
            type: m.type || "image",
            title: targetSeller.full_name,
            subtitle: targetSeller.city || targetSeller.address || null,
          });
        });
      } else if (targetSeller.firstPhoto) {
        allMedia.push({
          id: `sel-direct-photo`,
          uri: targetSeller.firstPhoto,
          type: "image",
          title: targetSeller.full_name,
        });
      }
      targetIdx = Math.min(Math.max(0, initialIndex), Math.max(0, allMedia.length - 1));
    }

    if (allMedia.length > 0) {
      setViewerMediaList(allMedia);
      setViewerInitialIndex(targetIdx);
      setViewerTitle(targetSeller?.full_name || title || "Store Media");
      setViewerVisible(true);
    }
  }, [sellers]);

  // Directory visibility: Default to false (Full Map by default)
  const [showDirectory, setShowDirectory] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all"); // 'all' | 'products' | 'nearby'

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const debounceTimeout = useRef(null);
  const webViewRef = useRef(null);

  // Safe navigation helper
  const safeNavigate = useCallback(
    (screenName, params = {}) => {
      try {
        setIsMenuVisible(false);
        navigation.navigate(screenName, params);
      } catch (navErr) {
        console.warn(`Navigation error to ${screenName}:`, navErr.message);
      }
    },
    [navigation]
  );

  // Role-based redirection if delivery manager
  useEffect(() => {
    try {
      if (role === "delivery_manager") {
        navigation.replace("DeliveryManagerDashboard");
      }
    } catch (e) {
      console.warn("Role redirection notice:", e.message);
    }
  }, [role, navigation]);

  // Safe cross-platform message dispatch to UniversalWebView
  const sendMapMessage = useCallback((messageObj) => {
    try {
      if (!webViewRef.current) return;
      webViewRef.current.postMessage(messageObj);
    } catch (globalCmdErr) {
      console.warn("sendMapMessage error:", globalCmdErr);
    }
  }, []);

  // Fetch all sellers resiliently (Profiles + Products + Customers)
  const fetchSellersData = useCallback(async () => {
    try {
      // 1. Fetch ALL profiles (do not filter out null coordinates so every seller is loaded!)
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, mobile, role, address_line_1, address_line_2, city, state, zip_code, latitude, longitude, avatar_url, media_urls"
        );

      if (profilesError) {
        console.warn("Profiles fetch notice in SellersMapScreen:", profilesError.message);
      }

      // 2. Fetch products and product_media to discover seller product images
      let productsCountMap = {};
      let sellersWithProductsSet = new Set();
      let sellerProductMediaMap = {};

      try {
        const { data: prodData } = await supabase
          .from("products")
          .select("id, user_id, customer_id, product_name, is_active, product_media ( id, media_url, media_type )");

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
                      type: pm.media_type || "image",
                      title: p.product_name || "Product",
                    });
                  }
                });
              }
            }
          });
        }
      } catch (prodErr) {
        console.warn("Products count notice:", prodErr.message);
      }

      // 3. Also fetch customers table (stores/locations)
      let customersData = [];
      try {
        const { data: cData } = await supabase
          .from("customers")
          .select("id, name, mobile, email, address, latitude, longitude");
        if (cData && Array.isArray(cData)) {
          customersData = cData;
        }
      } catch (custErr) {
        console.warn("Customers fetch notice:", custErr.message);
      }

      // 4. Format profiles: Include sellers, admins, superadmins, appadmins, profiles with products, or all store owners
      const allProfiles = profilesData || [];
      const formattedProfiles = allProfiles
        .filter((p) => {
          if (!p) return false;
          const r = (p.role || "").toLowerCase();
          const hasProducts = sellersWithProductsSet.has(p.id);
          return (
            r === "seller" ||
            r === "admin" ||
            r === "superadmin" ||
            r === "appadmin" ||
            r === "app_admin" ||
            r === "merchant" ||
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
              mediaList = typeof p.media_urls === "string" ? JSON.parse(p.media_urls) : p.media_urls;
            } catch (e) {
              mediaList = [];
            }
          }
          if (!Array.isArray(mediaList)) {
            mediaList = [];
          }

          // Clean mediaList: filter out store_settings and items without valid URI string
          mediaList = mediaList.filter(
            (m) => m && m.type !== "store_settings" && m.uri && typeof m.uri === "string" && m.uri.trim().length > 0
          );
          mediaList = mediaList.map((m) => ({
            ...m,
            uri: m.uri.trim(),
            type: m.type === "video" ? "video" : "image",
          }));

          if (
            p.avatar_url &&
            typeof p.avatar_url === "string" &&
            p.avatar_url.trim().length > 0 &&
            !mediaList.some((m) => m.uri === p.avatar_url.trim())
          ) {
            mediaList.unshift({ uri: p.avatar_url.trim(), type: "image", isProfile: true });
          }

          const prodMedia = sellerProductMediaMap[p.id] || [];
          prodMedia.forEach((pm) => {
            if (
              pm &&
              pm.uri &&
              typeof pm.uri === "string" &&
              pm.uri.trim().length > 0 &&
              !mediaList.some((m) => m.uri === pm.uri.trim())
            ) {
              mediaList.push({
                uri: pm.uri.trim(),
                type: pm.type === "video" ? "video" : "image",
              });
            }
          });

          const firstPhoto =
            (mediaList.find((m) => m.type === "image")?.uri) ||
            p.avatar_url ||
            (prodMedia.find((m) => m.type === "image")?.uri) ||
            null;

          const storeSettings = extractStoreSettings(p.media_urls);
          const isStoreActive = storeSettings.is_store_active === true;
          const isMapActive = storeSettings.is_map_active === true || (isStoreActive && storeSettings.is_map_active !== false);

          return {
            id: p.id,
            full_name: p.full_name || p.email?.split("@")[0] || "Seller Store",
            email: p.email || "",
            mobile: p.mobile || "",
            role: p.role || "seller",
            city: p.city || "",
            address: [p.address_line_1, p.address_line_2, p.city, p.state].filter(Boolean).join(", ") || (p.city ? `${p.city}` : "Store Location"),
            latitude: hasCoords ? Number(p.latitude) : fallbackLat,
            longitude: hasCoords ? Number(p.longitude) : fallbackLon,
            hasExactCoordinates: hasCoords,
            productCount: productsCountMap[p.id] || 0,
            avatar_url: p.avatar_url,
            firstPhoto: firstPhoto,
            mediaList: mediaList,
            is_store_active: isStoreActive,
            is_map_active: isMapActive,
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
            (m) => m && m.uri && typeof m.uri === "string" && m.uri.trim().length > 0 && m.type !== "store_settings"
          );
          const custFirstPhoto = custProdMedia.find((m) => m.type === "image")?.uri || null;

          return {
            id: String(c.id),
            full_name: c.name || "Store Location",
            email: c.email || "",
            mobile: c.mobile || "",
            role: "store",
            city: "",
            address: c.address || "Store Location",
            latitude: hasCoords ? Number(c.latitude) : fallbackLat,
            longitude: hasCoords ? Number(c.longitude) : fallbackLon,
            hasExactCoordinates: hasCoords,
            productCount: productsCountMap[c.id] || 0,
            avatar_url: null,
            firstPhoto: custFirstPhoto,
            mediaList: custProdMedia,
            is_store_active: true,
            is_map_active: true,
            isProfile: false,
          };
        });

      let combined = [...formattedProfiles, ...formattedCustomers];

      // If database returned 0 sellers, provide fallback demo sellers so app is never broken
      if (combined.length === 0) {
        combined = [
          {
            id: "seller-demo-1",
            full_name: "Super Mart & Groceries",
            email: "grocery@example.com",
            mobile: "+91 9876543210",
            role: "seller",
            city: "Hyderabad",
            address: "Hitech City, Hyderabad, Telangana",
            latitude: 17.4435,
            longitude: 78.3772,
            hasExactCoordinates: true,
            productCount: 12,
            avatar_url: null,
            is_store_active: true,
            is_map_active: true,
            isProfile: true,
          },
          {
            id: "seller-demo-2",
            full_name: "Fresh Foods & Essentials",
            email: "freshfoods@example.com",
            mobile: "+91 9876543211",
            role: "seller",
            city: "Hyderabad",
            address: "Madhapur, Hyderabad, Telangana",
            latitude: 17.4483,
            longitude: 78.3915,
            hasExactCoordinates: true,
            productCount: 8,
            avatar_url: null,
            is_store_active: true,
            is_map_active: true,
            isProfile: true,
          },
          {
            id: "seller-demo-3",
            full_name: "City Organic Store",
            email: "organic@example.com",
            mobile: "+91 9876543212",
            role: "seller",
            city: "Hyderabad",
            address: "Gachibowli, Hyderabad, Telangana",
            latitude: 17.4399,
            longitude: 78.3489,
            hasExactCoordinates: true,
            productCount: 15,
            avatar_url: null,
            is_store_active: true,
            is_map_active: true,
            isProfile: true,
          },
        ];
      }

      // Sort: stores with products first
      combined.sort((a, b) => (b.productCount || 0) - (a.productCount || 0));

      setSellers(combined);
      return combined;
    } catch (err) {
      console.warn("fetchSellersData exception:", err);
    }
    return [];
  }, []);

  // Safe non-blocking GPS Location lookup
  const fetchLocationData = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeout: 3500,
          });
          if (loc?.coords) {
            setUserLocation(loc.coords);
            return loc.coords;
          }
        } catch (locErr) {
          try {
            const lastKnown = await Location.getLastKnownPositionAsync({});
            if (lastKnown?.coords) {
              setUserLocation(lastKnown.coords);
              return lastKnown.coords;
            }
          } catch (_) {}
        }
      }
    } catch (permErr) {
      console.warn("Location lookup notice:", permErr.message);
    }
    return null;
  }, []);

  // Active sellers for interactive map (sellers where map is not explicitly disabled, or who have products)
  const mapActiveSellers = useMemo(() => {
    return sellers.filter((s) => s.is_map_active !== false || (s.productCount && s.productCount > 0));
  }, [sellers]);

  // Active sellers for store directory list (sellers where store is not explicitly disabled, or who have products)
  const storeActiveSellers = useMemo(() => {
    return sellers.filter((s) => s.is_store_active !== false || (s.productCount && s.productCount > 0));
  }, [sellers]);

  // Handle direct navigation to a specific seller via route params
  useEffect(() => {
    const targetId = route?.params?.selectedSellerId || route?.params?.sellerId;
    if (targetId && sellers.length > 0) {
      const match = sellers.find((s) => String(s.id) === String(targetId));
      if (match) {
        setSelectedSeller(match);
        if (match.latitude && match.longitude) {
          sendMapMessage({
            type: "SET_VIEW",
            latitude: match.latitude,
            longitude: match.longitude,
            zoom: 16,
          });
          sendMapMessage({
            type: "OPEN_SELLER",
            sellerId: match.id,
          });
        }
      }
    }
  }, [route?.params?.selectedSellerId, route?.params?.sellerId, sellers, sendMapMessage]);

  // Initialize data
  const initData = useCallback(async () => {
    try {
      setLoading(true);
      const fetchedSellers = await fetchSellersData();

      if (fetchedSellers && fetchedSellers.length > 0) {
        const targetId = route?.params?.selectedSellerId || route?.params?.sellerId;
        const targetSeller = targetId ? fetchedSellers.find((s) => String(s.id) === String(targetId)) : null;
        if (targetSeller) {
          setSelectedSeller(targetSeller);
          if (targetSeller.latitude && targetSeller.longitude) {
            sendMapMessage({
              type: "SET_VIEW",
              latitude: targetSeller.latitude,
              longitude: targetSeller.longitude,
              zoom: 16,
            });
            sendMapMessage({
              type: "OPEN_SELLER",
              sellerId: targetSeller.id,
            });
          }
        }
      }

      // Non-blocking location fetch
      fetchLocationData().then((coords) => {
        if (coords && fetchedSellers && fetchedSellers.length > 0) {
          const mapActive = fetchedSellers.filter((s) => s.is_map_active !== false || (s.productCount && s.productCount > 0));
          const sorted = [...mapActive].sort((a, b) => {
            return (
              getRawDistanceKm(coords.latitude, coords.longitude, a.latitude, a.longitude) -
              getRawDistanceKm(coords.latitude, coords.longitude, b.latitude, b.longitude)
            );
          });
          if (sorted.length > 0) {
            const targetId = route?.params?.selectedSellerId || route?.params?.sellerId;
            const targetSeller = targetId ? sorted.find((s) => String(s.id) === String(targetId)) : null;
            if (targetSeller) {
              setSelectedSeller(targetSeller);
            }
          }
          sendMapMessage({
            type: "UPDATE_DATA",
            sellers: sorted,
            userLocation: coords,
          });
        }
      });
    } catch (err) {
      console.warn("Data initialization notice:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchSellersData, fetchLocationData, sendMapMessage, route?.params?.selectedSellerId, route?.params?.sellerId]);

  useEffect(() => {
    initData();
  }, [initData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    initData();
  }, [initData]);

  // Keep map synchronized whenever mapActiveSellers or userLocation updates
  useEffect(() => {
    sendMapMessage({
      type: "UPDATE_DATA",
      sellers: mapActiveSellers,
      userLocation: userLocation,
    });
  }, [mapActiveSellers, userLocation, sendMapMessage]);

  // Filtered sellers for Directory List (strictly store-active sellers by default)
  const displayedSellers = useMemo(() => {
    let list = [...storeActiveSellers];

    // Filter by search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) => {
        const name = (s.full_name || "").toLowerCase();
        const city = (s.city || "").toLowerCase();
        const address = (s.address || "").toLowerCase();
        const mobile = (s.mobile || "").toLowerCase();
        const email = (s.email || "").toLowerCase();
        return name.includes(q) || city.includes(q) || address.includes(q) || mobile.includes(q) || email.includes(q);
      });
    }

    // Filter by segment chip
    if (activeFilter === "products") {
      list = list.filter((s) => (s.productCount || 0) > 0);
    } else if (activeFilter === "nearby" && userLocation) {
      list = list.filter((s) => {
        const dist = getRawDistanceKm(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude);
        return dist <= 15;
      });
    }

    // Sort by proximity if userLocation exists
    if (userLocation) {
      list.sort((a, b) => {
        return (
          getRawDistanceKm(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) -
          getRawDistanceKm(userLocation.latitude, userLocation.longitude, b.latitude, b.longitude)
        );
      });
    }

    return list;
  }, [storeActiveSellers, searchQuery, activeFilter, userLocation]);

  // Search area and sellers
  const fetchSuggestions = async (text) => {
    try {
      if (!text || text.trim().length === 0) {
        setSuggestions([]);
        return;
      }
      const cleanQuery = text.trim().toLowerCase();
      setSearchLoading(true);

      const results = [];

      // 1. Search matching local sellers & stores (only active stores)
      try {
        const matchedSellers = storeActiveSellers.filter((s) => {
          const name = (s.full_name || "").toLowerCase();
          const city = (s.city || "").toLowerCase();
          const address = (s.address || "").toLowerCase();
          const mobile = (s.mobile || "").toLowerCase();
          return (
            name.includes(cleanQuery) ||
            city.includes(cleanQuery) ||
            address.includes(cleanQuery) ||
            mobile.includes(cleanQuery)
          );
        });

        matchedSellers.slice(0, 5).forEach((s) => {
          results.push({
            id: `seller-${s.id}`,
            title: s.full_name,
            subtitle: s.address || s.city || `Seller • ${s.productCount} products`,
            type: "seller",
            latitude: s.latitude,
            longitude: s.longitude,
            data: s,
          });
        });
      } catch (matchErr) {
        console.warn("Local seller match error:", matchErr);
      }

      // 2. Search OpenStreetMap Nominatim for geographic areas / places
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=4`,
          {
            headers: { "User-Agent": "NeedsTrackingApp/1.0" },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach((item, idx) => {
            if (item && item.lat && item.lon) {
              results.push({
                id: `place-${idx}-${item.place_id || item.osm_id || idx}`,
                title: item.display_name ? item.display_name.split(",")[0] : "Location",
                subtitle: item.display_name || "",
                type: "area",
                latitude: parseFloat(item.lat),
                longitude: parseFloat(item.lon),
              });
            }
          });
        }
      } catch (osmErr) {
        // Silent fallback on geocoding network errors
      }

      setSuggestions(results);
    } catch (err) {
      console.warn("fetchSuggestions error:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text) => {
    try {
      setSearchQuery(text);
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      debounceTimeout.current = setTimeout(() => fetchSuggestions(text), 300);
    } catch (err) {
      console.warn("handleSearchChange error:", err);
    }
  };

  const handleSelectSuggestion = (item) => {
    try {
      setSuggestions([]);
      setSearchQuery(item.title);

      if (item.latitude && item.longitude) {
        sendMapMessage({
          type: "SET_VIEW",
          latitude: item.latitude,
          longitude: item.longitude,
          zoom: item.type === "seller" ? 16 : 14,
        });

        if (item.type === "seller" && item.data) {
          setSelectedSeller(item.data);
          sendMapMessage({
            type: "OPEN_SELLER",
            sellerId: item.data.id,
          });
        } else {
          // Find nearest active seller to this selected area
          const sorted = [...mapActiveSellers].sort((a, b) => {
            return (
              getRawDistanceKm(item.latitude, item.longitude, a.latitude, a.longitude) -
              getRawDistanceKm(item.latitude, item.longitude, b.latitude, b.longitude)
            );
          });
          if (sorted.length > 0) {
            setSelectedSeller(sorted[0]);
          }
        }
      }
    } catch (err) {
      console.warn("handleSelectSuggestion error:", err);
    }
  };

  const handleClearSearch = () => {
    try {
      setSearchQuery("");
      setSuggestions([]);
      if (userLocation) {
        sendMapMessage({
          type: "SET_VIEW",
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          zoom: 13,
        });
      } else if (mapActiveSellers.length > 0) {
        sendMapMessage({
          type: "UPDATE_DATA",
          sellers: mapActiveSellers,
          userLocation: userLocation,
        });
      }
    } catch (err) {
      console.warn("handleClearSearch error:", err);
    }
  };

  const handleRecenterLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeout: 4000,
      });
      if (loc?.coords) {
        setUserLocation(loc.coords);
        sendMapMessage({
          type: "UPDATE_DATA",
          sellers: mapActiveSellers,
          userLocation: loc.coords,
        });
        sendMapMessage({
          type: "SET_VIEW",
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          zoom: 14,
        });
      }
    } catch (e) {
      if (userLocation) {
        sendMapMessage({
          type: "SET_VIEW",
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          zoom: 14,
        });
      } else {
        showAlert(
          "Location Notice",
          "Could not obtain current GPS position. Please check location permissions and GPS toggle."
        );
      }
    }
  };

  const handleLogout = () => {
    showAlert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            setIsMenuVisible(false);
            await supabase.auth.signOut();
            navigation.reset({
              index: 0,
              routes: [{ name: "Welcome" }],
            });
          } catch (err) {
            console.error("Logout error:", err);
          }
        },
      },
    ]);
  };

  const handleOpenDirections = (lat, lng, label) => {
    try {
      if (!lat || !lng) return;
      const latLng = `${lat},${lng}`;
      const scheme = Platform.select({
        ios: "maps:0,0?q=",
        android: "geo:0,0?q=",
        default: "https://www.google.com/maps/search/?api=1&query=",
      });
      const url = Platform.select({
        ios: `${scheme}${encodeURIComponent(label || "Seller Location")}@${latLng}`,
        android: `${scheme}${latLng}(${encodeURIComponent(label || "Seller Location")})`,
        default: `${scheme}${latLng}`,
      });
      Linking.openURL(url).catch((err) => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latLng}`).catch(() => {});
      });
    } catch (err) {
      console.warn("Error opening directions:", err);
    }
  };

  const onMapMessage = (event) => {
    try {
      let raw = event.nativeEvent?.data || event.data;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch (parseErr) {
          return;
        }
      }
      if (!raw) return;

      if (raw.type === "mapReady") {
        if (mapActiveSellers.length > 0 || userLocation) {
          sendMapMessage({
            type: "UPDATE_DATA",
            sellers: mapActiveSellers,
            userLocation: userLocation,
          });
        }
      } else if (raw.type === "viewProducts") {
        safeNavigate("Catalog", { userId: raw.sellerId, sellerId: raw.sellerId, sellerName: raw.name });
      } else if (raw.type === "sellerClicked") {
        setSelectedSeller(raw.seller);
      } else if (raw.type === "getDirections") {
        handleOpenDirections(raw.latitude, raw.longitude, raw.name);
      } else if (raw.type === "openViewer") {
        if (raw.media) {
          setViewerMediaItem(raw.media);
        }
      }
    } catch (err) {
      console.error("Error handling map message:", err);
    }
  };

  // Generate Leaflet Map HTML
  const initialLat = userLocation?.latitude || (mapActiveSellers.length > 0 ? mapActiveSellers[0].latitude : DEFAULT_LAT);
  const initialLon = userLocation?.longitude || (mapActiveSellers.length > 0 ? mapActiveSellers[0].longitude : DEFAULT_LON);
  const initialZoom = userLocation ? 13 : (mapActiveSellers.length > 0 ? 12 : 5);

  const htmlContent = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Sellers Map</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
        <style>
            html, body {
                width: 100%;
                height: 100%;
                margin: 0;
                padding: 0;
                background-color: #f8fafc;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            #mapid {
                width: 100%;
                height: 100%;
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
            }
            .seller-icon-wrapper {
                background: transparent;
                border: none;
            }
            .seller-custom-pin {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                cursor: pointer;
                filter: drop-shadow(0 4px 10px rgba(0,0,0,0.3));
                transition: transform 0.2s ease;
            }
            .seller-custom-pin:hover {
                transform: scale(1.15);
            }
            .seller-pin-bubble {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: linear-gradient(135deg, #007AFF 0%, #0056b3 100%);
                border: 2.5px solid #FFFFFF;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,122,255,0.4);
            }
            .seller-pin-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .seller-pin-bubble i {
                color: #FFFFFF;
                font-size: 18px;
            }
            .seller-pin-tail {
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-top: 8px solid #007AFF;
                margin-top: -2px;
            }
            .user-pulse-marker {
                width: 20px;
                height: 20px;
                background: #10B981;
                border: 3.5px solid #FFFFFF;
                border-radius: 50%;
                box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.4);
            }
            .custom-popup .leaflet-popup-content-wrapper {
                border-radius: 20px;
                padding: 0px;
                box-shadow: 0 16px 36px rgba(15,23,42,0.24);
                border: 1px solid rgba(226, 232, 240, 0.9);
                overflow: hidden;
                background: #FFFFFF;
            }
            .custom-popup .leaflet-popup-content {
                margin: 0;
                padding: 12px 14px;
                line-height: 1.4;
                max-width: 270px;
            }
            .popup-hero-wrap {
                width: calc(100% + 28px);
                margin: -12px -14px 8px -14px;
                height: 125px;
                position: relative;
                background-color: #0F172A;
                overflow: hidden;
                cursor: pointer;
            }
            .popup-hero-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.3s ease;
            }
            .popup-hero-wrap:hover .popup-hero-img {
                transform: scale(1.03);
            }
            .popup-photos-badge {
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(4px);
                color: #FFFFFF;
                font-size: 10px;
                font-weight: 700;
                padding: 3px 8px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
            .popup-zoom-badge {
                position: absolute;
                top: 8px;
                right: 8px;
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(4px);
                color: #FFFFFF;
                width: 26px;
                height: 26px;
                border-radius: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
            }
            .popup-gallery-strip {
                display: flex;
                gap: 6px;
                overflow-x: auto;
                padding: 2px 0 6px 0;
                margin-bottom: 6px;
            }
            .popup-thumb-item {
                width: 38px;
                height: 38px;
                border-radius: 6px;
                overflow: hidden;
                flex-shrink: 0;
                border: 2px solid #E2E8F0;
                cursor: pointer;
                position: relative;
                background: #F1F5F9;
                transition: border-color 0.2s ease, transform 0.2s ease;
            }
            .popup-thumb-item.active {
                border-color: #007AFF;
                transform: scale(1.06);
            }
            .popup-thumb-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .popup-thumb-video-badge {
                position: absolute;
                inset: 0;
                background: rgba(15,23,42,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #FFFFFF;
                font-size: 9px;
            }
            .popup-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 4px;
            }
            .popup-title {
                font-size: 15px;
                font-weight: 700;
                color: #0F172A;
                margin: 0;
                line-height: 1.2;
            }
            .popup-tag {
                display: inline-block;
                background: #E0F2FE;
                color: #0284C7;
                font-size: 10px;
                font-weight: 600;
                padding: 2px 7px;
                border-radius: 6px;
                margin-bottom: 6px;
            }
            .popup-info-row {
                font-size: 11px;
                color: #64748B;
                margin-bottom: 3px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .popup-btn-primary {
                width: 100%;
                background: #007AFF;
                color: #FFFFFF;
                border: none;
                border-radius: 12px;
                padding: 10px 14px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-top: 8px;
                box-shadow: 0 4px 12px rgba(0,122,255,0.3);
                transition: background-color 0.2s;
            }
            .popup-btn-primary:active {
                background: #0056b3;
            }
            .popup-btn-secondary {
                width: 100%;
                background: #F8FAFC;
                color: #334155;
                border: 1px solid #E2E8F0;
                border-radius: 12px;
                padding: 9px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-top: 6px;
                transition: background-color 0.2s;
            }
            .popup-btn-secondary:active {
                background: #F1F5F9;
            }
        </style>
    </head>
    <body>
        <div id="mapid"></div>
        <script>
            try {
                var southWest = L.latLng(-85, -180);
                var northEast = L.latLng(85, 180);
                var worldBounds = L.latLngBounds(southWest, northEast);

                var map = L.map('mapid', {
                    zoomControl: false,
                    minZoom: 3,
                    maxZoom: 19,
                    maxBounds: worldBounds,
                    maxBoundsViscosity: 1.0,
                    worldCopyJump: false
                }).setView([${initialLat}, ${initialLon}], ${initialZoom});
                L.control.zoom({ position: 'bottomright' }).addTo(map);

                // Reliable standard OpenStreetMap tile layer with noWrap to enforce single view without side-by-side tile duplicates
                L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    maxZoom: 19,
                    minZoom: 3,
                    noWrap: true,
                    bounds: worldBounds
                }).addTo(map);

                window.map = map;
                window.sellerMarkers = {};
                window.markerLayerGroup = L.layerGroup().addTo(map);
                window.userMarker = null;
                window.currentSellers = [];

                function postToParent(data) {
                    try {
                        var json = typeof data === 'string' ? data : JSON.stringify(data);
                        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                            window.ReactNativeWebView.postMessage(json);
                        }
                        if (window.parent && window.parent !== window) {
                            window.parent.postMessage(json, '*');
                        }
                    } catch (e) {
                        console.error('postToParent error:', e);
                    }
                }

                function viewProducts(sellerId, name) {
                    postToParent({ type: 'viewProducts', sellerId: sellerId, name: name });
                }

                function getDirections(latitude, longitude, name) {
                    postToParent({ type: 'getDirections', latitude: latitude, longitude: longitude, name: name });
                }

                function handlePinImgError(img) {
                    if (!img) return;
                    img.style.display = 'none';
                    if (img.nextElementSibling) {
                        img.nextElementSibling.style.display = 'flex';
                    }
                }

                function openViewer(mediaObj) {
                    postToParent({ type: 'openViewer', media: mediaObj });
                }

                window.updateMapData = function(sellersData, userLoc) {
                    try {
                        if (!window.map) return;
                        window.currentSellers = sellersData || [];
                        if (window.markerLayerGroup) {
                            window.markerLayerGroup.clearLayers();
                        } else {
                            window.markerLayerGroup = L.layerGroup().addTo(window.map);
                        }
                        if (window.userMarker) {
                            window.map.removeLayer(window.userMarker);
                            window.userMarker = null;
                        }

                        var boundsPoints = [];

                        if (userLoc && userLoc.latitude && userLoc.longitude) {
                            boundsPoints.push([userLoc.latitude, userLoc.longitude]);
                            var userIcon = L.divIcon({
                                className: 'user-pulse-container',
                                html: '<div class="user-pulse-marker"></div>',
                                iconSize: [20, 20],
                                iconAnchor: [10, 10]
                            });
                            window.userMarker = L.marker([userLoc.latitude, userLoc.longitude], { icon: userIcon })
                                .addTo(window.map)
                                .bindPopup('<b>You are here</b>');
                        }

                        window.sellerMarkers = {};
                        if (sellersData && sellersData.length > 0) {
                            sellersData.forEach(function(seller) {
                                if (!seller || seller.latitude == null || seller.longitude == null) return;
                                boundsPoints.push([seller.latitude, seller.longitude]);

                                var markerHtml = '';
                                if (seller.firstPhoto) {
                                    markerHtml =
                                        '<div class="seller-custom-pin">' +
                                            '<div class="seller-pin-bubble">' +
                                                '<img src="' + seller.firstPhoto + '" class="seller-pin-img" onerror="handlePinImgError(this)" />' +
                                                '<div style="display:none; color:white; align-items:center; justify-content:center; width:100%; height:100%;"><i class="fas fa-store"></i></div>' +
                                            '</div>' +
                                            '<div class="seller-pin-tail"></div>' +
                                        '</div>';
                                } else {
                                    markerHtml =
                                        '<div class="seller-custom-pin">' +
                                            '<div class="seller-pin-bubble">' +
                                                '<i class="fas fa-store"></i>' +
                                            '</div>' +
                                            '<div class="seller-pin-tail"></div>' +
                                        '</div>';
                                }

                                var sellerIcon = L.divIcon({
                                    className: 'seller-icon-wrapper',
                                    html: markerHtml,
                                    iconSize: [44, 52],
                                    iconAnchor: [22, 52],
                                    popupAnchor: [0, -52]
                                });

                                var safeName = (seller.full_name || 'Seller Store').replace(/"/g, '&quot;');
                                var photosCount = (seller.mediaList && seller.mediaList.length) || (seller.firstPhoto ? 1 : 0);

                                var popupHtml = '';
                                if (seller.firstPhoto) {
                                    popupHtml +=
                                        '<div class="popup-hero-wrap" data-action="openHeroViewer" data-seller-id="' + seller.id + '" title="Tap to view full media">' +
                                            '<img id="popup-hero-' + seller.id + '" src="' + seller.firstPhoto + '" data-current-idx="0" data-current-type="image" class="popup-hero-img" />' +
                                            (photosCount > 1 ? '<div class="popup-photos-badge" id="popup-badge-' + seller.id + '"><i class="fas fa-images"></i> ' + photosCount + ' Media</div>' : '') +
                                            '<div class="popup-zoom-badge"><i class="fas fa-expand"></i></div>' +
                                        '</div>';
                                }

                                // Interactive Gallery Strip if multiple media items exist
                                if (seller.mediaList && seller.mediaList.length > 1) {
                                    popupHtml += '<div class="popup-gallery-strip" id="popup-strip-' + seller.id + '">';
                                    seller.mediaList.slice(0, 6).forEach(function(media, mIdx) {
                                        popupHtml +=
                                            '<div class="popup-thumb-item ' + (mIdx === 0 ? 'active' : '') + '" data-action="selectMedia" data-seller-id="' + seller.id + '" data-media-idx="' + mIdx + '" data-media-url="' + media.uri + '" data-media-type="' + (media.type || 'image') + '">' +
                                                (media.type === 'video' ? '<div class="popup-thumb-video-badge"><i class="fas fa-play"></i></div>' : '') +
                                                '<img src="' + media.uri + '" />' +
                                            '</div>';
                                    });
                                    popupHtml += '</div>';
                                }

                                popupHtml +=
                                    '<div class="popup-header">' +
                                        (!seller.firstPhoto ? '<i class="fas fa-store" style="color:#007AFF; font-size:16px;"></i>' : '') +
                                        '<h4 class="popup-title">' + (seller.full_name || 'Seller Store') + '</h4>' +
                                    '</div>' +
                                    '<div class="popup-tag">' + (seller.hasExactCoordinates === false ? 'Store • Location Approximate' : 'Verified Store') + '</div>' +
                                    (seller.city ? '<div class="popup-info-row"><i class="fas fa-map-marker-alt" style="color:#007AFF;"></i> ' + seller.city + '</div>' : '') +
                                    (seller.mobile ? '<div class="popup-info-row"><i class="fas fa-phone" style="color:#10B981;"></i> ' + seller.mobile + '</div>' : '') +
                                    (seller.productCount > 0 ? '<div class="popup-info-row"><i class="fas fa-box-open" style="color:#6366F1;"></i> <b>' + seller.productCount + ' Products</b> in store</div>' : '') +
                                    '<button class="popup-btn-primary" data-action="viewProducts" data-seller-id="' + seller.id + '" data-seller-name="' + safeName + '">' +
                                        '<i class="fas fa-shopping-bag"></i> Browse Store' +
                                    '</button>' +
                                    '<button class="popup-btn-secondary" data-action="getDirections" data-lat="' + seller.latitude + '" data-lng="' + seller.longitude + '" data-seller-name="' + safeName + '">' +
                                        '<i class="fas fa-directions"></i> Directions' +
                                    '</button>';

                                var marker = L.marker([seller.latitude, seller.longitude], { icon: sellerIcon })
                                    .bindPopup(popupHtml, { className: 'custom-popup' });

                                marker.on('click', function() {
                                    postToParent({ type: 'sellerClicked', seller: seller });
                                });

                                window.markerLayerGroup.addLayer(marker);
                                window.sellerMarkers[seller.id] = marker;
                            });
                        }

                        if (boundsPoints.length > 0) {
                            window.sellerBounds = L.latLngBounds(boundsPoints);
                            if (userLoc && userLoc.latitude && userLoc.longitude) {
                                window.map.setView([userLoc.latitude, userLoc.longitude], 13);
                            } else if (boundsPoints.length === 1) {
                                window.map.setView(boundsPoints[0], 14);
                            } else {
                                window.map.fitBounds(window.sellerBounds.pad(0.25));
                            }
                        } else if (userLoc && userLoc.latitude && userLoc.longitude) {
                            window.map.setView([userLoc.latitude, userLoc.longitude], 13);
                        }

                        setTimeout(function() {
                            window.map.invalidateSize();
                        }, 250);
                    } catch (e) {
                        console.error('updateMapData error:', e);
                    }
                };

                // Event delegation for popup buttons and interactive gallery
                document.addEventListener('click', function(e) {
                    var btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
                    if (!btn) return;
                    var action = btn.getAttribute('data-action');
                    if (action === 'viewProducts') {
                        var sellerId = btn.getAttribute('data-seller-id');
                        var name = btn.getAttribute('data-seller-name');
                        viewProducts(sellerId, name);
                    } else if (action === 'getDirections') {
                        var lat = parseFloat(btn.getAttribute('data-lat'));
                        var lng = parseFloat(btn.getAttribute('data-lng'));
                        var name = btn.getAttribute('data-seller-name');
                        getDirections(lat, lng, name);
                    } else if (action === 'selectMedia') {
                        var sId = btn.getAttribute('data-seller-id');
                        var mIdx = parseInt(btn.getAttribute('data-media-idx'), 10);
                        var mediaUrl = btn.getAttribute('data-media-url');
                        var mediaType = btn.getAttribute('data-media-type');
                        var heroEl = document.getElementById('popup-hero-' + sId);
                        if (heroEl && mediaUrl) {
                            heroEl.src = mediaUrl;
                            heroEl.setAttribute('data-current-idx', mIdx);
                            heroEl.setAttribute('data-current-type', mediaType || 'image');
                        }
                        var stripEl = document.getElementById('popup-strip-' + sId);
                        if (stripEl) {
                            var thumbs = stripEl.querySelectorAll('.popup-thumb-item');
                            thumbs.forEach(function(t, idx) {
                                if (idx === mIdx) {
                                    t.classList.add('active');
                                } else {
                                    t.classList.remove('active');
                                }
                            });
                        }
                    } else if (action === 'openHeroViewer') {
                        var sId = btn.getAttribute('data-seller-id');
                        var heroEl = document.getElementById('popup-hero-' + sId);
                        var curIdx = parseInt((heroEl && heroEl.getAttribute('data-current-idx')) || '0', 10);
                        var curUrl = (heroEl && heroEl.src) || '';
                        var curType = (heroEl && heroEl.getAttribute('data-current-type')) || 'image';
                        var seller = (window.currentSellers || []).find(function(s) { return String(s.id) === String(sId); });
                        if (seller && seller.mediaList && seller.mediaList[curIdx]) {
                            openViewer(seller.mediaList[curIdx]);
                        } else if (curUrl) {
                            openViewer({ uri: curUrl, type: curType });
                        }
                    }
                });

                // Listen for incoming commands from parent window / React Native
                function handleIncomingMessage(event) {
                    try {
                        var data = event.data !== undefined ? event.data : event;
                        if (typeof data === 'string') {
                            try { data = JSON.parse(data); } catch(e) { return; }
                        }
                        if (!data) return;

                        if (data.type === 'UPDATE_DATA') {
                            window.updateMapData(data.sellers, data.userLocation);
                        } else if (data.type === 'SET_VIEW') {
                            if (window.map && data.latitude && data.longitude) {
                                window.map.setView([data.latitude, data.longitude], data.zoom || 14, { animate: true });
                            }
                        } else if (data.type === 'OPEN_SELLER') {
                            if (window.sellerMarkers && window.sellerMarkers[data.sellerId]) {
                                window.sellerMarkers[data.sellerId].openPopup();
                            }
                        }
                    } catch (err) {
                        console.error('handleIncomingMessage error:', err);
                    }
                }

                window.addEventListener('message', handleIncomingMessage);
                document.addEventListener('message', handleIncomingMessage);

                // Initial render with embedded sellers data
                var initialSellers = ${JSON.stringify(mapActiveSellers)};
                var initialUserLoc = ${JSON.stringify(userLocation)};
                if (initialSellers.length > 0 || initialUserLoc) {
                    window.updateMapData(initialSellers, initialUserLoc);
                }

                // Notify parent that map is ready
                postToParent({ type: 'mapReady' });

                window.onload = function() {
                    setTimeout(function() {
                        if (window.map) window.map.invalidateSize();
                    }, 350);
                };
            } catch (mapErr) {
                console.error('Leaflet initialization error:', mapErr);
            }
        </script>
    </body>
    </html>
  `, [initialLat, initialLon, initialZoom, mapActiveSellers, userLocation]);

  const calculatedDistance =
    selectedSeller && userLocation
      ? calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          selectedSeller.latitude,
          selectedSeller.longitude
        )
      : null;

  // Render a seller item in the Directory List
  const renderSellerDirectoryCard = ({ item }) => {
    const itemDistance =
      userLocation && item.latitude && item.longitude
        ? calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude)
        : null;

    const initialLetter = (item.full_name || "S").charAt(0).toUpperCase();
    const hasMedia = item.mediaList && item.mediaList.length > 0;

    return (
      <View style={styles.directoryCard}>
        <View style={styles.directoryCardHeader}>
          {/* Avatar / 1st Profile Photo */}
          {item.firstPhoto ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleOpenMediaViewer(item, 0, item.full_name)}
            >
              <Image
                source={{ uri: item.firstPhoto }}
                style={styles.directoryAvatarImg}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.directoryAvatar}>
              <Text style={styles.directoryAvatarText}>{initialLetter}</Text>
            </View>
          )}

          <View style={styles.directoryInfo}>
            <View style={styles.directoryNameRow}>
              <Text style={styles.directoryTitle} numberOfLines={1}>
                {item.full_name}
              </Text>
              <View style={styles.verifiedBadge}>
                <Icon name="check-circle" size={12} color="#0284C7" style={{ marginRight: 3 }} />
                <Text style={styles.verifiedBadgeText}>Verified</Text>
              </View>
              {item.is_store_active === false && (
                <View style={[styles.verifiedBadge, { backgroundColor: '#FEF2F2' }]}>
                  <Text style={[styles.verifiedBadgeText, { color: '#DC2626' }]}>Closed</Text>
                </View>
              )}
            </View>

            <Text style={styles.directoryAddress} numberOfLines={1}>
              {item.address || item.city || "Store Location"}
            </Text>

            {/* Badges row: Distance + Products Count */}
            <View style={styles.directoryBadgesRow}>
              {itemDistance && (
                <View style={styles.distBadge}>
                  <Icon name="location-arrow" size={11} color="#007AFF" />
                  <Text style={styles.distBadgeText}>{itemDistance}</Text>
                </View>
              )}
              <View style={[styles.prodCountBadge, item.productCount > 0 ? styles.prodCountActive : styles.prodCountEmpty]}>
                <Icon name="shopping-bag" size={11} color={item.productCount > 0 ? "#10B981" : "#94A3B8"} />
                <Text style={[styles.prodCountText, item.productCount > 0 ? styles.prodCountTextActive : styles.prodCountTextEmpty]}>
                  {item.productCount > 0 ? `${item.productCount} Products` : "Catalog"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Store Directory Images Strip */}
        {hasMedia && (
          <View style={styles.dirMediaSection}>
            <ScrollView
              horizontal
              nestedScrollEnabled={true}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dirMediaScroll}
            >
              {item.mediaList
                .filter((m) => m && m.uri)
                .slice(0, 5)
                .map((media, mIdx) => (
                <TouchableOpacity
                  key={`dir-thumb-${item.id}-${mIdx}`}
                  style={styles.dirMediaThumbWrap}
                  activeOpacity={0.85}
                  onPress={() => handleOpenMediaViewer(item, mIdx, item.full_name)}
                >
                  {media.type === "video" ? (
                    <View style={styles.dirVideoThumb}>
                      <View style={styles.dirVideoPlayBadge}>
                        <Text style={styles.dirVideoPlayText}>▶</Text>
                      </View>
                      <Text style={styles.dirVideoLabel}>Video</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: media.uri }} style={styles.dirMediaThumb} resizeMode="cover" />
                  )}
                </TouchableOpacity>
              ))}
              {item.mediaList.length > 5 && (
                <TouchableOpacity
                  style={styles.dirMediaMoreBadge}
                  onPress={() =>
                    safeNavigate("Catalog", {
                      userId: item.id,
                      sellerId: item.id,
                      sellerName: item.full_name,
                    })
                  }
                >
                  <Text style={styles.dirMediaMoreText}>+{item.mediaList.length - 5}</Text>
                  <Text style={styles.dirMediaMoreSub}>more</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {/* Action Buttons Row */}
        <View style={styles.directoryActionsRow}>
          <TouchableOpacity
            style={styles.directoryPrimaryBtn}
            activeOpacity={0.85}
            onPress={() =>
              safeNavigate("Catalog", {
                userId: item.id,
                sellerId: item.id,
                sellerName: item.full_name,
              })
            }
          >
            <Icon name="shopping-bag" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.directoryPrimaryBtnText}>Enter Store</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.directorySecondaryBtn}
            activeOpacity={0.8}
            onPress={() => {
              setSelectedSeller(item);
              setShowDirectory(false);
              sendMapMessage({
                type: "SET_VIEW",
                latitude: item.latitude,
                longitude: item.longitude,
                zoom: 16,
              });
              sendMapMessage({
                type: "OPEN_SELLER",
                sellerId: item.id,
              });
            }}
          >
            <Icon name="map-marker" size={16} color="#007AFF" />
          </TouchableOpacity>

          {item.mobile ? (
            <TouchableOpacity
              style={styles.directorySecondaryBtn}
              activeOpacity={0.8}
              onPress={() => {
                try {
                  Linking.openURL(`tel:${item.mobile}`).catch(() => {});
                } catch (_) {}
              }}
            >
              <Icon name="phone" size={16} color="#475569" />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.directorySecondaryBtn}
            activeOpacity={0.8}
            onPress={() => handleOpenDirections(item.latitude, item.longitude, item.full_name)}
          >
            <Icon name="compass" size={16} color="#475569" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmptyDirectory = () => (
    !loading && (
      <View style={styles.emptyDirectoryContainer}>
        <Icon name="store" size={48} color="#CBD5E1" style={{ marginBottom: 12 }} />
        <Text style={styles.emptyDirectoryTitle}>No Sellers Found</Text>
        <Text style={styles.emptyDirectorySub}>
          {searchQuery.trim().length > 0
            ? `No registered stores match "${searchQuery}".`
            : "No stores currently found for this filter."}
        </Text>
        <TouchableOpacity
          style={styles.emptyClearBtn}
          onPress={() => {
            setSearchQuery("");
            setActiveFilter("all");
          }}
        >
          <Text style={styles.emptyClearBtnText}>View All Sellers</Text>
        </TouchableOpacity>
      </View>
    )
  );

  const renderFilterChips = () => (
    <ScrollView
      horizontal
      nestedScrollEnabled={true}
      showsHorizontalScrollIndicator={false}
      style={styles.filterChipsRow}
    >
      <TouchableOpacity
        style={[styles.chipBtn, activeFilter === "all" && styles.chipBtnActive]}
        onPress={() => setActiveFilter("all")}
      >
        <Text style={[styles.chipText, activeFilter === "all" && styles.chipTextActive]}>
          All Stores ({storeActiveSellers.length})
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chipBtn, activeFilter === "products" && styles.chipBtnActive]}
        onPress={() => setActiveFilter("products")}
      >
        <Icon
          name="shopping-bag"
          size={11}
          color={activeFilter === "products" ? "#FFFFFF" : "#10B981"}
          style={{ marginRight: 4 }}
        />
        <Text style={[styles.chipText, activeFilter === "products" && styles.chipTextActive]}>
          With Products
        </Text>
      </TouchableOpacity>

      {userLocation && (
        <TouchableOpacity
          style={[styles.chipBtn, activeFilter === "nearby" && styles.chipBtnActive]}
          onPress={() => setActiveFilter("nearby")}
        >
          <Icon
            name="location-arrow"
            size={11}
            color={activeFilter === "nearby" ? "#FFFFFF" : "#007AFF"}
            style={{ marginRight: 4 }}
          />
          <Text style={[styles.chipText, activeFilter === "nearby" && styles.chipTextActive]}>
            Nearby (&lt;15 km)
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  const renderDirectoryList = () => (
    <FlatList
      data={displayedSellers}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderSellerDirectoryCard}
      style={[
        styles.directoryFlatList,
        Platform.OS === 'web' ? { overflowY: 'auto' } : null,
      ]}
      contentContainerStyle={[styles.directoryListContent, { flexGrow: 1, paddingBottom: 100 }]}
      showsVerticalScrollIndicator={true}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled={true}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#007AFF"]} />
      }
      ListEmptyComponent={renderEmptyDirectory}
    />
  );

  const renderInteractiveMap = () => (
    <View style={styles.mapContainer}>
      <UniversalWebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: htmlContent, baseUrl: "" }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={onMapMessage}
      />

      {/* Floating Loading Banner */}
      {loading && (
        <View style={styles.mapLoadingBadge}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.mapLoadingText}>Loading nearby sellers...</Text>
        </View>
      )}

      {/* Floating Store Directory Toggle Button (when directory is hidden) */}
      {!showDirectory && (
        <TouchableOpacity
          style={styles.floatingDirectoryToggle}
          onPress={() => setShowDirectory(true)}
          activeOpacity={0.9}
          accessibilityLabel="Browse registered stores"
        >
          <Icon name="list" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.floatingDirectoryToggleText}>
            Browse Stores ({displayedSellers.length})
          </Text>
        </TouchableOpacity>
      )}

      {/* Re-center GPS Location Button */}
      <TouchableOpacity
        style={styles.recenterButton}
        onPress={handleRecenterLocation}
        activeOpacity={0.8}
        accessibilityLabel="Re-center location"
      >
        <Icon name="crosshairs" size={20} color="#007AFF" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Top Header & Search Area */}
      <View style={styles.headerSection}>
        <View style={styles.topBar}>
          {/* Back / Home Button */}
          <TouchableOpacity
            style={styles.roundIconButton}
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate("Welcome");
              }
            }}
            activeOpacity={0.8}
            accessibilityLabel="Home"
          >
            <Icon name={navigation.canGoBack() ? "arrow-left" : "home"} size={16} color="#1E293B" />
          </TouchableOpacity>

          {/* Search Input Box */}
          <View style={styles.searchBox}>
            <Icon name="search" size={15} color="#64748B" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="Search store name, city or items..."
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
              returnKeyType="search"
            />
            {searchLoading && (
              <ActivityIndicator size="small" color="#007AFF" style={styles.searchLoader} />
            )}
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch} style={styles.clearBtn}>
                <Icon name="times-circle" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Store Directory Toggle Button in Header */}
          <TouchableOpacity
            style={[styles.headerDirectoryBtn, showDirectory && styles.headerDirectoryBtnActive]}
            onPress={() => setShowDirectory((prev) => !prev)}
            activeOpacity={0.85}
          >
            <Icon
              name={showDirectory ? "map" : "list"}
              size={13}
              color={showDirectory ? "#FFFFFF" : "#007AFF"}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.headerDirectoryBtnText,
                showDirectory && styles.headerDirectoryBtnTextActive,
              ]}
            >
              {showDirectory ? "Hide Stores" : `Stores (${displayedSellers.length})`}
            </Text>
          </TouchableOpacity>

          {/* Desktop/Tablet Quick Portal Navigation */}
          {isWideScreen && (
            <View style={styles.headerQuickPortals}>
              <TouchableOpacity
                style={styles.quickPortalBtn}
                onPress={() => safeNavigate("Catalog")}
              >
                <Icon name="shopping-cart" size={13} color="#007AFF" style={{ marginRight: 5 }} />
                <Text style={styles.quickPortalBtnText}>Catalog</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickPortalBtn, styles.quickPortalBtnSeller]}
                onPress={() =>
                  safeNavigate(
                    role === "seller" || role === "admin" ? "ProductTabs" : "SellerLogin"
                  )
                }
              >
                <Icon name="home" size={13} color="#10B981" style={{ marginRight: 5 }} />
                <Text style={[styles.quickPortalBtnText, { color: "#10B981" }]}>Seller</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickPortalBtn}
                onPress={() => safeNavigate("Welcome")}
              >
                <Icon name="info-circle" size={13} color="#64748B" style={{ marginRight: 5 }} />
                <Text style={[styles.quickPortalBtnText, { color: "#475569" }]}>About</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Quick Refresh Data Button */}
          <TouchableOpacity
            style={styles.roundIconButton}
            onPress={onRefresh}
            activeOpacity={0.8}
            accessibilityLabel="Refresh Sellers"
          >
            <Icon name="refresh" size={15} color="#007AFF" />
          </TouchableOpacity>

          {/* 3 Horizontal Dots Menu Button */}
          <TouchableOpacity
            style={styles.roundIconButton}
            onPress={() => setIsMenuVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel="Portals Menu"
          >
            <Icon name="ellipsis-h" size={18} color="#1E293B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Auto-suggest Search Dropdown */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionDropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionRow}
                onPress={() => handleSelectSuggestion(item)}
              >
                <View
                  style={[
                    styles.suggestionIconBox,
                    item.type === "seller" ? styles.sellerIconBox : styles.areaIconBox,
                  ]}
                >
                  <Icon
                    name={item.type === "seller" ? "home" : "map-marker"}
                    size={14}
                    color={item.type === "seller" ? "#007AFF" : "#10B981"}
                  />
                </View>
                <View style={styles.suggestionTextContainer}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                <View
                  style={[
                    styles.typeBadge,
                    item.type === "seller" ? styles.sellerBadge : styles.areaBadge,
                  ]}
                >
                  <Text
                    style={[
                      styles.typeBadgeText,
                      item.type === "seller" ? styles.sellerBadgeText : styles.areaBadgeText,
                    ]}
                  >
                    {item.type === "seller" ? "Seller" : "Area"}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* MAIN CONTENT AREA: Full Map by default, or Full Store Directory when toggled (Full Screen across all devices, never 50%/50% split) */}
      {showDirectory ? (
        <View style={styles.mobileDirectoryContainer}>
          <View style={styles.sideFilterHeader}>
            <View style={styles.sideHeaderTopRow}>
              <Text style={styles.sideFilterTitle}>
                Store Directory ({displayedSellers.length})
              </Text>
              <TouchableOpacity
                onPress={() => setShowDirectory(false)}
                style={styles.closeDirectoryBtn}
                accessibilityLabel="Close Directory"
              >
                <Icon name="times" size={15} color="#64748B" />
              </TouchableOpacity>
            </View>
            {renderFilterChips()}
          </View>
          {renderDirectoryList()}
        </View>
      ) : (
        <View style={styles.fullMapPanel}>
          {renderInteractiveMap()}
        </View>
      )}

      {/* 3 Horizontal Dots Menu Modal (Buyer, Seller, Delivery Portals) */}
      {/* 3 Horizontal Dots Menu Modal (Centered Floating Card) */}
      <Modal
        visible={isMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsMenuVisible(false)}
        >
          <View style={styles.menuCard} onStartShouldSetResponder={() => true}>
            <View style={styles.menuHeader}>
              <View style={styles.menuHeaderLeft}>
                <View style={styles.menuHeaderLogoBox}>
                  <Icon name="compass" size={17} color="#007AFF" />
                </View>
                <View>
                  <Text style={styles.menuHeaderTitle}>Needs Tracker</Text>
                  <Text style={styles.menuHeaderSubtitle}>Portals & Quick Navigation</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setIsMenuVisible(false)}
                style={styles.menuCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close menu"
              >
                <Icon name="times" size={14} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.menuScrollView}
              contentContainerStyle={styles.menuScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* If user is logged in, show user profile summary and quick links */}
              {user && (
                <View style={styles.userSection}>
                  <TouchableOpacity
                    style={styles.userProfileRow}
                    activeOpacity={0.7}
                    onPress={() => safeNavigate("Profile")}
                  >
                    <View style={styles.userAvatar}>
                      <Text style={styles.userAvatarText}>
                        {(user.email || user.phone || "U").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userEmail} numberOfLines={1}>
                        {user.email || user.phone || "Signed In User"}
                      </Text>
                      <View style={styles.roleTag}>
                        <Text style={styles.roleTagText}>
                          {role ? role.toUpperCase() : "USER"}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.userQuickLinks}>
                    <TouchableOpacity
                      style={styles.quickLinkItem}
                      onPress={() => safeNavigate("Profile")}
                    >
                      <Icon name="user-circle" size={13} color="#6366F1" />
                      <Text style={styles.quickLinkText}>My Profile</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.quickLinkItem}
                      onPress={() => safeNavigate("OrderList")}
                    >
                      <Icon name="list-alt" size={13} color="#007AFF" />
                      <Text style={styles.quickLinkText}>My Orders</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.quickLinkItem}
                      onPress={() => safeNavigate("Cart")}
                    >
                      <Icon name="shopping-cart" size={13} color="#007AFF" />
                      <Text style={styles.quickLinkText}>My Cart</Text>
                    </TouchableOpacity>

                    {(role === "seller" || role === "admin") && (
                      <TouchableOpacity
                        style={styles.quickLinkItem}
                        onPress={() => safeNavigate("ProductTabs")}
                      >
                        <Icon name="cubes" size={13} color="#10B981" />
                        <Text style={styles.quickLinkText}>Store</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* Role Portals Options: Buyer, Seller, Delivery */}
              <Text style={styles.portalsHeading}>Portals & Access</Text>

              {/* 0. Product Catalog */}
              <TouchableOpacity
                style={styles.portalItem}
                activeOpacity={0.7}
                onPress={() => safeNavigate("Catalog")}
              >
                <View style={[styles.portalIconBox, { backgroundColor: "#F0FDF4" }]}>
                  <Icon name="book" size={17} color="#16A34A" />
                </View>
                <View style={styles.portalDetails}>
                  <Text style={styles.portalTitle}>Product Catalog</Text>
                  <Text style={styles.portalDesc}>Browse all products & shop items</Text>
                </View>
                <Icon name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>

              {/* 1. Buyer Portal */}
              <TouchableOpacity
                style={styles.portalItem}
                activeOpacity={0.7}
                onPress={() => safeNavigate("BuyerLogin")}
              >
                <View style={[styles.portalIconBox, { backgroundColor: "#EFF6FF" }]}>
                  <Icon name="shopping-bag" size={17} color="#007AFF" />
                </View>
                <View style={styles.portalDetails}>
                  <Text style={styles.portalTitle}>Buyer Portal</Text>
                  <Text style={styles.portalDesc}>Browse nearby sellers & place orders</Text>
                </View>
                <Icon name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>

              {/* 2. Seller Portal */}
              <TouchableOpacity
                style={styles.portalItem}
                activeOpacity={0.7}
                onPress={() => safeNavigate("SellerLogin")}
              >
                <View style={[styles.portalIconBox, { backgroundColor: "#ECFDF5" }]}>
                  <Icon name="home" size={17} color="#10B981" />
                </View>
                <View style={styles.portalDetails}>
                  <Text style={styles.portalTitle}>Seller Portal</Text>
                  <Text style={styles.portalDesc}>Manage products, pricing & inventory</Text>
                </View>
                <Icon name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>

              {/* 3. Delivery Manager Portal */}
              <TouchableOpacity
                style={styles.portalItem}
                activeOpacity={0.7}
                onPress={() => safeNavigate("DeliveryManagerLogin")}
              >
                <View style={[styles.portalIconBox, { backgroundColor: "#FAF5FF" }]}>
                  <Icon name="truck" size={16} color="#8B5CF6" />
                </View>
                <View style={styles.portalDetails}>
                  <Text style={styles.portalTitle}>Delivery Portal</Text>
                  <Text style={styles.portalDesc}>Real-time delivery management & tracking</Text>
                </View>
                <Icon name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>

              {/* 4. About & Welcome Page */}
              <TouchableOpacity
                style={styles.portalItem}
                activeOpacity={0.7}
                onPress={() => safeNavigate("Welcome")}
              >
                <View style={[styles.portalIconBox, { backgroundColor: "#F8FAFC" }]}>
                  <Icon name="info-circle" size={17} color="#64748B" />
                </View>
                <View style={styles.portalDetails}>
                  <Text style={styles.portalTitle}>About & Overview</Text>
                  <Text style={styles.portalDesc}>Platform info and features</Text>
                </View>
                <Icon name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>

              {/* Logout Button if signed in */}
              {user && (
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                  <Icon name="sign-out" size={15} color="#EF4444" />
                  <Text style={styles.logoutButtonText}>Log Out</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Browse Store Details Modal (Centered Floating Card) */}
      <Modal
        visible={!!selectedSeller}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedSeller(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedSeller(null)}
        >
          {selectedSeller && (
            <View style={styles.sellerModalCard} onStartShouldSetResponder={() => true}>
              {/* Header */}
              <View style={styles.sellerModalHeader}>
                <View style={styles.sellerModalHeaderLeft}>
                  {selectedSeller.firstPhoto ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() =>
                        handleOpenMediaViewer(
                          selectedSeller,
                          0,
                          selectedSeller.full_name
                        )
                      }
                    >
                      <Image
                        source={{ uri: selectedSeller.firstPhoto }}
                        style={styles.sellerModalAvatarImg}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.sellerModalAvatarBox}>
                      <Text style={styles.sellerModalAvatarLetter}>
                        {(selectedSeller.full_name || "S").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.sellerModalInfo}>
                    <View style={styles.sellerModalTitleRow}>
                      <Text style={styles.sellerModalTitle} numberOfLines={1}>
                        {selectedSeller.full_name || "Seller Store"}
                      </Text>
                      <View style={styles.verifiedTag}>
                        <Icon name="check-circle" size={10} color="#0284C7" style={{ marginRight: 2 }} />
                        <Text style={styles.verifiedTagText}>Seller</Text>
                      </View>
                    </View>
                    <View style={styles.sellerModalSubtitleRow}>
                      <Icon name="map-marker" size={11} color="#64748B" style={{ marginRight: 4 }} />
                      <Text style={styles.sellerModalSubtitle} numberOfLines={1}>
                        {selectedSeller.city || selectedSeller.address || "Verified Store"}
                      </Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => setSelectedSeller(null)}
                  style={styles.menuCloseBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close store popup"
                >
                  <Icon name="times" size={14} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.sellerModalScrollView}
                contentContainerStyle={styles.sellerModalScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Store Photos & Videos Gallery Preview Strip */}
                {selectedSeller.mediaList && selectedSeller.mediaList.length > 0 && (
                  <View style={styles.cardMediaSection}>
                    <Text style={styles.sellerSectionLabel}>Store Photos & Media</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.cardMediaScroll}
                      nestedScrollEnabled={true}
                    >
                      {selectedSeller.mediaList
                        .filter((m) => m && m.uri)
                        .map((media, idx) => (
                          <TouchableOpacity
                            key={`sel-media-${idx}-${media.uri}`}
                            style={styles.cardMediaThumbWrap}
                            activeOpacity={0.85}
                            onPress={() =>
                              handleOpenMediaViewer(
                                selectedSeller,
                                idx,
                                selectedSeller.full_name
                              )
                            }
                          >
                            {media.type === "video" ? (
                              <View style={styles.cardVideoThumbBox}>
                                <View style={styles.cardVideoPlayBadge}>
                                  <Text style={styles.cardVideoPlayIcon}>▶</Text>
                                </View>
                                <View style={styles.cardVideoBadge}>
                                  <Text style={styles.cardVideoBadgeText}>🎥 Video</Text>
                                </View>
                              </View>
                            ) : (
                              <View style={styles.cardPhotoThumbBox}>
                                <Image source={{ uri: media.uri }} style={styles.cardMediaThumb} resizeMode="cover" />
                                <View style={styles.cardPhotoBadge}>
                                  <Text style={styles.cardPhotoBadgeText}>
                                    {idx === 0 ? "Profile" : `Photo ${idx + 1}`}
                                  </Text>
                                </View>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                )}

                {/* Store Badges & Details */}
                <Text style={styles.sellerSectionLabel}>Store Details</Text>
                <View style={styles.sellerMetaRow}>
                  {calculatedDistance && (
                    <View style={styles.metaBadge}>
                      <Icon name="location-arrow" size={12} color="#007AFF" />
                      <Text style={styles.metaBadgeText}>{calculatedDistance} away</Text>
                    </View>
                  )}
                  <View style={[styles.metaBadge, selectedSeller.productCount > 0 && styles.metaBadgeSuccess]}>
                    <Icon name="cubes" size={12} color={selectedSeller.productCount > 0 ? "#10B981" : "#64748B"} />
                    <Text style={[styles.metaBadgeText, selectedSeller.productCount > 0 && styles.metaBadgeTextSuccess]}>
                      {selectedSeller.productCount > 0 ? `${selectedSeller.productCount} Products Available` : "Catalog"}
                    </Text>
                  </View>
                  {selectedSeller.mobile ? (
                    <TouchableOpacity
                      style={styles.metaBadge}
                      onPress={() => {
                        try {
                          Linking.openURL(`tel:${selectedSeller.mobile}`).catch(() => {});
                        } catch (_) {}
                      }}
                    >
                      <Icon name="phone" size={12} color="#64748B" />
                      <Text style={styles.metaBadgeText}>{selectedSeller.mobile}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Action Buttons */}
                <View style={styles.sellerModalActions}>
                  <TouchableOpacity
                    style={styles.primaryActionButton}
                    onPress={() => {
                      const sel = selectedSeller;
                      setSelectedSeller(null);
                      safeNavigate("Catalog", {
                        userId: sel.id,
                        sellerId: sel.id,
                        sellerName: sel.full_name,
                      });
                    }}
                  >
                    <Icon name="shopping-bag" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.primaryActionText}>Browse Store / Catalog</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryActionButton}
                    onPress={() =>
                      handleOpenDirections(
                        selectedSeller.latitude,
                        selectedSeller.longitude,
                        selectedSeller.full_name
                      )
                    }
                    accessibilityLabel="Get Directions"
                  >
                    <Icon name="compass" size={18} color="#1E293B" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen Media Viewer with Horizontal Swipe/Scroll & Thumbnails */}
      <FullScreenImageViewer
        visible={viewerVisible}
        mediaList={viewerMediaList}
        initialIndex={viewerInitialIndex}
        onClose={() => setViewerVisible(false)}
        title={viewerTitle || "Store Media"}
      />

      {/* Persistent Bottom Navigation Footer */}
      <StoreNavigationFooter
        activeTab="stores"
        navigation={navigation}
        route={route}
        forceShow={true}
        onStoresPress={() => {
          if (showDirectory) setShowDirectory(false);
          setSearchQuery("");
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: "100%",
    width: "100%",
    backgroundColor: "#F8FAFC",
    ...(Platform.OS === "web" ? { minHeight: "100vh", width: "100%" } : {}),
  },
  fullMapPanel: {
    flex: 1,
    position: "relative",
    width: "100%",
    height: "100%",
  },
  mobileDirectoryContainer: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#F8FAFC",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
  directoryFlatList: {
    flex: 1,
    width: "100%",
  },
  sideFilterHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  sideHeaderTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sideFilterTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  closeDirectoryBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  headerDirectoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  headerDirectoryBtnActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  headerDirectoryBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#007AFF",
  },
  headerDirectoryBtnTextActive: {
    color: "#FFFFFF",
  },
  floatingDirectoryToggle: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  floatingDirectoryToggleText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  headerQuickPortals: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 4,
    marginRight: 4,
  },
  quickPortalBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  quickPortalBtnSeller: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  quickPortalBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#007AFF",
  },
  headerSection: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 10 : 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 50,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: "#0F172A",
    paddingVertical: 0,
  },
  searchLoader: {
    marginLeft: 6,
  },
  clearBtn: {
    padding: 4,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 8,
  },
  viewToggle: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
  },
  viewToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  viewToggleBtnActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  viewToggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  viewToggleTextActive: {
    color: "#007AFF",
    fontWeight: "700",
  },
  filterChipsRow: {
    flexDirection: "row",
  },
  chipBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  chipBtnActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  chipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  chipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  suggestionDropdown: {
    position: "absolute",
    top: Platform.OS === "ios" ? 110 : 105,
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    zIndex: 100,
    maxHeight: 240,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  suggestionIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  sellerIconBox: {
    backgroundColor: "#EFF6FF",
  },
  areaIconBox: {
    backgroundColor: "#ECFDF5",
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  suggestionSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sellerBadge: {
    backgroundColor: "#EFF6FF",
  },
  areaBadge: {
    backgroundColor: "#ECFDF5",
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  sellerBadgeText: {
    color: "#007AFF",
  },
  areaBadgeText: {
    color: "#10B981",
  },
  mapContainer: {
    flex: 1,
    position: "relative",
    width: "100%",
    height: "100%",
  },
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  mapLoadingBadge: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 30,
  },
  mapLoadingText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E293B",
  },
  recenterButton: {
    position: "absolute",
    right: 16,
    bottom: 200,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 30,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sellerModalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    width: "100%",
    maxWidth: 440,
    maxHeight: Platform.OS === "web" ? "88vh" : "85%",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 16,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  sellerModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  sellerModalHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  sellerModalAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#007AFF",
    backgroundColor: "#F1F5F9",
  },
  sellerModalAvatarBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sellerModalAvatarLetter: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  sellerModalInfo: {
    flex: 1,
  },
  sellerModalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  sellerModalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  sellerModalSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  sellerModalSubtitle: {
    fontSize: 12,
    color: "#64748B",
  },
  sellerModalScrollView: {
    flexGrow: 0,
    width: "100%",
  },
  sellerModalScrollContent: {
    paddingBottom: 8,
  },
  sellerSectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 10,
    marginLeft: 2,
  },
  sellerModalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    paddingTop: 6,
  },
  verifiedTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  verifiedTagText: {
    fontSize: 10,
    color: "#0284C7",
    fontWeight: "700",
  },
  cardMediaSection: {
    marginTop: 12,
    marginBottom: 4,
  },
  cardMediaScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  cardMediaThumbWrap: {
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  cardPhotoThumbBox: {
    position: "relative",
  },
  cardMediaThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  cardPhotoBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cardPhotoBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  cardVideoThumbBox: {
    width: 70,
    height: 70,
    backgroundColor: "#0F172A",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cardVideoPlayBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardVideoPlayIcon: {
    fontSize: 12,
    color: "#007AFF",
    marginLeft: 2,
  },
  cardVideoBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cardVideoBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  sellerMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  metaBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 5,
  },
  metaBadgeSuccess: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  metaBadgeText: {
    fontSize: 11,
    color: "#475569",
    fontWeight: "600",
  },
  metaBadgeTextSuccess: {
    color: "#059669",
  },
  sellerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  primaryActionButton: {
    flex: 1,
    backgroundColor: "#007AFF",
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryActionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryActionButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  directoryListContent: {
    padding: 16,
    paddingBottom: 40,
  },
  directoryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  directoryCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  directoryAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  directoryAvatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    borderWidth: 1.5,
    borderColor: "#007AFF",
    backgroundColor: "#F1F5F9",
  },
  directoryAvatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  directoryInfo: {
    flex: 1,
  },
  directoryNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  directoryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    flex: 1,
    marginRight: 8,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0284C7",
  },
  directoryAddress: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 3,
  },
  directoryBadgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  distBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  distBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#007AFF",
  },
  prodCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  prodCountActive: {
    backgroundColor: "#ECFDF5",
  },
  prodCountEmpty: {
    backgroundColor: "#F1F5F9",
  },
  prodCountText: {
    fontSize: 11,
    fontWeight: "600",
  },
  prodCountTextActive: {
    color: "#059669",
  },
  prodCountTextEmpty: {
    color: "#64748B",
  },
  dirMediaSection: {
    marginTop: 12,
    marginBottom: 4,
  },
  dirMediaScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  dirMediaThumbWrap: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dirMediaThumb: {
    width: 62,
    height: 62,
    borderRadius: 7,
    backgroundColor: "#F1F5F9",
  },
  dirVideoThumb: {
    width: 62,
    height: 62,
    borderRadius: 7,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  dirVideoPlayBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  dirVideoPlayText: {
    fontSize: 10,
    color: "#007AFF",
    marginLeft: 2,
  },
  dirVideoLabel: {
    position: "absolute",
    bottom: 2,
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
  },
  dirMediaMoreBadge: {
    width: 62,
    height: 62,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "center",
    justifyContent: "center",
  },
  dirMediaMoreText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#007AFF",
  },
  dirMediaMoreSub: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  directoryActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  directoryPrimaryBtn: {
    flex: 1,
    backgroundColor: "#007AFF",
    height: 40,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  directoryPrimaryBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  directorySecondaryBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  emptyDirectoryContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyDirectoryTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  emptyDirectorySub: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  emptyClearBtn: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 18,
  },
  emptyClearBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  menuCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    width: "100%",
    maxWidth: 440,
    maxHeight: Platform.OS === "web" ? "88vh" : "85%",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 16,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  menuScrollView: {
    flexGrow: 0,
    width: "100%",
  },
  menuScrollContent: {
    paddingBottom: 8,
  },
  menuHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  menuHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuHeaderLogoBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  menuHeaderTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  menuHeaderSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 1,
  },
  menuCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  userSection: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  userProfileRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  userAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  userInfo: {
    flex: 1,
  },
  userEmail: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  roleTag: {
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  roleTagText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#007AFF",
    letterSpacing: 0.5,
  },
  userQuickLinks: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  quickLinkItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  quickLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  portalsHeading: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
    marginLeft: 2,
  },
  portalItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  portalIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  portalDetails: {
    flex: 1,
  },
  portalTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  portalDesc: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 1,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "#FEF2F2",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    marginTop: 6,
    marginBottom: 4,
  },
  logoutButtonText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "700",
  },
  viewerModalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.94)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  viewerCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 55 : 30,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 100,
  },
  viewerCloseBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  viewerMediaBox: {
    width: "100%",
    height: "80%",
    justifyContent: "center",
    alignItems: "center",
  },
  viewerFullImage: {
    width: "100%",
    height: "100%",
  },
  viewerFullVideo: {
    width: "100%",
    height: "100%",
  },
});
