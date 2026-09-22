import { useFocusEffect } from '@react-navigation/native';
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  Button,
  Alert,
  ScrollView,
  Dimensions,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import Swiper from 'react-native-swiper';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getActiveProductsWithDetails,
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  supabase,
  setSellerProductsActiveStatus,
  ensureUserProfile,
  getCategories,
  getSubcategories,
} from '../services/supabase';
import {
  getGuestCart,
  getPreferredStore,
  setPreferredStore,
  clearPreferredStore,
  getFavoriteProductIds,
  toggleFavoriteProductId,
} from '../services/localStorageService';
import { showAlert } from '../utils/alertUtils';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import StoreQrModal from '../components/StoreQrModal';
import SellerContactShareModal from '../components/SellerContactShareModal';
import { batchFetchSellerContacts } from '../services/sellerContactService';

const { width } = Dimensions.get('window');
const SUBCAT_VIEW_MODE_KEY = '@catalog_subcat_view_mode';

const isImageMedia = (media) => {
  if (!media) return false;
  const type = (media.media_type || media.type || '').toLowerCase();
  const url = media.media_url || media.uri || '';
  if (type === 'video') return false;
  if (type === 'image' || type === 'url' || !type) return true;
  if (type.startsWith('image/')) return true;
  if (typeof url === 'string' && /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url)) return true;
  return true;
};

export const CATALOG_CATEGORIES = [
  { id: 'all', label: 'All Items', icon: 'th-large', code: 'all' },
  { id: 'grocery', label: 'Grocery', icon: 'shopping-basket', code: 'grocery' },
  { id: 'fruits_vegetables', label: 'Fruits & Veg', icon: 'lemon-o', code: 'fruits_vegetables' },
  { id: 'dairy_bakery', label: 'Dairy & Bakery', icon: 'birthday-cake', code: 'dairy_bakery' },
  { id: 'snacks_beverages', label: 'Snacks & Drinks', icon: 'coffee', code: 'snacks_beverages' },
  { id: 'clothing', label: 'Clothing', icon: 'tag', code: 'clothing' },
  { id: 'electronics', label: 'Electronics', icon: 'laptop', code: 'electronics' },
  { id: 'beauty_personal_care', label: 'Beauty & Care', icon: 'heart', code: 'beauty_personal_care' },
  { id: 'home_kitchen', label: 'Home & Kitchen', icon: 'home', code: 'home_kitchen' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'medkit', code: 'pharmacy' },
  { id: 'other', label: 'Other', icon: 'cube', code: 'other' },
];

