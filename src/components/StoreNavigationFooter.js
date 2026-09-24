import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useCart } from '../context/CartContext';
import { getGuestCart, getPreferredStore } from '../services/localStorageService';
import PreLoginMarqueeFooter from './PreLoginMarqueeFooter';

const StoreNavigationFooter = ({
  activeTab = 'store',
  navigation,
  route,
  sellerId: propSellerId,
  sellerName: propSellerName,
  customerId: propCustomerId,
  onStorePress,
  onStoresPress,
  onCartPress,
  onOrdersPress,
  onProfilePress,
  forceShow = false,
  isDirectQr: propIsDirectQr,
  hideStoresTab: propHideStoresTab,
  showPreLoginMarquee = true,
}) => {
  const { cart, cartItemCount: contextCartItemCount, user } = useCart();
  const [guestCount, setGuestCount] = React.useState(0);
  const [prefIsDirectQr, setPrefIsDirectQr] = React.useState(false);

  // Compute effective store / customer params
  const sellerId = propSellerId || route?.params?.sellerId || null;
  const sellerName = propSellerName || route?.params?.sellerName || null;
  const customerId = propCustomerId || route?.params?.customerId || null;

  // Load guest cart count if not logged in
  React.useEffect(() => {
    let isMounted = true;
    if (!user) {
      getGuestCart()
        .then((items) => {
          if (isMounted && Array.isArray(items)) {
            const count = items.reduce((sum, it) => sum + Number(it?.quantity || 1), 0);
            setGuestCount(count);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [user, cart]);

  // Check if shopping in preferred store set via QR scan
  React.useEffect(() => {
    let isMounted = true;
    getPreferredStore()
      .then((pref) => {
        if (isMounted && pref?.isDirectQr) {
          setPrefIsDirectQr(true);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const isDirectQr = useMemo(() => {
    if (propHideStoresTab) return true;
    if (propIsDirectQr !== undefined) return Boolean(propIsDirectQr);
    if (route?.params?.isDirectQr !== undefined) return Boolean(route?.params?.isDirectQr);
    if (prefIsDirectQr) return true;
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
  }, [propHideStoresTab, propIsDirectQr, route?.params?.isDirectQr, prefIsDirectQr]);

  const totalCartCount = useMemo(() => {
    if (user) {
      if (contextCartItemCount > 0) return contextCartItemCount;
      if (cart?.cart_items && Array.isArray(cart.cart_items)) {
        return cart.cart_items.reduce((sum, it) => sum + Number(it?.quantity || 1), 0);
      }
      return 0;
    }
    return guestCount;
  }, [user, contextCartItemCount, cart, guestCount]);

  // Do not duplicate if directly inside a React Navigation Tab Navigator unless forceShow is true
  const isInsideParentTab = useMemo(() => {
    if (forceShow) return false;
    try {
      const parent1 = navigation?.getParent?.();
      if (parent1?.getState?.()?.type === 'tab') return true;
    } catch (_) {}
    return false;
  }, [navigation, forceShow]);

  if (isInsideParentTab) {
    return null;
  }

  const handleTabPress = (tab) => {
    if (tab === activeTab) {
      if (tab === 'store' && onStorePress) {
        onStorePress();
      } else if (tab === 'stores' && onStoresPress) {
        onStoresPress();
      } else if (tab === 'cart' && onCartPress) {
        onCartPress();
      } else if (tab === 'orders' && onOrdersPress) {
        onOrdersPress();
      } else if (tab === 'profile' && onProfilePress) {
        onProfilePress();
      }
      return;
    }

    const navParams = {
      sellerId,
      sellerName,
      customerId,
      isDirectQr,
    };

    if (tab === 'stores') {
      navigation.navigate('SellersMap', navParams);
    } else if (tab === 'store') {
      navigation.navigate('Catalog', navParams);
    } else if (tab === 'cart') {
      navigation.navigate('Cart', navParams);
    } else if (tab === 'orders') {
      navigation.navigate('OrderList', navParams);
    } else if (tab === 'profile') {
      if (user) {
        navigation.navigate('Profile', navParams);
      } else {
        navigation.navigate('BuyerAuth', { redirectTo: 'Profile', redirectParams: navParams });
      }
    }
  };

  const shouldShowMarquee = Boolean(
    showPreLoginMarquee && (!user || showPreLoginMarquee === 'always')
  );

  return (
    <View style={styles.outerWrapper}>
      {shouldShowMarquee && (
        <PreLoginMarqueeFooter navigation={navigation} />
      )}
      <View style={styles.footerContainer}>
      {/* Stores Tab (Hidden when accessed directly via QR code) */}
      {!isDirectQr && (
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'stores' && styles.tabButtonActive]}
          onPress={() => handleTabPress('stores')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Stores Tab"
        >
          <Text style={[styles.tabLabel, activeTab === 'stores' && styles.tabLabelActive]} numberOfLines={1}>
            Stores
          </Text>
        </TouchableOpacity>
      )}

      {/* Store Tab */}
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'store' && styles.tabButtonActive]}
        onPress={() => handleTabPress('store')}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Store Tab"
      >
        <Text style={[styles.tabLabel, activeTab === 'store' && styles.tabLabelActive]} numberOfLines={1}>
          Store
        </Text>
      </TouchableOpacity>

      {/* Cart Tab */}
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'cart' && styles.tabButtonActive]}
        onPress={() => handleTabPress('cart')}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Cart Tab"
      >
        <View style={styles.cartLabelRow}>
          <Text style={[styles.tabLabel, activeTab === 'cart' && styles.tabLabelActive]} numberOfLines={1}>
            Cart
          </Text>
          {totalCartCount > 0 && (
            <View style={styles.badgePill}>
              <Text style={styles.badgeText}>{totalCartCount}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Orders Tab */}
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'orders' && styles.tabButtonActive]}
        onPress={() => handleTabPress('orders')}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Orders Tab"
      >
        <Text style={[styles.tabLabel, activeTab === 'orders' && styles.tabLabelActive]} numberOfLines={1}>
          Orders
        </Text>
      </TouchableOpacity>

      {/* Profile Tab */}
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'profile' && styles.tabButtonActive]}
        onPress={() => handleTabPress('profile')}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Profile Tab"
      >
        <Text style={[styles.tabLabel, activeTab === 'profile' && styles.tabLabelActive]} numberOfLines={1}>
          Profile
        </Text>
      </TouchableOpacity>
    </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    width: '100%',
    zIndex: 999,
    flexShrink: 0,
  },
  footerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 8,
    zIndex: 999,
    flexShrink: 0,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginHorizontal: 2,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  tabButtonActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: '#007AFF',
    fontWeight: '800',
  },
  cartLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePill: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    marginLeft: 4,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
});

export default StoreNavigationFooter;
