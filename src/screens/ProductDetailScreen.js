import React, { useState, useEffect, useMemo } from 'react';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Video } from 'expo-av';
import Swiper from 'react-native-swiper';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import SellerContactShareModal from '../components/SellerContactShareModal';
import { addToCart, supabase } from '../services/supabase';
import { getFavoriteProductIds, toggleFavoriteProductId } from '../services/localStorageService';

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

const ProductDetailScreen = ({ navigation, route }) => {
  const { product: initialProduct, productId } = route?.params || {};
  const [product, setProduct] = useState(initialProduct || null);
  const [loadingProduct, setLoadingProduct] = useState(!initialProduct && !!productId);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [user, setUser] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [initialMediaIndex, setInitialMediaIndex] = useState(0);
  const [otherProducts, setOtherProducts] = useState(route?.params?.allProducts || []);
  const [isFav, setIsFav] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState([]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (product?.id) {
        try {
          const favs = await getFavoriteProductIds();
          if (isMounted) {
            setFavoriteProductIds(favs || []);
            setIsFav(favs.some((id) => String(id) === String(product.id)));
          }
        } catch (e) {
          console.warn('Error checking favorite:', e);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [product?.id]);

  const handleToggleFav = async (targetId = product?.id) => {
    if (!targetId) return;
    try {
      const updated = await toggleFavoriteProductId(targetId);
      setFavoriteProductIds(updated || []);
      if (product?.id) {
        setIsFav(updated.some((id) => String(id) === String(product.id)));
      }
    } catch (e) {
      console.warn('Error toggling favorite:', e);
    }
  };

  useEffect(() => {
    if (product?.seller_id && otherProducts.length === 0) {
      supabase
        .from('products')
        .select('id, product_name, amount, image_url, product_media (id, media_url, media_type)')
        .eq('seller_id', product.seller_id)
        .neq('id', product.id)
        .limit(20)
        .then(({ data }) => {
          if (data && data.length > 0) {
            setOtherProducts(data);
          }
        });
    }
  }, [product?.seller_id]);

  useEffect(() => {
    if (!product && productId) {
      const fetchProduct = async () => {
        setLoadingProduct(true);
        try {
          const { data, error } = await supabase
            .from('products')
            .select(`
              *,
              product_media (id, media_url, media_type),
              product_variants (
                id,
                name,
                variant_options (id, value)
              ),
              product_variant_combinations (id, combination_string, price, quantity, sku)
            `)
            .eq('id', productId)
            .single();
          if (data) {
            setProduct(data);
          }
        } catch (err) {
          console.error('Error fetching product by ID:', err);
        } finally {
          setLoadingProduct(false);
        }
      };
      fetchProduct();
    }
  }, [productId, product]);

  useEffect(() => {
    const defaultVariants = {};
    if (product?.product_variants) {
      product.product_variants.forEach(variant => {
        if (variant.variant_options && variant.variant_options.length > 0) {
          defaultVariants[variant.name] = variant.variant_options[0].value;
        }
      });
    }
    setSelectedVariants(defaultVariants);
  }, [product]);

  const handleVariantSelect = (variantName, optionValue) => {
    setSelectedVariants({
      ...selectedVariants,
      [variantName]: optionValue,
    });
  };

  const getVariantCombination = () => {
    if (!product) return null;
    const combos = product.product_variant_combinations || [];
    if (combos.length === 0) {
      return { id: product.id, combination_string: 'Default', price: product.amount || 0, quantity: 100 };
    }
    if (combos.length === 1) {
      return combos[0];
    }
    const sortedKeys = Object.keys(selectedVariants).sort();
    const combinationString = sortedKeys
      .map((key) => `${key}:${selectedVariants[key]}`)
      .join(',');

    const normalizedCombinationString = combinationString.replace(/\s/g, '');

    const found = combos.find(
      (c) => {
        if (c.combination_string) {
          const normalizedDbString = c.combination_string.replace(/\s/g, '');
          return normalizedDbString === normalizedCombinationString;
        }
        return false;
      }
    );
    return found || combos[0];
  };

  const handleAddToCart = async () => {
    const combination = getVariantCombination();
    if (!combination) {
      Alert.alert('Error', 'Product information is incomplete.');
      return;
    }

    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      navigation.navigate('BuyerLogin', {
        redirectTo: 'ProductDetailScreen',
        redirectParams: { productId: product.id },
      });
      return;
    }

    const result = await addToCart(currentUser.id, combination.id, quantity);
    if (result) {
      Alert.alert('Success', `${quantity} item(s) added to cart.`);
    } else {
      Alert.alert('Error', 'Failed to add item to cart.');
    }
  };

  if (loadingProduct) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Text style={{ fontSize: 16, color: '#666' }}>Product not found.</Text>
      </View>
    );
  }

  const mediaList = useMemo(() => {
    const raw = (product.product_media || []).filter(m => m && (m.media_url || m.uri));
    if (raw.length > 0) return raw;
    if (product?.image_url) {
      return [{ id: 'prod-img', media_url: product.image_url, uri: product.image_url, media_type: 'image' }];
    }
    return [];
  }, [product]);

  const fullViewerMedia = useMemo(() => {
    const list = [];
    if (mediaList.length > 0) {
      mediaList.forEach((m, idx) => {
        list.push({
          id: `this-prod-${m.id || idx}`,
          productId: product?.id,
          uri: m.media_url || m.uri,
          type: m.media_type || 'image',
          title: mediaList.length > 1 ? `${product.product_name} (${idx + 1}/${mediaList.length})` : product.product_name,
          subtitle: product.amount ? `₹${product.amount}` : null,
        });
      });
    } else if (product?.image_url) {
      list.push({
        id: `this-prod-img`,
        productId: product?.id,
        uri: product.image_url,
        type: 'image',
        title: product.product_name,
        subtitle: product.amount ? `₹${product.amount}` : null,
      });
    }

    (otherProducts || []).forEach((p) => {
      const pMedia = (p?.product_media || []).filter(m => m && (m.media_url || m.uri));
      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          list.push({
            id: `other-${p.id}-${m.id || mIdx}`,
            productId: p.id,
            uri: m.media_url || m.uri,
            type: m.media_type || 'image',
            title: pMedia.length > 1 ? `${p.product_name} (${mIdx + 1}/${pMedia.length})` : p.product_name,
            subtitle: p.amount ? `₹${p.amount}` : null,
          });
        });
      } else if (p.image_url) {
        list.push({
          id: `other-${p.id}-img`,
          productId: p.id,
          uri: p.image_url,
          type: 'image',
          title: p.product_name,
          subtitle: p.amount ? `₹${p.amount}` : null,
        });
      }
    });

    return list;
  }, [product, mediaList, otherProducts]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Top Floating Action Bar with Back, Share (Highlight Mode), and Favorite */}
      <View style={styles.topFloatingBar}>
        <TouchableOpacity
          style={styles.floatingCircleBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <Icon name="arrow-left" size={17} color="#1E293B" />
        </TouchableOpacity>

        <View style={styles.topRightActions}>
          {/* Share & Contact Seller Button beside Favorite */}
          <TouchableOpacity
            style={[styles.floatingCircleBtn, styles.floatingCircleBtnShareHighlight]}
            onPress={() => setShareModalVisible(true)}
            activeOpacity={0.75}
            accessibilityLabel="Share product & contact seller"
          >
            <Icon name="share-alt" size={16} color="#0284C7" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.floatingCircleBtn, isFav && styles.floatingCircleBtnFavActive]}
            onPress={handleToggleFav}
            accessibilityLabel={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Icon name={isFav ? 'heart' : 'heart-o'} size={17} color={isFav ? '#EF4444' : '#1E293B'} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.container}>
      {mediaList.length > 0 ? (
        <Swiper style={styles.swiper} showsButtons={mediaList.length > 1} loop={mediaList.length > 1}>
          {mediaList.map((media, index) => {
            const mediaUrl = media.media_url || media.uri;
            const isImage = isImageMedia(media);
            return (
              <View key={media.id || `media-${index}`} style={styles.slide}>
                <TouchableOpacity
                  onPress={() => {
                    setInitialMediaIndex(index);
                    setIsModalVisible(true);
                  }}
                  style={styles.mediaContainer}
                  activeOpacity={0.9}
                >
                  {isImage ? (
                    <Image
                      source={{ uri: mediaUrl }}
                      style={styles.media}
                      resizeMode="contain"
                    />
                  ) : (
                    <Video
                      source={{ uri: mediaUrl }}
                      style={styles.media}
                      useNativeControls
                      resizeMode="contain"
                    />
                  )}
                  {isImage && (
                    <TouchableOpacity
                      style={styles.zoomIcon}
                      onPress={() => {
                        setInitialMediaIndex(index);
                        setIsModalVisible(true);
                      }}
                    >
                      <MaterialIcons name="zoom-out-map" size={24} color="white" />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </Swiper>
      ) : (
        <View style={styles.placeholderBanner}>
          <Icon name="shopping-bag" size={64} color="#94a3b8" />
          <Text style={styles.placeholderText}>{product.product_name}</Text>
        </View>
      )}

      <View style={styles.detailsContainer}>
        <Text style={styles.productName}>{product.product_name}</Text>
        <Text style={styles.productPrice}>₹{product.amount}{product.unit ? ` / ${product.unit}` : ''}</Text>

        {(product.product_type || product.subcategory) && (
          <View style={styles.badgeRow}>
            {product.product_type ? (
              <View style={styles.catBadge}>
                <Icon name="tag" size={11} color="#007AFF" style={{ marginRight: 4 }} />
                <Text style={styles.catBadgeText}>
                  {(product.product_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Text>
              </View>
            ) : null}
            {product.subcategory ? (
              <View style={styles.subCatBadge}>
                <Icon name="bookmark" size={11} color="#059669" style={{ marginRight: 4 }} />
                <Text style={styles.subCatBadgeText}>{product.subcategory}</Text>
              </View>
            ) : null}
          </View>
        )}

        {product.description ? (
          <Text style={styles.productDescription}>{product.description}</Text>
        ) : null}

        {(product.product_variants || []).map((variant) => (
          <View key={variant.id} style={styles.variantContainer}>
            <Text style={styles.variantName}>{variant.name}</Text>
            <View style={styles.optionsContainer}>
              {(variant.variant_options || []).map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionButton,
                    selectedVariants[variant.name] === option.value && styles.selectedOption,
                  ]}
                  onPress={() => handleVariantSelect(variant.name, option.value)}
                >
                  <Text>{option.value}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Quantity selector */}
        <View style={styles.quantitySelector}>
          <Text style={styles.quantityLabel}>Quantity:</Text>
          <View style={styles.quantityControls}>
            <TouchableOpacity 
              onPress={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              style={{ padding: 4 }}
            >
              <Icon name="minus-circle" size={30} color={quantity <= 1 ? '#ccc' : '#E53935'} />
            </TouchableOpacity>
            <Text style={styles.quantityText}>{quantity}</Text>
            <TouchableOpacity 
              onPress={() => setQuantity(quantity + 1)}
              style={{ padding: 4 }}
            >
              <Icon name="plus-circle" size={30} color="#43A047" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.addToCartButton} onPress={handleAddToCart}>
          <Icon name="shopping-cart" size={20} color="#fff" style={{ marginRight: 10 }} />
          <Text style={styles.addToCartButtonText}>Add to Cart</Text>
        </TouchableOpacity>
      </View>

      <FullScreenImageViewer
        visible={isModalVisible}
        mediaList={fullViewerMedia}
        initialIndex={initialMediaIndex}
        onClose={() => setIsModalVisible(false)}
        title={product?.product_name || 'Product Media'}
        onToggleFavorite={(target) => {
          const tId = typeof target === 'object' ? (target.productId || target.id) : target;
          handleToggleFav(tId || product?.id);
        }}
        onShare={() => setShareModalVisible(true)}
        favoriteProductIds={favoriteProductIds}
        isFavorite={isFav}
      />

      {/* Seller Contact & Share Modal with Highlight Mode */}
      <SellerContactShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        product={product}
        sellerId={product?.user_id || product?.customer_id || route?.params?.sellerId}
        storeName={route?.params?.sellerName || ''}
      />
    </ScrollView>
  </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  swiper: {
    height: 300,
  },
  placeholderBanner: {
    height: 250,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  placeholderText: {
    marginTop: 10,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  detailsContainer: {
    padding: 20,
  },
  productName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  productPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: '#BFDBFE',
    marginRight: 6,
    marginBottom: 4,
  },
  catBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  subCatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: '#A7F3D0',
    marginRight: 6,
    marginBottom: 4,
  },
  subCatBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  productDescription: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  variantContainer: {
    marginBottom: 20,
  },
  variantName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  optionButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    marginRight: 10,
    marginBottom: 10,
  },
  selectedOption: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  mediaContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomIcon: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 5,
  },
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  quantityLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityText: {
    marginHorizontal: 15,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  addToCartButton: {
    backgroundColor: '#43A047',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: 10,
    marginTop: 10,
    elevation: 3,
  },
  addToCartButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  topFloatingBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
  },
  floatingCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 4,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  floatingCircleBtnShareHighlight: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
    shadowOpacity: 0.25,
  },
  floatingCircleBtnFavActive: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
});

export default ProductDetailScreen;