const CatalogScreen = ({ navigation, route }) => {
  const {
    userId: paramUserId,
    sellerId: paramSellerId,
    customerId: paramCustomerId,
    sellerName: initialSellerName,
    isDirectQr: paramIsDirectQr,
  } = route?.params || {};

  // Active store / seller filter state
  const [activeSellerId, setActiveSellerId] = useState(
    paramSellerId || (initialSellerName ? (paramUserId || paramCustomerId) : null)
  );
  const [activeStoreName, setActiveStoreName] = useState(initialSellerName || null);
  const [storeQrVisible, setStoreQrVisible] = useState(false);

  // Direct QR store mode: When customer accesses directly via QR code
  const [isDirectQr, setIsDirectQr] = useState(() => {
    if (paramIsDirectQr !== undefined) return Boolean(paramIsDirectQr);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const search = window.location?.search || '';
      const hash = window.location?.hash || '';
      return (
        search.includes('directQr=true') ||
        search.includes('qr=1') ||
        (search.includes('sellerId=') && !search.includes('fromMap=true')) ||
        (hash.includes('sellerId=') && !hash.includes('fromMap=true'))
      );
    }
    return false;
  });

  // Sync route params if they change (e.g. user selects a different seller from Map or Welcome)
  React.useEffect(() => {
    const nextSellerId = paramSellerId || (initialSellerName ? (paramUserId || paramCustomerId) : null);
    if (nextSellerId !== undefined) {
      setActiveSellerId(nextSellerId || null);
      setActiveStoreName(initialSellerName || null);
      if (paramIsDirectQr !== undefined) {
        setIsDirectQr(Boolean(paramIsDirectQr));
      }
      if (nextSellerId) {
        setPreferredStore(nextSellerId, initialSellerName || '', paramIsDirectQr);
      }
    }
  }, [paramSellerId, paramUserId, paramCustomerId, initialSellerName, paramIsDirectQr]);

  // Restore preferred store from AsyncStorage if no sellerId was passed in route params
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      (async () => {
        if (!paramSellerId && !activeSellerId) {
          try {
            const pref = await getPreferredStore();
            if (isMounted && pref?.sellerId) {
              setActiveSellerId(pref.sellerId);
              setActiveStoreName(pref.sellerName || null);
              if (pref?.isDirectQr) {
                setIsDirectQr(true);
              }
            }
          } catch (e) {
            console.warn('[CatalogScreen] Error restoring preferred store:', e);
          }
        }
      })();
      return () => {
        isMounted = false;
      };
    }, [paramSellerId, activeSellerId])
  );

  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [catalogCategories, setCatalogCategories] = useState(CATALOG_CATEGORIES);
  const [catalogSubcategories, setCatalogSubcategories] = useState([]);
  const [selectedSubcategory, setSelectedSubcategory] = useState('all');

  // Favorites state
  const [favoriteProductIds, setFavoriteProductIds] = useState([]);

  // Load favorites from local storage
  React.useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const favs = await getFavoriteProductIds();
        if (isMounted && Array.isArray(favs)) {
          setFavoriteProductIds(favs);
        }
      } catch (err) {
        console.warn('[CatalogScreen] Error loading favorites:', err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleToggleFavorite = useCallback(async (productId) => {
    if (!productId) return;
    try {
      const updated = await toggleFavoriteProductId(productId);
      setFavoriteProductIds(updated || []);
    } catch (err) {
      console.warn('[CatalogScreen] Error toggling favorite:', err);
    }
  }, []);

  // Screen orientation & dimensions
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isHorizontalScreen = windowWidth > windowHeight && windowWidth >= 640;

  // Subcategory visibility, view mode, and sidebar state (defaults to 'grid', switchable to 'strip')
  const [isSubcatVisible, setIsSubcatVisible] = useState(true);
  const [subcatViewMode, setSubcatViewMode] = useState('grid'); // 'grid' (default) | 'strip'
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  React.useEffect(() => {
    AsyncStorage.getItem(SUBCAT_VIEW_MODE_KEY)
      .then((saved) => {
        if (saved === 'grid' || saved === 'strip' || saved === 'vertical' || saved === 'horizontal') {
          setSubcatViewMode(saved === 'horizontal' || saved === 'strip' ? 'strip' : 'grid');
        }
      })
      .catch(() => {});
  }, []);

  const handleChangeSubcatViewMode = (mode) => {
    setSubcatViewMode(mode);
    AsyncStorage.setItem(SUBCAT_VIEW_MODE_KEY, mode).catch(() => {});
  };

  // Responsive column count for product grid
  const numColumns = useMemo(() => {
    if (!isHorizontalScreen) return 2;
    if (windowWidth >= 1200) return 4;
    if (windowWidth >= 860) return 3;
    return 2;
  }, [isHorizontalScreen, windowWidth]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState(null);
  const [guestCart, setGuestCart] = useState([]);
  const [isCartModalVisible, setIsCartModalVisible] = useState(false);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('');
  const [isImageViewerVisible, setIsImageViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [viewerTitle, setViewerTitle] = useState('');
  const [updatingCart, setUpdatingCart] = useState(false);
  const [isProductModalVisible, setIsProductModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareProduct, setShareProduct] = useState(null);

  const openShareModal = useCallback((prod) => {
    setShareProduct(prod);
    setShareModalVisible(true);
  }, []);

  const closeShareModal = useCallback(() => {
    setShareModalVisible(false);
    setShareProduct(null);
  }, []);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [selectedVariantFilter, setSelectedVariantFilter] = useState(null);

  React.useEffect(() => {
    let isMounted = true;
    const fetchCatalogData = async () => {
      try {
        const cats = await getCategories(false);
        if (isMounted && cats && cats.length > 0) {
          const mapped = [
            { id: 'all', label: 'All Items', icon: 'th-large', code: 'all' },
            ...cats.map((c) => ({
              id: c.code || c.id,
              dbId: c.id,
              code: c.code || c.id,
              label: c.name,
              icon: c.icon || 'tag',
            })),
          ];
          setCatalogCategories(mapped);
        }
      } catch (err) {
        console.warn('[CatalogScreen] Error fetching categories:', err);
      }
    };
    fetchCatalogData();
    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    let isMounted = true;
    const fetchSubcategoriesData = async () => {
      if (!selectedCategory || selectedCategory === 'all' || selectedCategory === 'favorites') {
        setCatalogSubcategories([]);
        setSelectedSubcategory('all');
        return;
      }
      try {
        const lowerCat = String(selectedCategory).toLowerCase().trim();
        const catObj = catalogCategories.find(
          (c) =>
            (c.id && String(c.id).toLowerCase().trim() === lowerCat) ||
            (c.code && String(c.code).toLowerCase().trim() === lowerCat) ||
            (c.dbId && String(c.dbId).toLowerCase().trim() === lowerCat) ||
            (c.label && String(c.label).toLowerCase().trim() === lowerCat)
        );
        const subs = await getSubcategories(
          catObj?.dbId || (catObj?.id !== 'all' ? catObj?.id : null),
          catObj?.code || catObj?.id || selectedCategory,
          false
        );
        if (isMounted) {
          setCatalogSubcategories(subs || []);
          setSelectedSubcategory('all');
        }
      } catch (err) {
        console.warn('[CatalogScreen] Error fetching subcategories:', err);
      }
    };
    fetchSubcategoriesData();
    return () => {
      isMounted = false;
    };
  }, [selectedCategory, catalogCategories]);


  const getProductCombinations = useCallback((product) => {
    if (!product) return [];
    const rawCombos = product.product_variant_combinations || [];
    if (rawCombos.length > 0) {
      const hasActiveVariants = (product.product_variants || []).some(
        v => (v.name || '').trim() && (v.variant_options || []).length > 0
      );
      if (!hasActiveVariants) {
        // Single item product without variants -> strictly return only 1 default combination
        return [{
          ...rawCombos[0],
          combination_string: 'Default',
          price: rawCombos[0].price || product.amount || 0,
          quantity: rawCombos[0].quantity !== undefined ? rawCombos[0].quantity : 100,
        }];
      }

      // If has variants, deduplicate any repeated combination strings
      const seen = new Set();
      const uniqueCombos = [];
      for (const c of rawCombos) {
        const key = (c.combination_string || '').trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCombos.push(c);
        }
      }
      return uniqueCombos.length > 0 ? uniqueCombos : rawCombos;
    }
    return [{
      id: product.id,
      product_id: product.id,
      combination_string: 'Default',
      price: product.amount || 0,
      quantity: 100,
      sku: '',
    }];
  }, []);

  const quantityMap = useMemo(() => {
    const map = {};
    const items = user ? cart?.cart_items : guestCart;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        const comboId = user 
          ? (item?.product_variant_combinations?.id || item?.product_variant_combination_id)
          : (item?.product_variant_combination_id || item?.product_variant_combinations?.id || item?.id);
        const qty = item?.quantity || 0;
        if (comboId) {
          map[comboId] = (map[comboId] || 0) + qty;
        }
      });
    }
    return map;
  }, [cart, guestCart, user]);

  const productTotalQuantityInCart = useMemo(() => {
    const map = {}; // { productId: total_quantity }
    const items = user ? cart?.cart_items : guestCart;
    if (items && Array.isArray(items)) {
      items.forEach(cartItem => {
        const productId = 
          cartItem?.product_variant_combinations?.products?.id || 
          cartItem?.product_variant_combinations?.product_id ||
          cartItem?.product_id;
        if (productId) {
          if (!map[productId]) {
            map[productId] = 0;
          }
          map[productId] += cartItem.quantity || 0;
        }
      });
    }
    return map;
  }, [cart, guestCart, user]);
  
  const productTotalPriceInCart = useMemo(() => {
    const map = {}; // { productId: total_price }
    const items = user ? cart?.cart_items : guestCart;
    if (items && Array.isArray(items)) {
      items.forEach(cartItem => {
        const productId = 
          cartItem?.product_variant_combinations?.products?.id || 
          cartItem?.product_variant_combinations?.product_id ||
          cartItem?.product_id;
        const price = cartItem?.product_variant_combinations?.price || cartItem?.price || 0;
        const quantity = cartItem?.quantity || 0;
        
        if (productId) {
          if (!map[productId]) {
            map[productId] = 0;
          }
          map[productId] += quantity * price;
        }
      });
    }
    return map;
  }, [cart, guestCart, user]);

  const cartTotals = useMemo(() => {
    let totalItems = 0;
    let totalPrice = 0;
    const items = user ? cart?.cart_items : guestCart;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        const qty = item?.quantity || 0;
        const price = item?.product_variant_combinations?.price || item?.price || 0;
        totalItems += qty;
        totalPrice += qty * price;
      });
    }
    return { totalItems, totalPrice };
  }, [cart, guestCart, user]);

  const getCategoryLabel = useCallback((productType) => {
    if (!productType) return 'General';
    if (productType === 'favorites') return 'Favorites';
    const cat = catalogCategories.find(
      c => (c.id || '').toLowerCase() === productType.toLowerCase() ||
           (c.code || '').toLowerCase() === productType.toLowerCase()
    );
    return cat ? cat.label : productType.charAt(0).toUpperCase() + productType.slice(1);
  }, [catalogCategories]);

  const favoritesCount = useMemo(() => {
    return products.filter((p) =>
      favoriteProductIds.some((id) => String(id) === String(p?.id))
    ).length;
  }, [products, favoriteProductIds]);

  const categoryCounts = useMemo(() => {
    const counts = { all: products.length, favorites: favoritesCount };
    products.forEach((p) => {
      const pType = String(p?.product_type || '').toLowerCase().trim();
      const pCatId = String(p?.category_id || '').toLowerCase().trim();

      const matchedCat = catalogCategories.find(c =>
        (c.id && String(c.id).toLowerCase().trim() === pType) ||
        (c.code && String(c.code).toLowerCase().trim() === pType) ||
        (c.dbId && String(c.dbId).toLowerCase().trim() === pCatId) ||
        (c.label && String(c.label).toLowerCase().trim() === pType)
      );

      if (matchedCat) {
        counts[matchedCat.id] = (counts[matchedCat.id] || 0) + 1;
      } else if (pType) {
        counts[pType] = (counts[pType] || 0) + 1;
      }
      if (pCatId) {
        counts[pCatId] = (counts[pCatId] || 0) + 1;
      }
    });
    return counts;
  }, [products, catalogCategories, favoritesCount]);

  const currentCategoryProducts = useMemo(() => {
    if (selectedCategory === 'favorites') {
      return products.filter((product) =>
        favoriteProductIds.some((id) => String(id) === String(product?.id))
      );
    }
    if (!selectedCategory || selectedCategory === 'all') return products;
    const targetCat = String(selectedCategory).toLowerCase().trim();
    const catObj = catalogCategories.find(
      (c) =>
        (c.id && String(c.id).toLowerCase().trim() === targetCat) ||
        (c.code && String(c.code).toLowerCase().trim() === targetCat) ||
        (c.dbId && String(c.dbId).toLowerCase().trim() === targetCat) ||
        (c.label && String(c.label).toLowerCase().trim() === targetCat)
    );
    const catCode = String(catObj?.code || '').toLowerCase().trim();
    const catDbId = String(catObj?.dbId || '').toLowerCase().trim();
    const catLabel = String(catObj?.label || '').toLowerCase().trim();

    return products.filter((product) => {
      const pType = String(product?.product_type || 'other').toLowerCase().trim();
      const pCatId = String(product?.category_id || '').toLowerCase().trim();
      return (
        pType === targetCat ||
        (catCode && pType === catCode) ||
        (catDbId && pCatId === catDbId) ||
        (catLabel && pType === catLabel) ||
        (targetCat && pCatId === targetCat)
      );
    });
  }, [products, selectedCategory, catalogCategories]);

  const subcategoryCounts = useMemo(() => {
    const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const counts = {};

    currentCategoryProducts.forEach((product) => {
      const pSubId = String(product?.subcategory_id || '').toLowerCase().trim();
      const pSubName = String(product?.subcategory || '').toLowerCase().trim();

      catalogSubcategories.forEach((sub) => {
        const subId = String(sub.id || '').toLowerCase().trim();
        const subCode = String(sub.code || '').toLowerCase().trim();
        const subName = String(sub.name || '').toLowerCase().trim();
        const key = sub.code || sub.id;

        const isMatch =
          (subId && pSubId === subId) ||
          (subCode && (pSubId === subCode || pSubName === subCode || slugify(pSubName) === slugify(subCode))) ||
          (subName && (pSubName === subName || slugify(pSubName) === slugify(subName) || pSubId === subName));

        if (isMatch) {
          counts[key] = (counts[key] || 0) + 1;
        }
      });
    });

    return counts;
  }, [currentCategoryProducts, catalogSubcategories]);

  const filteredProducts = useMemo(() => {
    let result = currentCategoryProducts;

    if (selectedSubcategory && selectedSubcategory !== 'all') {
      const targetSub = String(selectedSubcategory).toLowerCase().trim();
      const subObj = catalogSubcategories.find(
        (s) =>
          (s.id && String(s.id).toLowerCase().trim() === targetSub) ||
          (s.code && String(s.code).toLowerCase().trim() === targetSub) ||
          (s.name && String(s.name).toLowerCase().trim() === targetSub)
      );

      const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

      result = result.filter((product) => {
        const pSubId = String(product?.subcategory_id || '').toLowerCase().trim();
        const pSubName = String(product?.subcategory || '').toLowerCase().trim();

        // 1. Direct match with targetSub
        if (pSubId && pSubId === targetSub) return true;
        if (pSubName && pSubName === targetSub) return true;
        if (pSubName && slugify(pSubName) === slugify(targetSub)) return true;

        // 2. Match using resolved subObj (UUID ID, code slug, or display name)
        if (subObj) {
          const subId = String(subObj.id || '').toLowerCase().trim();
          const subCode = String(subObj.code || '').toLowerCase().trim();
          const subName = String(subObj.name || '').toLowerCase().trim();

          // Match by subcategory UUID ID
          if (subId && pSubId === subId) return true;

          // Match by code slug
          if (subCode) {
            if (pSubId === subCode) return true;
            if (pSubName === subCode) return true;
            if (slugify(pSubName) === slugify(subCode)) return true;
          }

          // Match by display name
          if (subName) {
            if (pSubName === subName) return true;
            if (slugify(pSubName) === slugify(subName)) return true;
            if (pSubId === subName) return true;
          }
        }

        return false;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((product) => {
        const nameMatch = (product?.product_name || '').toLowerCase().includes(query);
        const descMatch = (product?.description || '').toLowerCase().includes(query);
        const typeMatch = (product?.product_type || '').toLowerCase().includes(query);
        const subMatch = (product?.subcategory || '').toLowerCase().includes(query);
        const unitMatch = (product?.unit || '').toLowerCase().includes(query);

        const catObj = catalogCategories.find(c => c.id === (product?.product_type || '').toLowerCase() || c.code === (product?.product_type || '').toLowerCase());
        const catLabelMatch = catObj ? catObj.label.toLowerCase().includes(query) : false;

        const variantMatch = (product?.product_variant_combinations || []).some(
          combo => (combo?.combination_string || '').toLowerCase().includes(query) ||
                   (combo?.sku || '').toLowerCase().includes(query)
        );

        const variantOptionMatch = (product?.product_variants || []).some(
          v => (v.name || '').toLowerCase().includes(query) ||
               (v.variant_options || []).some(opt => {
                 const val = typeof opt === 'string' ? opt : (opt?.value || opt?.name || '');
                 return val.toLowerCase().includes(query);
               })
        );

        return nameMatch || descMatch || typeMatch || subMatch || unitMatch || catLabelMatch || variantMatch || variantOptionMatch;
      });
    }

    return result;
  }, [currentCategoryProducts, searchQuery, selectedSubcategory, catalogCategories, catalogSubcategories]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const fetchUserAndProducts = async () => {
        try {
          setLoading(true);
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (!isMounted) return;
          setUser(currentUser);

          // Check if currentUser is a buyer / customer
          let isCustomer = false;
          if (currentUser) {
            try {
              const profile = await ensureUserProfile(currentUser);
              const r = (profile?.role || currentUser.user_metadata?.role || '').toLowerCase();
              if (isMounted) setUserRole(r);
              isCustomer = r === 'customer' || r === 'buyer';
            } catch (_) {}
          }

          // Determine target seller:
          // Never filter a buyer's catalog by their own buyer user ID!
          let targetSellerId = activeSellerId;
          if (targetSellerId && currentUser && isCustomer && targetSellerId === currentUser.id) {
            targetSellerId = null;
          }

          let data = [];
          if (targetSellerId) {
            data = await getActiveProductsWithDetails(targetSellerId);
          } else {
            data = await getActiveProductsWithDetails();
          }

          if (!isMounted) return;
          setProducts(data || []);

          // Pre-fetch seller contacts for instantaneous 0ms response when user taps Share
          try {
            const sellerIdsToFetch = (data || []).map(p => p.user_id || p.customer_id).filter(Boolean);
            if (targetSellerId) sellerIdsToFetch.push(targetSellerId);
            if (sellerIdsToFetch.length > 0) {
              batchFetchSellerContacts(sellerIdsToFetch).catch(() => {});
            }
          } catch (_) {}

          if (currentUser) {
            const cartData = await getCart(currentUser.id);
            if (isMounted) setCart(cartData);
          } else {
            const guestCartData = await getGuestCart();
            if (isMounted) setGuestCart(guestCartData);
          }
        } catch (fetchErr) {
          console.warn('[CatalogScreen] Error fetching products or cart:', fetchErr);
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      fetchUserAndProducts();

      return () => {
        isMounted = false;
      };
    }, [activeSellerId])
  );

  const formatCombinationTitle = useCallback((combinationString, product) => {
    if (!combinationString || combinationString === 'Default') {
      return product?.product_name ? `${product.product_name} (Standard)` : 'Standard Option';
    }
    const parts = combinationString.split(',').map(p => p.trim()).filter(Boolean);
    return parts.map(part => {
      const colonIdx = part.indexOf(':');
      if (colonIdx > -1) {
        return part.substring(colonIdx + 1).trim();
      }
      return part;
    }).join(' • ');
  }, []);

  const openProductModal = (product) => {
    setSelectedProduct(product);
    setSelectedVariantFilter(null);
    const variants = product?.product_variants || [];
    if (variants.length > 0) {
      const defaultVars = {};
      variants.forEach((v) => {
        const vName = v.name || v.variant_name;
        if (vName && v.variant_options && v.variant_options.length > 0) {
          const firstOpt = v.variant_options[0];
          const val = typeof firstOpt === 'string' ? firstOpt : (firstOpt.value || firstOpt.name || '');
          defaultVars[vName] = val;
        }
      });
      setSelectedVariants(defaultVars);
    } else {
      const combos = getProductCombinations(product);
      if (combos.length > 0 && combos[0].combination_string && combos[0].combination_string !== 'Default') {
        const parts = combos[0].combination_string.split(',');
        const defaultVars = {};
        parts.forEach(part => {
          const [k, v] = part.split(':');
          if (k && v) {
            defaultVars[k.trim()] = v.trim();
          }
        });
        setSelectedVariants(defaultVars);
      } else {
        setSelectedVariants({});
      }
    }
    setIsProductModalVisible(true);
  };

  const closeProductModal = () => {
    setSelectedProduct(null);
    setSelectedVariants({});
    setSelectedVariantFilter(null);
    setIsProductModalVisible(false);
  };

  const getSelectedCombination = useCallback(() => {
    if (!selectedProduct) return null;
    const combos = getProductCombinations(selectedProduct);
    if (combos.length === 0) {
      return { id: selectedProduct.id, combination_string: 'Default', price: selectedProduct.amount || 0, quantity: 100 };
    }
    if (combos.length === 1) {
      return combos[0];
    }

    const variantKeys = Object.keys(selectedVariants).filter(k => selectedVariants[k]);
    if (variantKeys.length === 0) {
      return combos[0];
    }

    const sortedKeys = [...variantKeys].sort();
    const combinationString = sortedKeys
      .map((key) => `${key}:${selectedVariants[key]}`)
      .join(',');
    const normalizedCombinationString = combinationString.replace(/\s/g, '').toLowerCase();

    let found = combos.find((c) => {
      if (c.combination_string) {
        const normalizedDbString = c.combination_string.replace(/\s/g, '').toLowerCase();
        return normalizedDbString === normalizedCombinationString;
      }
      return false;
    });

    if (!found) {
      found = combos.find((c) => {
        if (!c.combination_string) return false;
        const dbNormalized = c.combination_string.replace(/\s/g, '').toLowerCase();
        return variantKeys.every(k => {
          const pair = `${k.toLowerCase()}:${String(selectedVariants[k]).toLowerCase().trim()}`;
          return dbNormalized.includes(pair);
        });
      });
    }

    return found || combos[0];
  }, [selectedProduct, selectedVariants, getProductCombinations]);

  const handleUpdateCart = async (product, combinationId, change) => {
    if (updatingCart) return;
    setUpdatingCart(true);

    const combos = getProductCombinations(product);
    const combination = combos.find(c => c.id === combinationId) || combos[0];
    const targetCombinationId = combination?.id || combinationId || product.id;

    // --- Get fresh data ---
    let freshCart;
    let freshGuestCart;
    let freshUser;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        freshUser = user;
        if (user) {
            freshCart = await getCart(user.id);
        } else {
            freshGuestCart = await getGuestCart();
        }
    } catch(e) {
        console.error("Error fetching fresh cart data:", e);
        setUpdatingCart(false);
        return;
    }
    
    const items = freshUser ? freshCart?.cart_items : freshGuestCart;
    const localQuantityMap = {};
    if (items) {
      items.forEach(item => {
        const comboId = freshUser 
          ? (item.product_variant_combinations?.id || item.product_variant_combination_id) 
          : (item.product_variant_combination_id || item.product_variant_combinations?.id || item.id);
        const qty = item.quantity || 0;
        if (comboId) localQuantityMap[comboId] = (localQuantityMap[comboId] || 0) + qty;
      });
    }
    // --- End get fresh data ---

    const currentQuantity = localQuantityMap[targetCombinationId] || 0;
    const newQuantity = currentQuantity + change;

    if (newQuantity < 0) {
        setUpdatingCart(false);
        return;
    }

    const stock = combination.quantity !== undefined && combination.quantity !== null ? combination.quantity : 100; 

    if (change > 0 && stock > 0 && currentQuantity >= stock) {
        showAlert("Stock Limit", `Sorry, you can only add up to ${stock} items.`);
        setUpdatingCart(false);
        return;
    }

    if (freshUser) {
        try {
            const originalCartItem = (freshCart?.cart_items || []).find(item => 
              (item.product_variant_combinations?.id === targetCombinationId) ||
              (item.product_variant_combination_id === targetCombinationId) ||
              (item.id === targetCombinationId)
            );
            if (newQuantity > 0) {
                if (originalCartItem) {
                    await updateCartItem(originalCartItem.id, newQuantity);
                } else {
                    await addToCart(freshUser.id, targetCombinationId, newQuantity);
                }
            } else {
                if (originalCartItem) {
                    await removeCartItem(originalCartItem.id);
                }
            }
            const finalCartData = await getCart(freshUser.id);
            setCart(finalCartData);
        } catch (error) {
            console.error("Error updating cart:", error);
            showAlert("Error", `There was a problem updating your cart: ${error.message}`);
        } finally {
            setUpdatingCart(false);
        }
    } else {
        // Guest user logic
        const optimisticGuestCart = JSON.parse(JSON.stringify(freshGuestCart || []));
        const itemIndex = optimisticGuestCart.findIndex(item => 
          item.product_variant_combination_id === targetCombinationId ||
          item.id === targetCombinationId ||
          item.product_variant_combinations?.id === targetCombinationId
        );

        if (newQuantity > 0) {
            if (itemIndex > -1) {
                optimisticGuestCart[itemIndex].quantity = newQuantity;
            } else {
                optimisticGuestCart.push({
                    id: targetCombinationId,
                    product_variant_combination_id: targetCombinationId,
                    combination_string: combination.combination_string,
                    quantity: newQuantity,
                    price: combination.price || product.amount || 0,
                    product_name: product.product_name,
                    product_variant_combinations: { 
                        ...combination, 
                        products: { 
                          id: product.id, 
                          product_name: product.product_name, 
                          product_media: product.product_media 
                        } 
                    }
                });
            }
        } else {
            if (itemIndex > -1) {
                optimisticGuestCart.splice(itemIndex, 1);
            }
        }
        setGuestCart(optimisticGuestCart);
        try {
            await AsyncStorage.setItem('guest_cart', JSON.stringify(optimisticGuestCart));
        } catch (error) {
            console.error("Error updating guest cart:", error);
            showAlert("Error", "There was a problem updating your cart.");
            setGuestCart(freshGuestCart); // set back to original fresh state on error
        } finally {
            setUpdatingCart(false);
        }
    }
  };

  const handleUpdateQuantity = async (cartItemId, newQuantity) => {
    if (updatingCart) return;

    const items = user ? cart?.cart_items : guestCart;
    const itemToUpdate = items.find(item => (user ? item.id : item.product_variant_combination_id) === cartItemId);

    if (!itemToUpdate) return;
    
    const stock = itemToUpdate.product_variant_combinations?.quantity || 100;
    if (newQuantity > stock) {
        showAlert("Stock Limit", `Sorry, you can only have up to ${stock} items in your cart.`);
        return;
    }
    
    if (newQuantity < 1) {
      handleRemoveItem(cartItemId);
      return;
    }

    setUpdatingCart(true);

    if (user) {
        try {
            await updateCartItem(cartItemId, newQuantity);
            const finalCartData = await getCart(user.id);
            setCart(finalCartData);
        } catch (error) {
            console.error("Error updating cart quantity:", error);
            showAlert("Error", "Could not update item quantity.");
        } finally {
            setUpdatingCart(false);
        }
    } else {
        const optimisticGuestCart = JSON.parse(JSON.stringify(guestCart));
        const itemIndex = optimisticGuestCart.findIndex(item => item.product_variant_combination_id === cartItemId);
        if (itemIndex === -1) {
            setUpdatingCart(false);
            return;
        }
        optimisticGuestCart[itemIndex].quantity = newQuantity;
        setGuestCart(optimisticGuestCart);
        try {
            await AsyncStorage.setItem('guest_cart', JSON.stringify(optimisticGuestCart));
        } catch (error) {
            console.error("Error updating guest cart quantity:", error);
            showAlert("Error", "Could not update item quantity.");
            setGuestCart(guestCart);
        } finally {
            setUpdatingCart(false);
        }
    }
  };

  const handleRemoveItem = (cartItemId) => {
    showAlert(
      "Remove Item",
      "Are you sure you want to remove this item from your cart?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (updatingCart) return;
            setUpdatingCart(true);

            if (user) {
                try {
                    await removeCartItem(cartItemId);
                    const finalCartData = await getCart(user.id);
                    setCart(finalCartData);
                } catch (error) {
                    console.error("Error removing item:", error);
                    showAlert("Error", "Could not remove item from cart.");
                } finally {
                    setUpdatingCart(false);
                }
            } else {
                const optimisticGuestCart = guestCart.filter(item => item.product_variant_combination_id !== cartItemId);
                setGuestCart(optimisticGuestCart);
                try {
                    await AsyncStorage.setItem('guest_cart', JSON.stringify(optimisticGuestCart));
                } catch (error) {
                    console.error("Error removing guest item:", error);
                    showAlert("Error", "Could not remove item from cart.");
                    setGuestCart(guestCart);
                } finally {
                    setUpdatingCart(false);
                }
            }
          },
        },
      ]
    );
  };

  const openImageViewer = (product, initialIndex = 0) => {
    const catalogList = (filteredProducts && filteredProducts.length > 0) ? filteredProducts : (products || []);
    let allMedia = [];
    let targetIdx = 0;
    let foundTarget = false;

    catalogList.forEach((p) => {
      const pMedia = (p?.product_media || []).filter(m => isImageMedia(m) && (m.media_url || m.uri));
      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          if (!foundTarget && String(p.id) === String(product?.id) && mIdx === initialIndex) {
            targetIdx = allMedia.length;
            foundTarget = true;
          }
          allMedia.push({
            id: `p-${p.id}-m-${mIdx}`,
            productId: p.id,
            uri: m.media_url || m.uri,
            type: 'image',
            title: pMedia.length > 1 ? `${p.product_name} (${mIdx + 1}/${pMedia.length})` : p.product_name,
            subtitle: p.amount ? `₹${p.amount}` : null,
          });
        });
      } else if (p.image_url) {
        if (!foundTarget && String(p.id) === String(product?.id)) {
          targetIdx = allMedia.length;
          foundTarget = true;
        }
        allMedia.push({
          id: `p-${p.id}-img`,
          productId: p.id,
          uri: p.image_url,
          type: 'image',
          title: p.product_name,
          subtitle: p.amount ? `₹${p.amount}` : null,
        });
      }
    });

    if (!foundTarget && product) {
      const pMedia = (product?.product_media || []).filter(m => isImageMedia(m) && (m.media_url || m.uri));
      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          if (!foundTarget && mIdx === initialIndex) {
            targetIdx = allMedia.length;
            foundTarget = true;
          }
          allMedia.push({
            id: `p-${product.id}-m-${mIdx}`,
            productId: product.id,
            uri: m.media_url || m.uri,
            type: 'image',
            title: pMedia.length > 1 ? `${product.product_name} (${mIdx + 1}/${pMedia.length})` : product.product_name,
            subtitle: product.amount ? `₹${product.amount}` : null,
          });
        });
      } else if (product.image_url) {
        targetIdx = allMedia.length;
        foundTarget = true;
        allMedia.push({
          id: `p-${product.id}-img`,
          productId: product.id,
          uri: product.image_url,
          type: 'image',
          title: product.product_name,
          subtitle: product.amount ? `₹${product.amount}` : null,
        });
      }
    }

    if (allMedia.length > 0) {
      setViewerImages(allMedia);
      setViewerInitialIndex(targetIdx);
      setViewerTitle(product?.product_name || 'Product Images');
      setIsImageViewerVisible(true);
    }
  };

  const getPriceDisplay = (product) => {
    if (!product) return '₹0';
    const combos = getProductCombinations(product);
    if (combos && combos.length > 1) {
      const prices = combos.map(p => p?.price || 0);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      if (minPrice === maxPrice) {
        return `₹${minPrice}`;
      }
      return `₹${minPrice} - ₹${maxPrice}`;
    }
    if (combos && combos.length === 1) {
      return `₹${combos[0]?.price || 0}`;
    }
    return `₹${product.amount || 0}`;
  };

  const renderProduct = ({ item }) => {
    if (!item) return null;
    const isFav = favoriteProductIds.some((id) => String(id) === String(item.id));
    const combos = getProductCombinations(item);
    const isMultiVariant = combos.length > 1;
    const singleCombo = combos[0];
    const singleComboId = singleCombo?.id;
    const singleComboQty = quantityMap[singleComboId] || 0;
    const totalQuantity = productTotalQuantityInCart[item.id] || singleComboQty || 0;
    const totalStock = combos.reduce((sum, combo) => sum + (combo?.quantity || 0), 0);
    const firstMedia = (item.product_media || []).find(m => isImageMedia(m) && (m.media_url || m.uri));
    const imageUrl = firstMedia ? (firstMedia.media_url || firstMedia.uri) : (item.image_url || null);

    return (
      <View style={[styles.productContainer, isHorizontalScreen && { maxWidth: `${100 / numColumns}%` }]}>
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            onPress={() => (imageUrl ? openImageViewer(item, 0) : openProductModal(item))}
            activeOpacity={0.8}
            accessibilityLabel={`View full image for ${item.product_name || 'Product'}`}
          >
            {imageUrl ? (
              <Image 
                style={styles.productImage} 
                source={{ uri: imageUrl }} 
                resizeMode="cover"
              />
            ) : (
              <View style={styles.productImagePlaceholder}>
                <Icon name="shopping-bag" size={32} color="#94a3b8" />
              </View>
            )}
          </TouchableOpacity>

          {/* Top action buttons: Share (Highlight Mode) & Favorite */}
          <View style={styles.cardTopActions}>
            <TouchableOpacity
              style={[styles.cardShareBtn, styles.cardShareBtnHighlight]}
              onPress={(e) => {
                e?.stopPropagation?.();
                openShareModal(item);
              }}
              activeOpacity={0.75}
              accessibilityLabel="Share product & contact seller"
            >
              <Icon name="share-alt" size={13} color="#0284C7" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cardFavoriteBtn, isFav && styles.cardFavoriteBtnActive]}
              onPress={(e) => {
                e?.stopPropagation?.();
                handleToggleFavorite(item.id);
              }}
              activeOpacity={0.7}
              accessibilityLabel={isFav ? "Remove from favorites" : "Add to favorites"}
            >
              <Icon
                name={isFav ? "heart" : "heart-o"}
                size={15}
                color={isFav ? "#EF4444" : "#64748B"}
              />
            </TouchableOpacity>
          </View>

          {imageUrl && (
            <TouchableOpacity
              style={styles.cardZoomBtn}
              onPress={(e) => {
                e?.stopPropagation?.();
                openImageViewer(item, 0);
              }}
              activeOpacity={0.8}
              accessibilityLabel="View full image"
            >
              <Icon name="search-plus" size={13} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.productDetails}>
          {item.product_type || item.subcategory ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
              {item.product_type ? (
                <View style={styles.cardCategoryTag}>
                  <Text style={styles.cardCategoryTagText}>{getCategoryLabel(item.product_type)}</Text>
                </View>
              ) : null}
              {item.subcategory ? (
                <View style={[styles.cardCategoryTag, { backgroundColor: '#ECFDF5' }]}>
                  <Text style={[styles.cardCategoryTagText, { color: '#059669' }]}>{item.subcategory}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <TouchableOpacity onPress={() => openProductModal(item)}>
            <Text style={styles.productName} numberOfLines={2}>{item.product_name || ''}</Text>
          </TouchableOpacity>
          <Text style={styles.productPrice}>{getPriceDisplay(item)}</Text>
          <Text style={styles.stockText}>
            In Stock: {totalStock} {item.unit || ''}
          </Text>
        </View>

        {isMultiVariant ? (
          <TouchableOpacity 
            style={[styles.addButton, totalQuantity > 0 && styles.addButtonActive]} 
            onPress={() => openProductModal(item)}
          >
            <Text style={[styles.addButtonText, totalQuantity > 0 && styles.addButtonTextActive]}>
              {totalQuantity > 0 ? `Qty: ${totalQuantity} (Options)` : '+ ADD (Options)'}
            </Text>
          </TouchableOpacity>
        ) : (
          totalQuantity > 0 ? (
            <View style={styles.cardQuantityContainer}>
              <TouchableOpacity 
                style={styles.cardQtyBtnMinus}
                onPress={() => handleUpdateCart(item, singleComboId, -1)} 
                disabled={updatingCart}
              >
                <Icon name="minus" size={14} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.cardQtyText}>{totalQuantity}</Text>
              <TouchableOpacity 
                style={styles.cardQtyBtnPlus}
                onPress={() => handleUpdateCart(item, singleComboId, 1)} 
                disabled={updatingCart}
              >
                <Icon name="plus" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.addButton} 
              onPress={() => handleUpdateCart(item, singleComboId, 1)}
              disabled={updatingCart}
            >
              <Icon name="plus" size={12} color="#2E7D32" style={{ marginRight: 6 }} />
              <Text style={styles.addButtonText}>ADD</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  };

  const renderCartItem = ({ item }) => {
    if (!item) return null;
    const cartItemId = user ? item.id : item.product_variant_combination_id;
    const combo = item.product_variant_combinations;
    const prod = combo?.products;
    const prodMedia = prod?.product_media;
    const mediaUrl = (Array.isArray(prodMedia) && prodMedia.length > 0)
      ? (prodMedia.find(m => m?.media_url)?.media_url || prodMedia[0]?.media_url)
      : (prod?.image_url || item.image_url || null);

    return (
        <View style={styles.itemContainer}>
        {mediaUrl ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openImageViewer(prod || { id: item.id, product_name: item.name || 'Product', image_url: mediaUrl }, 0)}
          >
            <Image
                style={styles.itemImage}
                source={{ uri: mediaUrl }}
                resizeMode="cover"
            />
          </TouchableOpacity>
        ) : (
          <View style={[styles.itemImage, { backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' }]}>
            <Icon name="shopping-bag" size={20} color="#94a3b8" />
          </View>
        )}
        <View style={styles.itemDetails}>
            <Text style={styles.itemName}>{prod?.product_name || 'Product'}</Text>
            <Text style={styles.itemVariant}>{combo?.combination_string || ''}</Text>
            <Text style={styles.itemPrice}>₹{combo?.price || 0}</Text>
            <View style={styles.quantityContainer}>
            <TouchableOpacity onPress={() => handleUpdateQuantity(cartItemId, item.quantity - 1)} disabled={updatingCart}>
                <Icon name="minus-circle" size={24} color="#E53935" />
            </TouchableOpacity>
            <Text style={styles.quantityText}>{item.quantity}</Text>
            <TouchableOpacity onPress={() => handleUpdateQuantity(cartItemId, item.quantity + 1)} disabled={updatingCart}>
                <Icon name="plus-circle" size={24} color="#43A047" />
            </TouchableOpacity>
            </View>
        </View>
        <TouchableOpacity onPress={() => handleRemoveItem(cartItemId)} disabled={updatingCart} style={{ padding: 10 }}>
            <Icon name="trash" size={22} color="#E53935" />
        </TouchableOpacity>
        </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#007AFF" /></View>;
  }

  const renderEmptySearchComponent = () => {
    if (loading) return null;

    if (selectedCategory === 'favorites') {
      return (
        <View style={styles.emptySearchContainer}>
          <Icon name="heart-o" size={44} color="#FDA4AF" style={{ marginBottom: 12 }} />
          <Text style={styles.emptySearchTitle}>
            {searchQuery.trim() ? `No favorites matching "${searchQuery}"` : 'No favorite products yet'}
          </Text>
          <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 16, paddingHorizontal: 20 }}>
            {searchQuery.trim()
              ? 'Try a different search term or reset filters.'
              : 'Tap the heart icon on any product to save it here for quick access!'}
          </Text>
          <TouchableOpacity
            style={[styles.clearSearchBtn, { backgroundColor: '#EF4444', borderColor: '#EF4444' }]}
            onPress={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
          >
            <Text style={[styles.clearSearchBtnText, { color: '#FFFFFF' }]}>Browse All Products</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptySearchContainer}>
        <Icon name="search" size={40} color="#ccc" style={{ marginBottom: 12 }} />
        <Text style={styles.emptySearchTitle}>
          {searchQuery.trim() || selectedCategory !== 'all'
            ? `No products found matching ${searchQuery.trim() ? `"${searchQuery}"` : ''} ${selectedCategory !== 'all' ? `in category "${getCategoryLabel(selectedCategory)}"` : ''}`
            : activeStoreName
            ? `No products currently listed for "${activeStoreName}".`
            : 'No products available in catalog'}
        </Text>
        {(searchQuery.trim().length > 0 || selectedCategory !== 'all' || (activeSellerId && !isDirectQr)) && (
          <TouchableOpacity
            style={styles.clearSearchBtn}
            onPress={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              if (!isDirectQr) {
                setActiveSellerId(null);
                setActiveStoreName(null);
              }
            }}
          >
            <Text style={styles.clearSearchBtnText}>
              {activeSellerId && !isDirectQr ? 'Browse All Products' : 'Reset Filters'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const cartItems = user ? cart?.cart_items : guestCart;

  return (
    <View
      style={[
        styles.mainContainer,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity
            style={{ marginRight: 12, padding: 4 }}
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                try {
                  navigation.navigate('SellersMap');
                } catch (_) {
                  navigation.navigate('Welcome');
                }
              }
            }}
          >
            <Icon name="arrow-left" size={20} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {activeStoreName ? activeStoreName : 'Product Catalog'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Quick Favorites Header Button */}
          <TouchableOpacity
            style={{ marginRight: 15, padding: 4 }}
            onPress={() => {
              setSelectedCategory((prev) => (prev === 'favorites' ? 'all' : 'favorites'));
              setSelectedSubcategory('all');
            }}
            accessibilityLabel="Favorites Filter"
          >
            <View style={{ position: 'relative' }}>
              <Icon
                name={selectedCategory === 'favorites' ? 'heart' : 'heart-o'}
                size={20}
                color={selectedCategory === 'favorites' ? '#EF4444' : '#475569'}
              />
              {favoritesCount > 0 && selectedCategory !== 'favorites' && (
                <View style={styles.headerFavBadge}>
                  <Text style={styles.headerFavBadgeText}>
                    {favoritesCount > 99 ? '99+' : favoritesCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {user && (userRole === 'seller' || userRole === 'admin' || userRole === 'superadmin') && (
            <TouchableOpacity
              style={{ marginRight: 15, padding: 4 }}
              onPress={() => navigation.navigate('CatalogManagement', { fromTab: 'store', sellerId: activeSellerId, customerId: paramCustomerId })}
              accessibilityLabel="Catalog Manager"
            >
              <Icon name="tags" size={19} color="#007AFF" />
            </TouchableOpacity>
          )}
          {user && (
            <TouchableOpacity
              style={{ marginRight: 15, padding: 4 }}
              onPress={() => navigation.navigate('Profile')}
              accessibilityLabel="Profile"
            >
              <Icon name="user-circle" size={20} color="#007AFF" />
            </TouchableOpacity>
          )}
          {user && (
            <TouchableOpacity
              style={{ marginRight: 15 }}
              onPress={() => {
                showAlert('Logout', 'Are you sure you want to log out?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Logout',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await supabase.auth.signOut();
                        if (navigation.canGoBack()) {
                          navigation.goBack();
                        } else {
                          try {
                            navigation.navigate('Welcome');
                          } catch (_) {
                            navigation.navigate('SellersMap');
                          }
                        }
                      } catch (err) {
                        console.error('Logout error in CatalogScreen:', err);
                      }
                    },
                  },
                ]);
              }}
            >
              <Icon name="sign-out" size={20} color="#EF4444" />
            </TouchableOpacity>
          )}
          {(!isDirectQr || navigation.canGoBack()) && (
            <TouchableOpacity
              style={{ padding: 4 }}
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else if (!isDirectQr) {
                  try {
                    navigation.navigate('SellersMap');
                  } catch (_) {
                    navigation.navigate('Welcome');
                  }
                }
              }}
              accessibilityLabel={navigation.canGoBack() ? 'Go Back' : 'Close'}
            >
              <Icon name={navigation.canGoBack() ? 'arrow-left' : 'close'} size={22} color="#333" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Store Filter Active Banner */}
      {(activeStoreName || activeSellerId) && (
        <View style={[styles.storeFilterBanner, isDirectQr && styles.directStoreBanner]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <Icon
              name="shopping-bag"
              size={13}
              color={isDirectQr ? '#059669' : '#007AFF'}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[styles.storeFilterText, isDirectQr && styles.directStoreFilterText]}
              numberOfLines={1}
            >
              Store: <Text style={{ fontWeight: '700' }}>{activeStoreName || 'Selected Store'}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* When accessed directly via QR code: Hide Store QR & Hide View All */}
            {isDirectQr ? (
              <View style={styles.directStoreBadge}>
                <Icon name="check-circle" size={11} color="#059669" style={{ marginRight: 4 }} />
                <Text style={styles.directStoreBadgeText}>Direct Store</Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.storeQrBannerBtn}
                  onPress={() => setStoreQrVisible(true)}
                  activeOpacity={0.7}
                >
                  <Icon name="qrcode" size={12} color="#007AFF" style={{ marginRight: 4 }} />
                  <Text style={styles.storeQrBannerText}>Store QR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.clearStoreFilterBtn}
                  onPress={async () => {
                    setActiveSellerId(null);
                    setActiveStoreName(null);
                    await clearPreferredStore();
                  }}
                >
                  <Text style={styles.clearStoreFilterText}>View All</Text>
                  <Icon name="times" size={11} color="#007AFF" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}


      {isHorizontalScreen ? (
        /* Horizontal / Wide Screen Layout: Left Vertical Sidebar + Right Product Grid */
        <View style={styles.bodyContentRow}>
          {/* Left Vertical Sidebar */}
          {isSidebarVisible ? (
            <View style={styles.sidebarContainer}>
              <View style={styles.sidebarHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="bars" size={13} color="#1E293B" style={{ marginRight: 8 }} />
                  <Text style={styles.sidebarTitle}>Categories</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsSidebarVisible(false)}
                  style={styles.sidebarCollapseBtn}
                  activeOpacity={0.7}
                  accessibilityLabel="Collapse Categories Sidebar"
                >
                  <Icon name="chevron-left" size={12} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.sidebarScroll}
                contentContainerStyle={styles.sidebarScrollContent}
                showsVerticalScrollIndicator={true}
              >
                {/* Favorites Sidebar Item */}
                <View style={styles.sidebarCategoryGroup}>
                  <TouchableOpacity
                    style={[
                      styles.sidebarCategoryRow,
                      selectedCategory === 'favorites' && { backgroundColor: '#EF4444' },
                    ]}
                    onPress={() => {
                      setSelectedCategory(selectedCategory === 'favorites' ? 'all' : 'favorites');
                      setSelectedSubcategory('all');
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
                      <Icon
                        name="heart"
                        size={12}
                        color={selectedCategory === 'favorites' ? '#FFFFFF' : '#EF4444'}
                        style={{ marginRight: 8, width: 16, textAlign: 'center' }}
                      />
                      <Text
                        style={[
                          styles.sidebarCategoryLabel,
                          selectedCategory === 'favorites' && styles.sidebarCategoryLabelSelected,
                        ]}
                        numberOfLines={1}
                      >
                        Favorites
                      </Text>
                    </View>
                    {favoritesCount > 0 && (
                      <View
                        style={[
                          styles.sidebarBadge,
                          {
                            backgroundColor:
                              selectedCategory === 'favorites' ? 'rgba(255, 255, 255, 0.3)' : '#FEE2E2',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sidebarBadgeText,
                            { color: selectedCategory === 'favorites' ? '#FFFFFF' : '#EF4444' },
                          ]}
                        >
                          {favoritesCount}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {catalogCategories.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  const count = categoryCounts[cat.id] || 0;
                  if (cat.id !== 'all' && count === 0 && !isSelected) return null;

                  return (
                    <View key={cat.id} style={styles.sidebarCategoryGroup}>
                      <TouchableOpacity
                        style={[
                          styles.sidebarCategoryRow,
                          isSelected && styles.sidebarCategoryRowSelected,
                        ]}
                        onPress={() => {
                          setSelectedCategory(cat.id === selectedCategory ? 'all' : cat.id);
                          setSelectedSubcategory('all');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
                          <Icon
                            name={cat.icon || 'tag'}
                            size={12}
                            color={isSelected ? '#FFFFFF' : '#475569'}
                            style={{ marginRight: 8, width: 16, textAlign: 'center' }}
                          />
                          <Text
                            style={[
                              styles.sidebarCategoryLabel,
                              isSelected && styles.sidebarCategoryLabelSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {cat.label}
                          </Text>
                        </View>
                        {count > 0 && (
                          <View style={[styles.sidebarBadge, isSelected && styles.sidebarBadgeSelected]}>
                            <Text style={[styles.sidebarBadgeText, isSelected && styles.sidebarBadgeTextSelected]}>
                              {count}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      {/* Subcategories nested vertically under active category */}
                      {isSelected && catalogSubcategories && catalogSubcategories.length > 0 && (
                        <View style={styles.sidebarSubcatContainer}>
                          <View style={styles.sidebarSubcatControlRow}>
                            <Text style={styles.sidebarSubcatHeaderTitle}>
                              Subcategories ({catalogSubcategories.length})
                            </Text>
                            <TouchableOpacity
                              onPress={() => setIsSubcatVisible((prev) => !prev)}
                              style={styles.sidebarSubcatToggleBtn}
                              activeOpacity={0.7}
                            >
                              <Icon
                                name={isSubcatVisible ? 'chevron-up' : 'chevron-down'}
                                size={10}
                                color="#64748B"
                              />
                            </TouchableOpacity>
                          </View>

                          {isSubcatVisible && (
                            <View style={styles.sidebarSubcatList}>
                              {/* All Subcategories */}
                              <TouchableOpacity
                                style={[
                                  styles.sidebarSubcatRow,
                                  selectedSubcategory === 'all' && styles.sidebarSubcatRowSelected,
                                ]}
                                onPress={() => setSelectedSubcategory('all')}
                                activeOpacity={0.7}
                              >
                                <Text
                                  style={[
                                    styles.sidebarSubcatLabel,
                                    selectedSubcategory === 'all' && styles.sidebarSubcatLabelSelected,
                                  ]}
                                  numberOfLines={1}
                                >
                                  All Subcategories
                                </Text>
                                <Text
                                  style={[
                                    styles.sidebarSubcatCount,
                                    selectedSubcategory === 'all' && styles.sidebarSubcatCountSelected,
                                  ]}
                                >
                                  {currentCategoryProducts.length}
                                </Text>
                              </TouchableOpacity>

                              {/* Individual Subcategories */}
                              {catalogSubcategories.map((sub) => {
                                const subIdVal = sub.code || sub.id;
                                const isSubSelected =
                                  selectedSubcategory !== 'all' &&
                                  (selectedSubcategory === subIdVal ||
                                    (sub.code && selectedSubcategory.toLowerCase() === String(sub.code).toLowerCase()) ||
                                    (sub.id && selectedSubcategory.toLowerCase() === String(sub.id).toLowerCase()) ||
                                    (sub.name && selectedSubcategory.toLowerCase() === String(sub.name).toLowerCase()));
                                const subCount = subcategoryCounts[subIdVal];
                                return (
                                  <TouchableOpacity
                                    key={sub.id || sub.code || sub.name}
                                    style={[
                                      styles.sidebarSubcatRow,
                                      isSubSelected && styles.sidebarSubcatRowSelected,
                                    ]}
                                    onPress={() => setSelectedSubcategory(isSubSelected ? 'all' : subIdVal)}
                                    activeOpacity={0.7}
                                  >
                                    <Text
                                      style={[
                                        styles.sidebarSubcatLabel,
                                        isSubSelected && styles.sidebarSubcatLabelSelected,
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {sub.name}
                                    </Text>
                                    {subCount !== undefined && (
                                      <Text
                                        style={[
                                          styles.sidebarSubcatCount,
                                          isSubSelected && styles.sidebarSubcatCountSelected,
                                        ]}
                                      >
                                        {subCount}
                                      </Text>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.sidebarExpandBtn}
              onPress={() => setIsSidebarVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Expand Categories Sidebar"
            >
              <Icon name="chevron-right" size={13} color="#007AFF" />
              <Text style={styles.sidebarExpandBtnText}>Categories</Text>
            </TouchableOpacity>
          )}

          {/* Right Product Grid Area */}
          <View style={styles.horizontalProductArea}>
            {selectedCategory === 'favorites' && (
              <View style={styles.favoritesActiveBanner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Icon name="heart" size={13} color="#EF4444" style={{ marginRight: 6 }} />
                  <Text style={styles.favoritesActiveBannerText}>
                    Showing Favorites ({filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'})
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.favoritesClearBtn}
                  onPress={() => {
                    setSelectedCategory('all');
                    setSelectedSubcategory('all');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.favoritesClearBtnText}>View All</Text>
                  <Icon name="times" size={11} color="#EF4444" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </View>
            )}
            <FlatList
              key={`h-grid-${numColumns}`}
              data={filteredProducts}
              renderItem={renderProduct}
              keyExtractor={(item) => item.id.toString()}
              numColumns={numColumns}
              style={[
                styles.list,
                Platform.OS === 'web' ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0 } : null,
              ]}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
              contentContainerStyle={[
                styles.container,
                { flexGrow: 1, paddingBottom: 30 }
              ]}
              extraData={{ cart, guestCart, updatingCart, searchQuery, selectedCategory, selectedSubcategory, favoriteProductIds }}
              ListEmptyComponent={renderEmptySearchComponent()}
            />
          </View>
        </View>
      ) : (
        /* Vertical Screen (Mobile Portrait) Layout */
        <>
          {/* Category Horizontal Filter Bar */}
          <View style={styles.categoryBarWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryScrollContainer}
            >
              {/* Favorites Chip in Mobile Category Strip */}
              <TouchableOpacity
                style={[
                  styles.categoryChip,
                  selectedCategory === 'favorites' && { backgroundColor: '#EF4444', borderColor: '#EF4444' },
                  selectedCategory !== 'favorites' && favoritesCount > 0 && { borderColor: '#FECDD3', backgroundColor: '#FFF1F2' }
                ]}
                onPress={() => {
                  setSelectedCategory(selectedCategory === 'favorites' ? 'all' : 'favorites');
                  setSelectedSubcategory('all');
                }}
                activeOpacity={0.7}
              >
                <Icon
                  name="heart"
                  size={12}
                  color={selectedCategory === 'favorites' ? '#FFFFFF' : '#EF4444'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    selectedCategory === 'favorites' && styles.categoryChipTextSelected,
                    selectedCategory !== 'favorites' && favoritesCount > 0 && { color: '#EF4444', fontWeight: '600' }
                  ]}
                >
                  Favorites {favoritesCount > 0 ? `(${favoritesCount})` : ''}
                </Text>
              </TouchableOpacity>

              {catalogCategories.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                const count = categoryCounts[cat.id] || 0;
                if (cat.id !== 'all' && count === 0 && !isSelected) return null;

                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected
                    ]}
                    onPress={() => {
                      setSelectedCategory(cat.id === selectedCategory ? 'all' : cat.id);
                      setSelectedSubcategory('all');
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon
                      name={cat.icon || 'tag'}
                      size={12}
                      color={isSelected ? '#FFFFFF' : '#475569'}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected && styles.categoryChipTextSelected
                      ]}
                    >
                      {cat.label} {count > 0 ? `(${count})` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Subcategory Bar with Hide/Show & Grid/Strip View Modes */}
          {selectedCategory !== 'all' && catalogSubcategories && catalogSubcategories.length > 0 && (
            <View style={styles.subcategoryBarWrapper}>
              <View style={styles.subcategoryControlHeader}>
                <View style={styles.subcategoryControlTitleBox}>
                  <Icon name="tags" size={11} color="#475569" style={{ marginRight: 5 }} />
                  <Text style={styles.subcategoryControlTitle}>
                    Sub Catalog ({catalogSubcategories.length})
                    {selectedSubcategory !== 'all' ? (
                      <Text style={{ color: '#007AFF', fontWeight: '700' }}> • Filtered</Text>
                    ) : null}
                  </Text>
                </View>
                <View style={styles.subcategoryControlActionBtns}>
                  {/* View Mode Segmented Control: Grid (Default) vs Strip */}
                  <View style={styles.subcatViewToggleGroup}>
                    <TouchableOpacity
                      style={[
                        styles.subcatToggleTab,
                        (subcatViewMode === 'grid' || subcatViewMode === 'vertical') && styles.subcatToggleTabActive,
                      ]}
                      onPress={() => handleChangeSubcatViewMode('grid')}
                      activeOpacity={0.7}
                      accessibilityLabel="Grid View"
                    >
                      <Icon
                        name="th-large"
                        size={10}
                        color={(subcatViewMode === 'grid' || subcatViewMode === 'vertical') ? '#007AFF' : '#64748B'}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.subcatToggleTabText,
                          (subcatViewMode === 'grid' || subcatViewMode === 'vertical') && styles.subcatToggleTabTextActive,
                        ]}
                      >
                        Grid
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.subcatToggleTab,
                        (subcatViewMode === 'strip' || subcatViewMode === 'horizontal') && styles.subcatToggleTabActive,
                      ]}
                      onPress={() => handleChangeSubcatViewMode('strip')}
                      activeOpacity={0.7}
                      accessibilityLabel="Strip View"
                    >
                      <Icon
                        name="bars"
                        size={10}
                        color={(subcatViewMode === 'strip' || subcatViewMode === 'horizontal') ? '#007AFF' : '#64748B'}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.subcatToggleTabText,
                          (subcatViewMode === 'strip' || subcatViewMode === 'horizontal') && styles.subcatToggleTabTextActive,
                        ]}
                      >
                        Strip
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Hide / Show Toggle */}
                  <TouchableOpacity
                    style={styles.subcatActionBtn}
                    onPress={() => setIsSubcatVisible((prev) => !prev)}
                    activeOpacity={0.7}
                    accessibilityLabel={isSubcatVisible ? 'Hide Subcategories' : 'Show Subcategories'}
                  >
                    <Icon
                      name={isSubcatVisible ? 'chevron-up' : 'chevron-down'}
                      size={10}
                      color="#64748B"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.subcatActionBtnText}>
                      {isSubcatVisible ? 'Hide' : 'Show'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* When subcategory is hidden and a subcategory is active, show quick pill */}
              {!isSubcatVisible && selectedSubcategory !== 'all' && (
                <View style={styles.subcatCollapsedFilterRow}>
                  <Text style={styles.subcatCollapsedFilterLabel}>Active:</Text>
                  <TouchableOpacity
                    style={styles.subcatActivePill}
                    onPress={() => setIsSubcatVisible(true)}
                  >
                    <Text style={styles.subcatActivePillText}>
                      {catalogSubcategories.find((s) => s.code === selectedSubcategory || s.id === selectedSubcategory || s.name === selectedSubcategory)?.name || selectedSubcategory}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setSelectedSubcategory('all')}
                      style={{ marginLeft: 6 }}
                    >
                      <Icon name="times" size={10} color="#007AFF" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                </View>
              )}

              {/* Subcategories: Strip (horizontal scroll) vs Grid (multi-row wrap) */}
              {isSubcatVisible && (
                (subcatViewMode === 'strip' || subcatViewMode === 'horizontal') ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.subcategoryScrollContainer}
                  >
                    <TouchableOpacity
                      style={[
                        styles.subcategoryChip,
                        selectedSubcategory === 'all' && styles.subcategoryChipSelected,
                      ]}
                      onPress={() => setSelectedSubcategory('all')}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.subcategoryChipText,
                          selectedSubcategory === 'all' && styles.subcategoryChipTextSelected,
                        ]}
                      >
                        All Subcategories ({currentCategoryProducts.length})
                      </Text>
                    </TouchableOpacity>
                    {catalogSubcategories.map((sub) => {
                      const subIdVal = sub.code || sub.id;
                      const isSubSelected =
                        selectedSubcategory !== 'all' &&
                        (selectedSubcategory === subIdVal ||
                          (sub.code && selectedSubcategory.toLowerCase() === String(sub.code).toLowerCase()) ||
                          (sub.id && selectedSubcategory.toLowerCase() === String(sub.id).toLowerCase()) ||
                          (sub.name && selectedSubcategory.toLowerCase() === String(sub.name).toLowerCase()));
                      const subCount = subcategoryCounts[subIdVal];
                      return (
                        <TouchableOpacity
                          key={sub.id || sub.code || sub.name}
                          style={[
                            styles.subcategoryChip,
                            isSubSelected && styles.subcategoryChipSelected,
                          ]}
                          onPress={() => setSelectedSubcategory(isSubSelected ? 'all' : subIdVal)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.subcategoryChipText,
                              isSubSelected && styles.subcategoryChipTextSelected,
                            ]}
                          >
                            {sub.name} {subCount !== undefined && subCount > 0 ? `(${subCount})` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : (
                  /* Multi-Row Grid View (Default) */
                  <ScrollView
                    style={styles.subcategoryGridScroll}
                    contentContainerStyle={styles.subcategoryGridContainer}
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    <TouchableOpacity
                      style={[
                        styles.subcategoryChip,
                        styles.subcategoryChipGrid,
                        selectedSubcategory === 'all' && styles.subcategoryChipSelected,
                      ]}
                      onPress={() => setSelectedSubcategory('all')}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.subcategoryChipText,
                          selectedSubcategory === 'all' && styles.subcategoryChipTextSelected,
                        ]}
                      >
                        All ({currentCategoryProducts.length})
                      </Text>
                    </TouchableOpacity>
                    {catalogSubcategories.map((sub) => {
                      const subIdVal = sub.code || sub.id;
                      const isSubSelected =
                        selectedSubcategory !== 'all' &&
                        (selectedSubcategory === subIdVal ||
                          (sub.code && selectedSubcategory.toLowerCase() === String(sub.code).toLowerCase()) ||
                          (sub.id && selectedSubcategory.toLowerCase() === String(sub.id).toLowerCase()) ||
                          (sub.name && selectedSubcategory.toLowerCase() === String(sub.name).toLowerCase()));
                      const subCount = subcategoryCounts[subIdVal];
                      return (
                        <TouchableOpacity
                          key={sub.id || sub.code || sub.name}
                          style={[
                            styles.subcategoryChip,
                            styles.subcategoryChipGrid,
                            isSubSelected && styles.subcategoryChipSelected,
                          ]}
                          onPress={() => setSelectedSubcategory(isSubSelected ? 'all' : subIdVal)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.subcategoryChipText,
                              isSubSelected && styles.subcategoryChipTextSelected,
                            ]}
                          >
                            {sub.name} {subCount !== undefined && subCount > 0 ? `(${subCount})` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )
              )}
            </View>
          )}

          {/* Product Grid in Portrait */}
          {selectedCategory === 'favorites' && (
            <View style={styles.favoritesActiveBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name="heart" size={13} color="#EF4444" style={{ marginRight: 6 }} />
                <Text style={styles.favoritesActiveBannerText}>
                  Showing Favorites ({filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'})
                </Text>
              </View>
              <TouchableOpacity
                style={styles.favoritesClearBtn}
                onPress={() => {
                  setSelectedCategory('all');
                  setSelectedSubcategory('all');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.favoritesClearBtnText}>View All</Text>
                <Icon name="times" size={11} color="#EF4444" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </View>
          )}
          <FlatList
            key="v-grid-2"
            data={filteredProducts}
            renderItem={renderProduct}
            keyExtractor={(item) => item.id.toString()}
            numColumns={2}
            style={[
              styles.list,
              Platform.OS === 'web' ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0 } : null,
            ]}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
            contentContainerStyle={[
              styles.container,
              { flexGrow: 1, paddingBottom: 30 }
            ]}
            extraData={{ cart, guestCart, updatingCart, searchQuery, selectedCategory, selectedSubcategory, favoriteProductIds }}
            ListEmptyComponent={renderEmptySearchComponent()}
          />
        </>
      )}

      <Modal
        animationType="slide"
        transparent={false}
        visible={Boolean(isProductModalVisible && selectedProduct)}
        onRequestClose={closeProductModal}
      >
        {selectedProduct ? (
          <SafeAreaView style={styles.fullProductModalSafeArea}>
            <View style={styles.fullProductModalContainer}>
              {/* Full Screen Modal Top Bar */}
              <View style={styles.fullProductModalHeader}>
                <TouchableOpacity
                  style={styles.modalBackBtn}
                  onPress={closeProductModal}
                  accessibilityLabel="Back to catalog"
                  activeOpacity={0.7}
                >
                  <Icon name="arrow-left" size={18} color="#0F172A" />
                </TouchableOpacity>

                <View style={styles.modalHeaderTitleWrap}>
                  <Text style={styles.modalHeaderTitle} numberOfLines={1}>
                    {selectedProduct?.product_name || 'Product Details'}
                  </Text>
                  {selectedProduct?.product_type ? (
                    <Text style={styles.modalHeaderSubTitle} numberOfLines={1}>
                      {getCategoryLabel(selectedProduct.product_type)}
                      {selectedProduct?.subcategory ? ` • ${selectedProduct.subcategory}` : ''}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.modalHeaderRightActions}>
                  {/* Share & Contact Seller Button beside Favorite */}
                  <TouchableOpacity
                    style={[styles.modalHeaderShareBtn, styles.modalHeaderShareBtnHighlight]}
                    onPress={() => openShareModal(selectedProduct)}
                    activeOpacity={0.8}
                    accessibilityLabel="Share product & contact seller"
                  >
                    <Icon name="share-alt" size={16} color="#0284C7" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalHeaderFavBtn,
                      favoriteProductIds.some((id) => String(id) === String(selectedProduct?.id)) && styles.modalHeaderFavBtnActive,
                    ]}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      selectedProduct?.id && handleToggleFavorite(selectedProduct.id);
                    }}
                    activeOpacity={0.8}
                    accessibilityLabel="Toggle favorite"
                  >
                    <Icon
                      name={favoriteProductIds.some((id) => String(id) === String(selectedProduct?.id)) ? 'heart' : 'heart-o'}
                      size={18}
                      color={favoriteProductIds.some((id) => String(id) === String(selectedProduct?.id)) ? '#EF4444' : '#64748B'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalHeaderCloseBtn}
                    onPress={closeProductModal}
                    activeOpacity={0.7}
                    accessibilityLabel="Close"
                  >
                    <Icon name="times" size={18} color="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>
              
              <ScrollView
                style={{ flex: 1, width: '100%' }}
                contentContainerStyle={{ paddingBottom: 30 }}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.swiperContainer}>
                  {selectedProduct?.product_media && selectedProduct.product_media.length > 0 && selectedProduct.product_media.some(m => isImageMedia(m) && (m?.media_url || m?.uri)) ? (
                    Platform.OS === 'web' ? (
                      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={true} style={{ width: '100%', height: 250 }}>
                        {selectedProduct.product_media
                          .filter(m => isImageMedia(m) && (m?.media_url || m?.uri))
                          .map((media, index) => (
                            <TouchableOpacity key={`modal-media-${selectedProduct?.id || 'prod'}-${media.id || index}`} onPress={() => openImageViewer(selectedProduct, index)} activeOpacity={0.9} style={{ width: 340, height: 250, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                              <Image source={{ uri: media.media_url || media.uri }} style={styles.modalProductImage} resizeMode="contain" />
                            </TouchableOpacity>
                          ))}
                      </ScrollView>
                    ) : (
                      <Swiper showsButtons={false} loop={false}>
                        {selectedProduct.product_media
                          .filter(m => isImageMedia(m) && (m?.media_url || m?.uri))
                          .map((media, index) => (
                            <TouchableOpacity key={`modal-media-${selectedProduct?.id || 'prod'}-${media.id || index}`} onPress={() => openImageViewer(selectedProduct, index)} activeOpacity={0.9}>
                              <Image source={{ uri: media.media_url || media.uri }} style={styles.modalProductImage} resizeMode="contain" />
                            </TouchableOpacity>
                          ))}
                      </Swiper>
                    )
                  ) : selectedProduct?.image_url ? (
                    <TouchableOpacity
                      onPress={() => openImageViewer(selectedProduct, 0)}
                      activeOpacity={0.9}
                      style={{ width: '100%', height: 250, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}
                    >
                      <Image source={{ uri: selectedProduct.image_url }} style={styles.modalProductImage} resizeMode="contain" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.modalProductImagePlaceholder}>
                      <Icon name="shopping-bag" size={48} color="#94a3b8" />
                      <Text style={styles.modalPlaceholderText}>{selectedProduct?.product_name || 'Product'}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.swiggyHeaderSection}>
                  <View style={styles.swiggyMetaBadgesRow}>
                    {selectedProduct?.product_type ? (
                      <View style={styles.swiggyCategoryBadge}>
                        <Icon name="tag" size={11} color="#007AFF" style={{ marginRight: 4 }} />
                        <Text style={styles.swiggyCategoryBadgeText}>
                          {getCategoryLabel(selectedProduct.product_type)}
                        </Text>
                      </View>
                    ) : null}
                    {selectedProduct?.subcategory ? (
                      <View style={[styles.swiggyCategoryBadge, { backgroundColor: '#ECFDF5' }]}>
                        <Icon name="bookmark" size={10} color="#059669" style={{ marginRight: 4 }} />
                        <Text style={[styles.swiggyCategoryBadgeText, { color: '#059669' }]}>
                          {selectedProduct.subcategory}
                        </Text>
                      </View>
                    ) : null}
                    {selectedProduct?.unit ? (
                      <View style={styles.swiggyUnitBadge}>
                        <Text style={styles.swiggyUnitBadgeText}>Unit: {selectedProduct.unit}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.swiggyProductName}>{selectedProduct?.product_name || ''}</Text>
                  {selectedProduct?.description ? (
                    <Text style={styles.swiggyProductDesc}>{selectedProduct.description}</Text>
                  ) : null}
                </View>
                {(() => {
                  const combos = getProductCombinations(selectedProduct);
                  const isMultiCombo = combos.length > 1;

                  // Filter by selected variant filter if active
                  const filteredCombos = combos.filter(combo => {
                    if (!selectedVariantFilter) return true;
                    const normalizedCombo = (combo?.combination_string || '').toLowerCase();
                    return normalizedCombo.includes(selectedVariantFilter.toLowerCase());
                  });

                  return (
                    <View style={{ flex: 1 }}>
                      {/* Filter chips if product has multiple variants */}
                      {selectedProduct?.product_variants && selectedProduct.product_variants.length > 1 && (
                        <View style={styles.swiggyFilterSection}>
                          <Text style={styles.swiggyFilterLabel}>Filter by:</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swiggyFilterScroll}>
                            <TouchableOpacity
                              style={[styles.swiggyFilterChip, !selectedVariantFilter && styles.swiggyFilterChipActive]}
                              onPress={() => setSelectedVariantFilter(null)}
                            >
                              <Text style={[styles.swiggyFilterChipText, !selectedVariantFilter && styles.swiggyFilterChipTextActive]}>
                                All ({combos.length})
                              </Text>
                            </TouchableOpacity>
                            {selectedProduct.product_variants.flatMap((v, vIdx) => (
                              (v.variant_options || []).map((opt, oIdx) => {
                                const optVal = typeof opt === 'string' ? opt : (opt?.value || opt?.name || '');
                                const isChipActive = selectedVariantFilter === optVal;
                                return (
                                  <TouchableOpacity
                                    key={`filter-chip-${v.id || vIdx}-${oIdx}-${optVal}`}
                                    style={[styles.swiggyFilterChip, isChipActive && styles.swiggyFilterChipActive]}
                                    onPress={() => setSelectedVariantFilter(isChipActive ? null : optVal)}
                                  >
                                    <Text style={[styles.swiggyFilterChipText, isChipActive && styles.swiggyFilterChipTextActive]}>
                                      {optVal}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })
                            ))}
                          </ScrollView>
                        </View>
                      )}

                      {/* Section Title */}
                      <View style={styles.swiggyOptionsHeaderRow}>
                        <Text style={styles.swiggyOptionsSectionTitle}>
                          {isMultiCombo ? 'Available Options & Sizes' : 'Product Details'}
                        </Text>
                        <Text style={styles.swiggyOptionsSectionSubtitle}>
                          {isMultiCombo ? 'Select quantity for each option you want to add' : 'Add to your cart'}
                        </Text>
                      </View>

                      {/* Swiggy/Zomato style Options list */}
                      <View style={styles.swiggyOptionsList}>
                        {filteredCombos.map((combo, index) => {
                          const qtyInCart = quantityMap[combo.id] || 0;
                          const comboPrice = combo?.price !== undefined && combo?.price !== null ? combo.price : (selectedProduct.amount || 0);
                          const stockQty = combo?.quantity !== undefined && combo?.quantity !== null ? combo.quantity : 100;
                          const isOutOfStock = stockQty <= 0;
                          
                          const comboTitle = formatCombinationTitle(combo.combination_string, selectedProduct);
                          const parts = (combo.combination_string || '')
                            .split(',')
                            .map(p => p.trim())
                            .filter(Boolean);

                          return (
                            <View 
                              key={combo.id || index} 
                              style={[styles.swiggyOptionCard, qtyInCart > 0 && styles.swiggyOptionCardActive]}
                            >
                              <View style={styles.swiggyOptionInfoCol}>
                                <Text style={styles.swiggyOptionTitle}>{comboTitle}</Text>
                                
                                {parts.length > 0 && combo.combination_string !== 'Default' && (
                                  <View style={styles.swiggyBadgesRow}>
                                    {parts.map((part, pIdx) => {
                                      const colonIdx = part.indexOf(':');
                                      const vName = colonIdx > -1 ? part.substring(0, colonIdx).trim() : '';
                                      const vVal = colonIdx > -1 ? part.substring(colonIdx + 1).trim() : part.trim();
                                      return (
                                        <View key={`part-${combo.id || index}-${pIdx}`} style={styles.swiggyBadge}>
                                          {vName ? <Text style={styles.swiggyBadgeName}>{`${vName}: `}</Text> : null}
                                          <Text style={styles.swiggyBadgeVal}>{vVal}</Text>
                                        </View>
                                      );
                                    })}
                                  </View>
                                )}

                                <View style={styles.swiggyPriceStockRow}>
                                  <Text style={styles.swiggyOptionPriceText}>{`₹${comboPrice}`}</Text>
                                  <Text style={[styles.swiggyStockText, isOutOfStock && styles.swiggyStockOutText]}>
                                    {isOutOfStock ? '• Out of Stock' : `• In Stock: ${stockQty} ${selectedProduct.unit || 'units'}`}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.swiggyActionCol}>
                                {qtyInCart > 0 ? (
                                  <View style={styles.swiggyStepperBox}>
                                    <TouchableOpacity
                                      style={styles.swiggyStepperBtn}
                                      onPress={() => handleUpdateCart(selectedProduct, combo.id, -1)}
                                      disabled={updatingCart}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Icon name="minus" size={12} color="#166534" />
                                    </TouchableOpacity>
                                    <Text style={styles.swiggyStepperQtyText}>{qtyInCart}</Text>
                                    <TouchableOpacity
                                      style={[styles.swiggyStepperBtn, (qtyInCart >= stockQty || updatingCart) && styles.swiggyBtnDisabled]}
                                      onPress={() => handleUpdateCart(selectedProduct, combo.id, 1)}
                                      disabled={updatingCart || qtyInCart >= stockQty}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Icon name="plus" size={12} color="#166534" />
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <TouchableOpacity
                                    style={[styles.swiggyAddBtn, isOutOfStock && styles.swiggyAddBtnDisabled]}
                                    onPress={() => handleUpdateCart(selectedProduct, combo.id, 1)}
                                    disabled={updatingCart || isOutOfStock}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={[styles.swiggyAddBtnText, isOutOfStock && styles.swiggyAddBtnTextDisabled]}>
                                      {isOutOfStock ? 'OUT' : 'ADD +'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()}
              </ScrollView>

              {/* Full Screen Modal Docked Footer */}
              <View style={styles.fullProductModalFooter}>
                <View style={styles.swiggyFooterInfo}>
                  <Text style={styles.swiggyFooterItemsCount}>
                    {`${productTotalQuantityInCart[selectedProduct?.id] || 0} ${(productTotalQuantityInCart[selectedProduct?.id] || 0) === 1 ? 'item' : 'items'} in cart`}
                  </Text>
                  <Text style={styles.swiggyFooterTotalPrice}>
                    {`₹${(productTotalPriceInCart[selectedProduct?.id] || 0).toFixed(2)}`}
                  </Text>
                </View>
                <View style={styles.swiggyFooterActionsRow}>
                  <TouchableOpacity
                    style={styles.swiggyDoneBtn}
                    onPress={closeProductModal}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.swiggyDoneBtnText}>Continue</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.swiggyViewCartBtn}
                    onPress={() => {
                      closeProductModal();
                      navigation.navigate('Cart', {
                        sellerId: activeSellerId,
                        sellerName: activeStoreName,
                        customerId: paramCustomerId,
                      });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.swiggyViewCartBtnText}>View Cart ({cartTotals.totalItems})</Text>
                    <Icon name="arrow-right" size={12} color="#ffffff" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </SafeAreaView>
        ) : null}
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isCartModalVisible}
        onRequestClose={() => setIsCartModalVisible(!isCartModalVisible)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsCartModalVisible(false)}
            >
              <Icon name="times-circle" size={30} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Your Cart</Text>
            {cartItems && cartItems.length > 0 ? (
              <FlatList
                data={cartItems}
                renderItem={renderCartItem}
                keyExtractor={(item) => (user ? item.id.toString() : item.product_variant_combination_id.toString())}
              />
            ) : (
              <Text style={styles.emptyCartText}>Your cart is empty.</Text>
            )}
            <Button title="Checkout" onPress={() => {
              setIsCartModalVisible(false);
              navigation.navigate('Checkout', { cart: user ? cart : { cart_items: guestCart } });
            }} />
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        style={styles.bottomDockedContainer}
      >
        {/* View Cart Docked Bar (when items > 0) */}
        {cartTotals.totalItems > 0 && (
          <View style={styles.viewCartContainer}>
            <TouchableOpacity
              style={styles.viewCartButton}
              onPress={() => navigation.navigate('Cart', { sellerId: activeSellerId, sellerName: activeStoreName, customerId: paramCustomerId })}
              activeOpacity={0.85}
            >
              <Text style={styles.viewCartText}>
                {cartTotals.totalItems} {cartTotals.totalItems > 1 ? 'items' : 'item'} | ₹{cartTotals.totalPrice.toFixed(2)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.viewCartText}>View Cart </Text>
                <Icon name="shopping-bag" size={15} color="#FFFFFF" style={{ marginLeft: 4 }} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Search Bar */}
        <View style={styles.bottomSearchBarWrapper}>
          <View style={styles.bottomSearchBox}>
            <Icon name="search" size={16} color="#007AFF" style={styles.searchIcon} />
            <TextInput
              style={styles.bottomSearchInput}
              placeholder="Search products, variants..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearIconBtn}>
                <Icon name="times-circle" size={18} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Bottom Navigation Footer (Store, Cart, Orders) */}
        <StoreNavigationFooter
          activeTab="store"
          navigation={navigation}
          route={route}
          sellerId={activeSellerId}
          sellerName={activeStoreName}
          customerId={paramCustomerId}
          isDirectQr={isDirectQr}
          forceShow={true}
          onStorePress={() => {
            setSelectedCategory('all');
            setSearchQuery('');
          }}
        />

        {/* Full-Screen Image Viewer with Horizontal Scrolling & Navigation */}
        <FullScreenImageViewer
          visible={isImageViewerVisible}
          mediaList={viewerImages}
          initialIndex={viewerInitialIndex}
          title={viewerTitle || 'Product Images'}
          onClose={() => setIsImageViewerVisible(false)}
          onToggleFavorite={(target) => {
            const prodId = (typeof target === 'object' && target) ? (target.productId || target.id) : target;
            if (prodId) {
              handleToggleFavorite(prodId);
            }
          }}
          onShare={(target) => {
            const prodId = (typeof target === 'object' && target) ? (target.productId || target.id) : target;
            const prod = products.find(p => String(p.id) === String(prodId)) || shareProduct || selectedProduct;
            if (prod) {
              openShareModal(prod);
            }
          }}
          favoriteProductIds={favoriteProductIds}
        />

        {/* Seller Direct Contact & Share Modal with Highlight Mode */}
        <SellerContactShareModal
          visible={shareModalVisible}
          onClose={closeShareModal}
          product={shareProduct}
          sellerId={shareProduct?.user_id || shareProduct?.customer_id || activeSellerId}
          storeName={activeStoreName || ''}
        />

        {/* Individual Store QR Code Modal */}
        {activeSellerId && (
          <StoreQrModal
            visible={storeQrVisible}
            seller={{ id: activeSellerId, full_name: activeStoreName }}
            onClose={() => setStoreQrVisible(false)}
          />
        )}
      </KeyboardAvoidingView>

    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    height: Platform.OS === 'web' ? '100%' : undefined,
    maxHeight: Platform.OS === 'web' ? '100vh' : undefined,
    minHeight: 0,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
    width: '100%',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  container: {
    padding: 5,
    paddingBottom: 80,
  },
  productContainer: {
    flex: 1,
    margin: 5,
    backgroundColor: '#fff',
    borderRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: 150,
    backgroundColor: '#f8fafc',
  },
  cardZoomBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  productImagePlaceholder: {
    width: '100%',
    height: 150,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalProductImagePlaceholder: {
    width: '100%',
    height: 250,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPlaceholderText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
    fontWeight: '600',
  },
  productDetails: {
    padding: 10,
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
    minHeight: 44,
  },
  productPrice: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  },
  stockText: {
    fontSize: 12,
    color: '#388E3C',
    marginTop: 2,
  },
  addButton: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  addButtonActive: {
    backgroundColor: '#C8E6C9',
    borderColor: '#81C784',
  },
  addButtonText: {
    color: '#2E7D32',
    fontWeight: 'bold',
    fontSize: 14,
  },
  addButtonTextActive: {
    color: '#1B5E20',
  },
  cardQuantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F8E9',
    borderRadius: 8,
    marginTop: 5,
    marginHorizontal: 10,
    marginBottom: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  cardQtyBtnMinus: {
    backgroundColor: '#E53935',
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardQtyBtnPlus: {
    backgroundColor: '#43A047',
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardQtyText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1B5E20',
    paddingHorizontal: 8,
  },
  singleVariantModalContainer: {
    padding: 10,
  },
  modalAddToCartButton: {
    backgroundColor: '#43A047',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 20,
    elevation: 2,
  },
  modalAddToCartButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  quantityText: {
    marginHorizontal: 15,
    fontSize: 18,
    fontWeight: 'bold',
  },
  variantsContainer: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  variantInfo: {
      flex: 1,
  },
  variantNameText: {
    fontSize: 16,
    fontWeight: '500',
  },
  variantSearchInput: {
    height: 40,
    borderColor: '#eee',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? 16 : 0,
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderRadius: Platform.OS === 'web' ? 16 : 0,
    width: '100%',
    maxWidth: 600,
    height: Platform.OS === 'web' ? '85%' : '80%',
    maxHeight: Platform.OS === 'web' ? '85%' : '80%',
    overflow: 'hidden',
  },
  productModalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderRadius: Platform.OS === 'web' ? 16 : 0,
    width: '100%',
    maxWidth: 700,
    height: Platform.OS === 'web' ? '90vh' : '90%',
    maxHeight: Platform.OS === 'web' ? '90vh' : '90%',
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 15,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 5,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 5,
  },
  itemDetails: {
    flex: 1,
    marginLeft: 10,
  },
  itemName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  itemVariant: {
    fontSize: 14,
    color: '#555',
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#888',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  emptyCartText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 18,
  },
  bottomDockedContainer: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
    zIndex: 10,
  },
  bottomSearchBarWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 4,
  },
  bottomSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 25,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    marginRight: 8,
  },
  bottomSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#1e293b',
    paddingVertical: 4,
  },
  clearIconBtn: {
    padding: 4,
    marginLeft: 4,
  },
  emptySearchContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySearchTitle: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 22,
  },
  clearSearchBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
  },
  clearSearchBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  viewCartContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 4,
    backgroundColor: '#fff',
  },
  viewCartButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewCartText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  swiperContainer: {
    height: 250,
    marginBottom: 20,
    borderRadius: 10,
    overflow: 'hidden'
  },
  modalProductImage: {
    width: '100%',
    height: 250,
    resizeMode: 'contain',
  },
  fullProductModalSafeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    height: '100%',
  },
  fullProductModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  fullProductModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    zIndex: 10,
    flexShrink: 0,
  },
  modalBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  modalHeaderTitleWrap: {
    flex: 1,
    marginRight: 10,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalHeaderSubTitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  modalHeaderRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalHeaderShareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderShareBtnHighlight: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
  },
  modalHeaderFavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderFavBtnActive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  modalHeaderCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullProductModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 8,
    flexShrink: 0,
  },
  swiggyModalContent: {
    backgroundColor: '#ffffff',
    width: '100%',
    height: '100%',
    paddingTop: 16,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  swiggyHeaderSection: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  swiggyProductName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  swiggyProductDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 6,
  },
  swiggyFilterSection: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  swiggyFilterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  swiggyFilterScroll: {
    flexDirection: 'row',
  },
  swiggyFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
  },
  swiggyFilterChipActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  swiggyFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  swiggyFilterChipTextActive: {
    color: '#ffffff',
  },
  swiggyOptionsHeaderRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  swiggyOptionsSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  swiggyOptionsSectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  swiggyOptionsList: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  swiggyOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  swiggyOptionCardActive: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  swiggyOptionInfoCol: {
    flex: 1,
    paddingRight: 12,
  },
  swiggyOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  swiggyBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  swiggyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
    marginBottom: 4,
  },
  swiggyBadgeName: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  swiggyBadgeVal: {
    fontSize: 11,
    color: '#0f172a',
    fontWeight: '700',
  },
  swiggyPriceStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swiggyOptionPriceText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginRight: 8,
  },
  swiggyStockText: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '600',
  },
  swiggyStockOutText: {
    color: '#dc2626',
  },
  swiggyActionCol: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  swiggyAddBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#16a34a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 90,
  },
  swiggyAddBtnDisabled: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  swiggyAddBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#16a34a',
  },
  swiggyAddBtnTextDisabled: {
    color: '#94a3b8',
    fontSize: 11,
  },
  swiggyStepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minWidth: 96,
    justifyContent: 'space-between',
    elevation: 2,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  swiggyStepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swiggyStepperQtyText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
    paddingHorizontal: 8,
  },
  swiggyBtnDisabled: {
    opacity: 0.5,
  },
  swiggyModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 8,
  },
  swiggyFooterInfo: {
    flex: 1,
  },
  swiggyFooterItemsCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  swiggyFooterTotalPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  swiggyFooterActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swiggyDoneBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
  },
  swiggyDoneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  swiggyViewCartBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  swiggyViewCartBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    marginRight: 4,
  },
  labelText: {
    fontSize: 12,
    color: '#888',
  },
  categoryBarWrapper: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 10,
    flexShrink: 0,
  },
  categoryScrollContainer: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryChipSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  cardCategoryTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  cardCategoryTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#007AFF',
  },
  swiggyMetaBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  swiggyCategoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  swiggyCategoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  swiggyUnitBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  swiggyUnitBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  storeFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
    flexShrink: 0,
  },
  storeFilterText: {
    fontSize: 13,
    color: '#1E40AF',
  },
  storeQrBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  storeQrBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  clearStoreFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },

  clearStoreFilterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  directStoreBanner: {
    backgroundColor: '#F0FDF4',
    borderBottomColor: '#DCFCE7',
  },
  directStoreFilterText: {
    color: '#065F46',
  },
  directStoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  directStoreBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  subcategoryBarWrapper: {
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 7,
    flexShrink: 0,
  },
  subcategoryScrollContainer: {
    paddingHorizontal: 12,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  subcategoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  subcategoryChipSelected: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  subcategoryChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  subcategoryChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Responsive Horizontal Screen (Wide/Landscape) Layout
  bodyContentRow: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    backgroundColor: '#FFFFFF',
  },
  horizontalProductArea: {
    flex: 1,
    minHeight: 0,
  },
  verticalSidebar: {
    width: 240,
    backgroundColor: '#F8FAFC',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    flexDirection: 'column',
  },
  sidebarContainer: {
    width: 240,
    backgroundColor: '#F8FAFC',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    flexDirection: 'column',
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F1F5F9',
  },
  sidebarTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  sidebarCollapseBtn: {
    padding: 6,
    borderRadius: 6,
  },
  sidebarExpandBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 8,
    backgroundColor: '#F1F5F9',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    gap: 8,
  },
  sidebarExpandBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  sidebarScroll: {
    flex: 1,
  },
  sidebarScrollContent: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 4,
  },
  sidebarCategoryGroup: {
    marginBottom: 4,
  },
  sidebarCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  sidebarCategoryRowSelected: {
    backgroundColor: '#007AFF',
  },
  sidebarCategoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  sidebarCategoryLabelSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sidebarBadge: {
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBadgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  sidebarBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  sidebarBadgeTextSelected: {
    color: '#FFFFFF',
  },
  sidebarSubcatContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    marginTop: 4,
    marginLeft: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#007AFF',
  },
  sidebarSubcatControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 2,
  },
  sidebarSubcatHeaderTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sidebarSubcatToggleBtn: {
    padding: 3,
  },
  sidebarSubcatList: {
    gap: 2,
  },
  sidebarSubcatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  sidebarSubcatRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  sidebarSubcatLabel: {
    fontSize: 12,
    color: '#475569',
    flex: 1,
  },
  sidebarSubcatLabelSelected: {
    color: '#007AFF',
    fontWeight: '700',
  },
  sidebarSubcatCount: {
    fontSize: 11,
    color: '#94A3B8',
    marginLeft: 6,
  },
  sidebarSubcatCountSelected: {
    color: '#007AFF',
    fontWeight: '700',
  },

  // Portrait Mobile Subcategory Header & Grid View
  subcategoryControlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  subcategoryControlTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subcategoryControlTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  subcategoryControlActionBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subcatViewToggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  subcatToggleTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
  },
  subcatToggleTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 1.5,
    elevation: 2,
  },
  subcatToggleTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  subcatToggleTabTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  subcatActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  subcatActionBtnActive: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  subcatActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  subcatActionBtnTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  subcatCollapsedFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 3,
    gap: 6,
  },
  subcatCollapsedFilterLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  subcatActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  subcatActivePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  subcategoryGridScroll: {
    maxHeight: 180,
  },
  subcategoryGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 2,
    gap: 6,
  },
  subcategoryChipGrid: {
    marginRight: 0,
    marginBottom: 4,
  },
  cardTopActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 3,
  },
  cardShareBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 3,
  },
  cardShareBtnHighlight: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
    shadowOpacity: 0.25,
  },
  cardFavoriteBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 3,
  },
  cardFavoriteBtnActive: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  headerFavBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerFavBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  modalFavoriteBtn: {
    position: 'absolute',
    top: 15,
    right: 55,
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  favoritesActiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  favoritesActiveBannerText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#991B1B',
  },
  favoritesClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  favoritesClearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EF4444',
  },
});

export default CatalogScreen;
