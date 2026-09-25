import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { getCart, updateCartItem, removeCartItem, supabase } from '../services/supabase';
import { getGuestCart, updateGuestCartItemQuantity, removeGuestCartItem } from '../services/localStorageService';
import Icon from 'react-native-vector-icons/FontAwesome';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import { calculateProductOffer, calculateOrderDeliveryFee, calculateCartSavings } from '../utils/offerUtils';

const CartScreen = ({ navigation, route }) => {
  const { sellerId, sellerName, customerId, isDirectQr } = route?.params || {};
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [sellerDeliveryConfig, setSellerDeliveryConfig] = useState({
    enable_delivery: true,
    default_delivery_fee: 30,
    free_delivery_threshold: 200,
  });

  const openCartImageViewer = (tappedItem) => {
    const items = cart?.cart_items || [];
    const mediaList = [];
    let initialIdx = 0;

    items.forEach((ci) => {
      const prod = ci?.product_variant_combinations?.products;
      const pMedia = (prod?.product_media || []).filter((m) => m && (m.media_url || m.uri));
      const isTarget = String(ci.id) === String(tappedItem?.id);
      const prodName = prod?.product_name || 'Cart Item';
      const prodPrice = ci?.product_variant_combinations?.price || prod?.amount;

      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          if (isTarget && mIdx === 0) {
            initialIdx = mediaList.length;
          }
          mediaList.push({
            id: `cart-${ci.id}-m-${mIdx}`,
            uri: m.media_url || m.uri,
            type: m.media_type || 'image',
            title: pMedia.length > 1 ? `${prodName} (${mIdx + 1}/${pMedia.length})` : prodName,
            subtitle: prodPrice ? `₹${prodPrice}` : null,
          });
        });
      } else {
        const url = getItemImageUrl(ci);
        if (url) {
          if (isTarget) {
            initialIdx = mediaList.length;
          }
          mediaList.push({
            id: `cart-${ci.id}-img`,
            uri: url,
            type: 'image',
            title: prodName,
            subtitle: prodPrice ? `₹${prodPrice}` : null,
          });
        }
      }
    });

    if (mediaList.length > 0) {
      setViewerImages(mediaList);
      setViewerIndex(initialIdx);
      setIsViewerVisible(true);
    }
  };

  const normalizeGuestCart = (guestCartData) => ({
    cart_items: (guestCartData || []).map(item => {
      const existingMedia = item.product_variant_combinations?.products?.product_media;
      const mediaUrl = item.image_url || (Array.isArray(existingMedia) && existingMedia[0]?.media_url) || null;
      const sellingPrice = item.price !== undefined ? item.price : (item.product_variant_combinations?.price || 0);
      const mrp = item.mrp !== undefined ? item.mrp : (item.product_variant_combinations?.mrp || item.product_variant_combinations?.products?.mrp || null);

      return {
        id: item.product_variant_combination_id || item.id,
        quantity: item.quantity,
        price: sellingPrice,
        mrp: mrp,
        product_variant_combinations: {
          id: item.product_variant_combination_id || item.id,
          combination_string: item.combination_string || 'Default',
          price: sellingPrice,
          mrp: mrp,
          products: {
            id: item.product_variant_combinations?.products?.id,
            product_name: item.product_name || item.product_variant_combinations?.products?.product_name || 'Product',
            amount: sellingPrice,
            mrp: mrp,
            user_id: item.product_variant_combinations?.products?.user_id,
            customer_id: item.product_variant_combinations?.products?.customer_id,
            product_media: existingMedia && existingMedia.length > 0
              ? existingMedia
              : (mediaUrl ? [{ media_url: mediaUrl, media_type: 'image' }] : [])
          }
        }
      };
    })
  });

  useEffect(() => {
    const fetchUserAndCart = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      let loadedCart = null;
      if (user) {
        loadedCart = await getCart(user.id);
        setCart(loadedCart);
      } else {
        const guestCartData = await getGuestCart();
        loadedCart = normalizeGuestCart(guestCartData);
        setCart(loadedCart);
      }

      // Resolve seller delivery rules (e.g. threshold >= ₹200)
      const targetSeller = sellerId || loadedCart?.cart_items?.[0]?.product_variant_combinations?.products?.user_id || null;
      if (targetSeller) {
        try {
          const { data: sellerProf } = await supabase
            .from('profiles')
            .select('enable_delivery, default_delivery_fee, free_delivery_threshold')
            .eq('id', targetSeller)
            .maybeSingle();

          if (sellerProf) {
            setSellerDeliveryConfig({
              enable_delivery: sellerProf.enable_delivery !== false,
              default_delivery_fee: sellerProf.default_delivery_fee !== null && sellerProf.default_delivery_fee !== undefined ? Number(sellerProf.default_delivery_fee) : 30,
              free_delivery_threshold: sellerProf.free_delivery_threshold !== null && sellerProf.free_delivery_threshold !== undefined ? Number(sellerProf.free_delivery_threshold) : 200,
            });
          }
        } catch (_) {}
      }

      setLoading(false);
    };

    fetchUserAndCart();
  }, [sellerId]);

  const handleUpdateQuantity = async (cartItemId, quantity) => {
    if (quantity < 1) {
      handleRemoveItem(cartItemId);
      return;
    }
    if (user) {
      const updatedItem = await updateCartItem(cartItemId, quantity);
      if (updatedItem) {
        const newCart = { ...cart };
        const itemIndex = newCart.cart_items.findIndex((item) => item.id === cartItemId);
        newCart.cart_items[itemIndex].quantity = quantity;
        setCart(newCart);
      }
    } else {
      await updateGuestCartItemQuantity(cartItemId, quantity);
      const guestCartData = await getGuestCart();
      setCart(normalizeGuestCart(guestCartData));
    }
  };

  const handleRemoveItem = async (cartItemId) => {
    if (user) {
      await removeCartItem(cartItemId);
      const newCart = { ...cart };
      newCart.cart_items = newCart.cart_items.filter((item) => item.id !== cartItemId);
      setCart(newCart);
    } else {
      await removeGuestCartItem(cartItemId);
      const guestCartData = await getGuestCart();
      setCart(normalizeGuestCart(guestCartData));
    }
  };

  const getItemImageUrl = (item) => {
    const prod = item?.product_variant_combinations?.products;
    if (prod?.product_media && Array.isArray(prod.product_media) && prod.product_media.length > 0) {
      const found = prod.product_media.find(m => m?.media_url);
      if (found?.media_url) return found.media_url;
    }
    if (prod?.image_url) return prod.image_url;
    if (item?.image_url) return item.image_url;
    return null;
  };

  const renderCartItem = ({ item }) => {
    const imageUrl = getItemImageUrl(item);
    const combo = item?.product_variant_combinations;
    const prod = combo?.products;
    const itemOffer = calculateProductOffer(prod, combo);
    const priceVal = combo?.price !== undefined ? combo.price : (item?.price || 0);

    return (
      <View style={styles.itemContainer}>
        {imageUrl ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openCartImageViewer(item)}
            accessibilityLabel={`View full image for ${prod?.product_name || 'Product'}`}
          >
            <Image
              style={styles.itemImage}
              source={{ uri: imageUrl }}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ) : (
          <View style={[styles.itemImage, styles.placeholderImage]}>
            <Icon name="shopping-bag" size={24} color="#94a3b8" />
          </View>
        )}
        <View style={styles.itemDetails}>
          <Text style={styles.itemName}>{prod?.product_name || 'Product'}</Text>
          <Text style={styles.itemVariant}>{combo?.combination_string || ''}</Text>
          <View style={styles.itemPriceRow}>
            <Text style={styles.itemPrice}>₹{priceVal}</Text>
            {itemOffer.hasOffer && itemOffer.mrp ? (
              <Text style={styles.itemStrikeMrp}>₹{itemOffer.mrp}</Text>
            ) : null}
            {itemOffer.hasOffer && itemOffer.badgeText ? (
              <View style={styles.itemOfferBadge}>
                <Text style={styles.itemOfferBadgeText}>{itemOffer.badgeText}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.quantityContainer}>
            <TouchableOpacity onPress={() => handleUpdateQuantity(item.id, item.quantity - 1)} style={{ padding: 4 }}>
              <Icon name="minus-circle" size={24} color="#E53935" />
            </TouchableOpacity>
            <Text style={styles.quantityText}>{item.quantity}</Text>
            <TouchableOpacity onPress={() => handleUpdateQuantity(item.id, item.quantity + 1)} style={{ padding: 4 }}>
              <Icon name="plus-circle" size={24} color="#43A047" />
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity onPress={() => handleRemoveItem(item.id)} style={{ padding: 10 }}>
          <Icon name="trash" size={22} color="#E53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const totalAmount = (cart?.cart_items || []).reduce(
    (sum, item) =>
      sum +
      Number(item?.product_variant_combinations?.price || item?.price || 0) *
        Number(item?.quantity || 1),
    0
  );

  const cartSavings = calculateCartSavings(cart?.cart_items || []);
  const deliveryCalc = calculateOrderDeliveryFee(totalAmount, sellerDeliveryConfig);

  const handleCheckout = () => {
    let customerIdToPass = null;
    if (user?.user_metadata?.customerId) {
      customerIdToPass = user.user_metadata.customerId;
    } else if (cart?.cart_items?.length > 0) {
      customerIdToPass =
        cart.cart_items[0]?.product_variant_combinations?.products?.customer_id || null;
    }
    const resolvedSellerId = sellerId || cart?.cart_items?.[0]?.product_variant_combinations?.products?.user_id || null;
    navigation.navigate('Checkout', {
      ...(route?.params || {}),
      cart: cart,
      customerId: customerIdToPass || customerId,
      sellerId: resolvedSellerId,
      sellerName: sellerName,
      sellerDeliveryConfig: sellerDeliveryConfig,
    });
  };

  const renderCartHeader = () => {
    return (
      <View style={styles.cartBannersWrapper}>
        {/* Free Delivery Threshold Banner (e.g. Orders >= ₹200) */}
        {sellerDeliveryConfig?.enable_delivery !== false && (
          deliveryCalc.isFreeDelivery ? (
            <View style={styles.freeDeliveryUnlockedBanner}>
              <Icon name="truck" size={15} color="#059669" style={{ marginRight: 8 }} />
              <Text style={styles.freeDeliveryUnlockedText}>
                🎉 You unlocked <Text style={{ fontWeight: '800' }}>FREE Delivery</Text> on this order!
              </Text>
            </View>
          ) : (
            <View style={styles.freeDeliveryProgressBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Icon name="motorcycle" size={15} color="#D97706" style={{ marginRight: 8 }} />
                <Text style={styles.freeDeliveryProgressText}>
                  Add <Text style={{ fontWeight: '800', color: '#B45309' }}>₹{deliveryCalc.amountNeededForFree.toFixed(0)}</Text> more for <Text style={{ fontWeight: '800', color: '#059669' }}>FREE Delivery</Text>!
                </Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, Math.max(8, (totalAmount / (deliveryCalc.freeThreshold || 200)) * 100))}%` },
                  ]}
                />
              </View>
            </View>
          )
        )}

        {/* Total Cart Savings on MRP Banner */}
        {cartSavings.hasSavings && (
          <View style={styles.cartSavingsBanner}>
            <Icon name="tags" size={14} color="#059669" style={{ marginRight: 8 }} />
            <Text style={styles.cartSavingsBannerText}>
              🎉 You are saving <Text style={{ fontWeight: '800' }}>₹{cartSavings.totalSavings.toFixed(2)}</Text> with offers on this order!
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!cart || cart.cart_items.length === 0) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backHeaderBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={16} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your Cart</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
            <Icon name="close" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyCartBox}>
          <Icon name="shopping-cart" size={64} color="#cbd5e1" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyCartTitle}>Your cart is empty</Text>
          <Text style={styles.emptyCartSubtitle}>
            Browse our catalog and discover amazing items to add to your cart.
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => navigation.navigate('Catalog', { sellerId, sellerName, customerId, isDirectQr })}
          >
            <Text style={styles.browseButtonText}>Browse Catalog</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Navigation Footer (Store, Cart, Orders) */}
        <StoreNavigationFooter
          activeTab="cart"
          navigation={navigation}
          route={route}
          sellerId={sellerId}
          sellerName={sellerName}
          customerId={customerId}
          isDirectQr={isDirectQr}
          forceShow={true}
        />
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHeaderBtn}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('Catalog', { sellerId, sellerName, customerId, isDirectQr });
            }
          }}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Cart</Text>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('Catalog', { sellerId, sellerName, customerId, isDirectQr });
            }
          }}
          accessibilityLabel="Close"
        >
          <Icon name="close" size={20} color="#64748B" />
        </TouchableOpacity>
      </View>

      {/* Cart Items List */}
      <FlatList
        data={cart.cart_items}
        renderItem={renderCartItem}
        ListHeaderComponent={renderCartHeader}
        keyExtractor={(item) => item.id.toString()}
        style={[
          styles.list,
          Platform.OS === 'web' ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0 } : null,
        ]}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        contentContainerStyle={[styles.listContent, { paddingBottom: 110 }]}
      />

      {/* Docked Action Footer Bar */}
      <View style={styles.dockedFooterBar}>
        <View style={styles.footerTotalBox}>
          <Text style={styles.footerTotalLabel}>
            Total ({cart.cart_items.length} {cart.cart_items.length === 1 ? 'item' : 'items'})
          </Text>
          <Text style={styles.footerTotalAmount}>₹{totalAmount.toFixed(2)}</Text>
          {cartSavings.hasSavings ? (
            <Text style={styles.footerSavingsTag}>Saved ₹{cartSavings.totalSavings.toFixed(0)} with offers</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.checkoutButton}
          onPress={handleCheckout}
          activeOpacity={0.85}
        >
          <Text style={styles.checkoutButtonText}>Proceed to Checkout</Text>
          <Icon name="arrow-right" size={14} color="#FFFFFF" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      </View>

      {/* Bottom Navigation Footer (Store, Cart, Orders) */}
      <StoreNavigationFooter
        activeTab="cart"
        navigation={navigation}
        route={route}
        sellerId={sellerId}
        sellerName={sellerName}
        customerId={customerId}
        isDirectQr={isDirectQr}
        forceShow={true}
      />

      {/* Fullscreen Media Viewer with Horizontal Swipe/Scroll & Thumbnails */}
      <FullScreenImageViewer
        visible={isViewerVisible}
        mediaList={viewerImages}
        initialIndex={viewerIndex}
        onClose={() => setIsViewerVisible(false)}
        title="Cart Items"
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
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
  list: {
    flex: 1,
    width: '100%',
  },
  listContent: {
    padding: 14,
    paddingBottom: 24,
    flexGrow: 1,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  placeholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  itemDetails: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  itemVariant: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#007AFF',
    marginTop: 4,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  quantityText: {
    marginHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyCartBox: {
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
  footerTotalBox: {
    flex: 1,
  },
  footerTotalLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  footerTotalAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  checkoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  checkoutButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  itemPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 4,
  },
  itemStrikeMrp: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
    fontWeight: '500',
  },
  itemOfferBadge: {
    backgroundColor: '#DCFCE7',
    borderWidth: 0.5,
    borderColor: '#86EFAC',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  itemOfferBadgeText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
  },
  cartBannersWrapper: {
    marginBottom: 12,
  },
  freeDeliveryUnlockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
  },
  freeDeliveryUnlockedText: {
    fontSize: 12.5,
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
  },
  freeDeliveryProgressBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
  },
  freeDeliveryProgressText: {
    fontSize: 12.5,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#FDE68A',
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 3,
  },
  cartSavingsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  cartSavingsBannerText: {
    fontSize: 12.5,
    color: '#15803D',
    fontWeight: '600',
    flex: 1,
  },
  footerSavingsTag: {
    fontSize: 10.5,
    color: '#15803D',
    fontWeight: '700',
    marginTop: 2,
  },
});

export default CartScreen;