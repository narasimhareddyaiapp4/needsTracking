import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { supabase, getProductsWithDetails, deleteProductMedia, deleteProduct, getCategories } from '../services/supabase';
import Icon from 'react-native-vector-icons/FontAwesome';
import { showAlert } from '../utils/alertUtils';
// import { Video } from 'expo-av'; // Temporarily commented out

import ProductFormModal from '../components/ProductFormModal';
import FullScreenImageViewer from '../components/FullScreenImageViewer';

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

const ProductScreen = ({ route, navigation }) => {
  const { session: initialSession, customerId } = route?.params || {};
  const [session, setSession] = useState(initialSession || null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const initSession = async () => {
      let currentSession = initialSession;
      if (!currentSession) {
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        currentSession = activeSession;
        setSession(activeSession);
      } else {
        setSession(initialSession);
      }

      const user = currentSession?.user ? currentSession.user : currentSession;

      if (!user) {
        console.log('ProductScreen: User is missing.');
        setUserId(null);
        setProducts([]);
        return;
      }

      const id = route?.params?.sellerId || user.id;
      setUserId(id);
      console.log('ProductScreen: User/Seller ID set:', id);
      fetchProducts(id);
    };

    initSession();
  }, [initialSession, route?.params?.sellerId]);
  
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]); // Stores fetched products
  const [showProductModal, setShowProductModal] = useState(false);
  const [productToEdit, setProductToEdit] = useState(null);
  const [customerMediaUrl, setCustomerMediaUrl] = useState(null); // Renamed from customerBucketUrl
  const [showMediaViewer, setShowMediaViewer] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [allMediaForViewer, setAllMediaForViewer] = useState([]);
  const [viewerProductTitle, setViewerProductTitle] = useState('');
  const [categoriesList, setCategoriesList] = useState([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const openProductMediaViewer = (selectedProduct, mediaIndex = 0) => {
    const listToSearch = filteredProducts && filteredProducts.length > 0 ? filteredProducts : products;
    const mediaList = [];
    let targetIdx = 0;
    let foundTarget = false;

    (listToSearch || []).forEach((prod) => {
      const pMedia = (prod?.product_media || []).filter(m => m && (m.media_url || m.uri));
      if (pMedia.length > 0) {
        pMedia.forEach((m, idx) => {
          if (!foundTarget && String(prod.id) === String(selectedProduct?.id) && idx === mediaIndex) {
            targetIdx = mediaList.length;
            foundTarget = true;
          }
          mediaList.push({
            id: `prod-${prod.id}-m-${m.id || idx}`,
            uri: m.media_url || m.uri,
            type: m.media_type || (isImageMedia(m) ? 'image' : 'video'),
            title: pMedia.length > 1 ? `${prod.product_name} (${idx + 1}/${pMedia.length})` : prod.product_name,
            subtitle: prod.amount ? `₹${prod.amount}` : null,
          });
        });
      } else if (prod?.image_url) {
        if (!foundTarget && String(prod.id) === String(selectedProduct?.id)) {
          targetIdx = mediaList.length;
          foundTarget = true;
        }
        mediaList.push({
          id: `prod-${prod.id}-img`,
          uri: prod.image_url,
          type: 'image',
          title: prod.product_name,
          subtitle: prod.amount ? `₹${prod.amount}` : null,
        });
      }
    });

    if (mediaList.length === 0 && selectedProduct?.product_media) {
      selectedProduct.product_media.forEach((m, idx) => {
        mediaList.push({
          id: `fallback-${m.id || idx}`,
          uri: m.media_url || m.uri,
          type: m.media_type || (isImageMedia(m) ? 'image' : 'video'),
          title: selectedProduct.product_name,
          subtitle: selectedProduct.amount ? `₹${selectedProduct.amount}` : null,
        });
      });
      targetIdx = Math.min(Math.max(0, mediaIndex), mediaList.length - 1);
    }

    if (mediaList.length > 0) {
      setAllMediaForViewer(mediaList);
      setCurrentMediaIndex(targetIdx);
      setViewerProductTitle(selectedProduct?.product_name || 'Product Media');
      setShowMediaViewer(true);
    }
  };

  // Load categories from database
  useEffect(() => {
    let isMounted = true;
    const loadCats = async () => {
      try {
        const cats = await getCategories(false);
        if (isMounted && cats && cats.length > 0) {
          setCategoriesList(cats);
        }
      } catch (err) {
        console.warn('Error loading categories in ProductScreen:', err);
      }
    };
    loadCats();
    return () => { isMounted = false; };
  }, []);

  const getCategoryLabel = (type) => {
    if (!type) return '';
    const match = categoriesList.find(
      (c) => (c.code || '').toLowerCase() === type.toLowerCase() || (c.id || '').toLowerCase() === type.toLowerCase()
    );
    return match ? match.name : type.charAt(0).toUpperCase() + type.slice(1);
  };

  const categoryCounts = useMemo(() => {
    const counts = { all: products.length };
    products.forEach((p) => {
      const cat = (p?.product_type || 'other').toLowerCase();
      counts[cat] = (counts[cat] || 0) + 1;
      if (p?.category_id) {
        counts[p.category_id.toLowerCase()] = (counts[p.category_id.toLowerCase()] || 0) + 1;
      }
    });
    return counts;
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedCategoryFilter && selectedCategoryFilter !== 'all') {
      const target = selectedCategoryFilter.toLowerCase();
      const catObj = categoriesList.find(
        (c) => (c.code || '').toLowerCase() === target || (c.id || '').toLowerCase() === target
      );
      list = list.filter((p) => {
        const pType = (p?.product_type || 'other').toLowerCase();
        const pCatId = (p?.category_id || '').toLowerCase();
        return pType === target || (catObj?.code && pType === catObj.code.toLowerCase()) || (catObj?.id && pCatId === catObj.id.toLowerCase());
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((p) => {
        const nameMatch = (p?.product_name || '').toLowerCase().includes(q);
        const typeMatch = (p?.product_type || '').toLowerCase().includes(q);
        const subMatch = (p?.subcategory || '').toLowerCase().includes(q);
        const catLabelMatch = getCategoryLabel(p?.product_type || '').toLowerCase().includes(q);
        return nameMatch || typeMatch || subMatch || catLabelMatch;
      });
    }
    return list;
  }, [products, selectedCategoryFilter, searchQuery, categoriesList]);

  // Define fetchProductsAndMediaUrl outside useEffect to ensure stable reference
  const fetchProducts = async (currentUserId) => { // Accept userId as parameter
    console.log('ProductScreen: fetchProducts called. Current userId:', currentUserId);
    const user = session?.user ? session.user : session;

    if (!user || !currentUserId) { // Use currentUserId
      console.log('ProductScreen: Skipping fetchProducts due to missing user or userId.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getProductsWithDetails(currentUserId); // Use currentUserId
      console.log('ProductScreen: Data received from getProductsWithDetails:', data);
      if (data) {
        setProducts(data);
        console.log('ProductScreen: products state after setProducts:', data);
      }
    } catch (error) {
      console.error("ProductScreen: Error in fetching products:", error.message);
      showAlert("Error", "An unexpected error occurred while fetching data.");
    } finally {
      setLoading(false);
    }
  };

  

  const handleEditProduct = (product) => {
    setProductToEdit(product);
    setShowProductModal(true);
  };

  const handleModalSubmit = () => {
    fetchProducts(userId); // Refresh the list after add/edit
  };

  const handleDeleteProductMedia = async (mediaId, mediaUrl) => {
    return new Promise((resolve) => {
      showAlert(
        "Delete Media",
        "Are you sure you want to delete this media? This action cannot be undone.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: "Delete",
            onPress: async () => {
              setLoading(true);
              const success = await deleteProductMedia(mediaId, mediaUrl);
              if (success) {
                showAlert("Success", "Media deleted successfully.");
                fetchProducts(userId); // Refresh the list
                resolve(true);
              } else {
                showAlert("Error", "Failed to delete media.");
                resolve(false);
              }
              setLoading(false);
            },
          },
        ]
      );
    });
  };

  const handleDeleteProduct = (productId) => {
    showAlert(
      "Delete Product",
      "Are you sure you want to delete this product and all its associated media? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          onPress: async () => {
            setLoading(true);
            const success = await deleteProduct(productId);
            if (success) {
              showAlert("Success", "Product deleted successfully.");
              fetchProducts(userId); // Refresh the list
            } else {
              showAlert("Error", "Failed to delete product.");
            }
            setLoading(false);
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.productsListTitle}>Your Products</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('CatalogManagement', { fromTab: 'store', sellerId: userId, customerId })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#EFF6FF',
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: '#BFDBFE',
            }}
            accessibilityLabel="Manage Catalog"
          >
            <Icon name="tags" size={13} color="#007AFF" style={{ marginRight: 5 }} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#007AFF' }}>Catalog</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ProductMapScreen', { userId })}>
            <Icon name="map" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search and Category Filter Bar */}
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
          <Icon name="search" size={14} color="#94A3B8" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products, category, subcategory..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="times-circle" size={16} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryFilterContainer}
        >
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategoryFilter === 'all' && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategoryFilter('all')}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategoryFilter === 'all' && styles.categoryChipTextActive,
              ]}
            >
              All ({products.length})
            </Text>
          </TouchableOpacity>
          {categoriesList.map((cat) => {
            const isSel = selectedCategoryFilter === (cat.code || cat.id);
            const cnt = categoryCounts[cat.code] || categoryCounts[cat.id] || 0;
            if (cnt === 0 && !isSel) return null;
            return (
              <TouchableOpacity
                key={cat.id || cat.code}
                style={[styles.categoryChip, isSel && styles.categoryChipActive]}
                onPress={() => setSelectedCategoryFilter(isSel ? 'all' : (cat.code || cat.id))}
              >
                <Icon
                  name={cat.icon || 'tag'}
                  size={11}
                  color={isSel ? '#FFFFFF' : '#475569'}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    isSel && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.name} ({cnt})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" />
      ) : filteredProducts.length > 0 ? (
        <View style={{flex: 1}}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderCellEdit]}>Edit</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'left', paddingLeft: 4 }]}>Product & Catalog</Text>
            <Text style={styles.tableHeaderCell}>Price</Text>
            <Text style={styles.tableHeaderCell}>Validity</Text>
            <Text style={styles.tableHeaderCell}>Media</Text>
          </View>
          <FlatList
            data={filteredProducts}
            renderItem={({ item }) => {
              return (
                <View style={styles.productRow}>
                  <TouchableOpacity onPress={() => handleEditProduct(item)} style={styles.editIcon}>
                    <Icon name="edit" size={20} color="#007AFF" />
                  </TouchableOpacity>
                  <View style={styles.productCellInfo}>
                    <Text style={styles.productNameText} numberOfLines={2}>
                      {item.product_name}
                    </Text>
                    <View style={styles.badgeRow}>
                      {item.product_type ? (
                        <View style={styles.catBadge}>
                          <Icon name="tag" size={9} color="#007AFF" style={{ marginRight: 3 }} />
                          <Text style={styles.catBadgeText}>{getCategoryLabel(item.product_type)}</Text>
                        </View>
                      ) : null}
                      {item.subcategory ? (
                        <View style={styles.subCatBadge}>
                          <Icon name="bookmark" size={9} color="#059669" style={{ marginRight: 3 }} />
                          <Text style={styles.subCatBadgeText}>{item.subcategory}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.productCell}>
                    ₹{item.amount}
                    {item.unit ? `\n(${item.unit})` : ''}
                  </Text>
                  <Text style={[styles.productCell, { fontSize: 11, color: '#64748B' }]}>
                    {item.start_date ? new Date(item.start_date).toLocaleDateString() : '-'}
                    {item.end_date ? `\nto\n${new Date(item.end_date).toLocaleDateString()}` : ''}
                  </Text>
                  <View style={styles.productCellMedia}>
                    {item.product_media && item.product_media.length > 0 ? (
                      <FlatList
                        data={item.product_media}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        keyExtractor={(media, idx) => (media?.id ? media.id.toString() : `media-${idx}`)}
                        renderItem={({ item: media, index: mediaIndex }) => (
                          <TouchableOpacity
                            onPress={() => openProductMediaViewer(item, mediaIndex)}
                            style={styles.mediaContainer}
                            activeOpacity={0.85}
                            accessibilityLabel={`View full media for ${item.product_name || 'Product'}`}
                          >
                            {isImageMedia(media) && media.media_url ? (
                              <Image source={{ uri: media.media_url }} style={styles.productImage} />
                            ) : (
                              <Text style={styles.videoPlaceholder}>Video</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      />
                    ) : (
                      <View style={styles.noMediaPlaceholder}>
                        <Icon name="image" size={16} color="#bbb" />
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
            keyExtractor={(item) => item.id.toString()}
            style={styles.productsList}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 80 }}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      ) : (
        <View style={styles.center}>
          <Icon name="shopping-bag" size={40} color="#CBD5E1" style={{ marginBottom: 10 }} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#64748B' }}>No products found.</Text>
          {(searchQuery.trim().length > 0 || selectedCategoryFilter !== 'all') && (
            <TouchableOpacity
              onPress={() => { setSearchQuery(''); setSelectedCategoryFilter('all'); }}
              style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#007AFF', borderRadius: 6 }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Reset Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <ProductFormModal
        isVisible={showProductModal}
        onClose={() => {
    setShowProductModal(false);
    setProductToEdit(null);
  }}
        onSubmit={handleModalSubmit}
        productToEdit={productToEdit}
        customerMediaUrl={customerMediaUrl}
        onDeleteMedia={handleDeleteProductMedia}
        onDeleteProduct={handleDeleteProduct}
        session={session}
      />

      {/* Fullscreen Media Viewer with Horizontal Swipe/Scroll & Thumbnails */}
      <FullScreenImageViewer
        visible={showMediaViewer}
        mediaList={allMediaForViewer}
        initialIndex={currentMediaIndex}
        onClose={() => setShowMediaViewer(false)}
        title={viewerProductTitle || 'Product Media'}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => { setProductToEdit(null); setShowProductModal(true); }}
      >
        <Icon name="plus" size={24} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  filterSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1E293B',
    paddingVertical: 2,
  },
  categoryFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    marginRight: 6,
  },
  categoryChipActive: {
    backgroundColor: '#007AFF',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  productsListTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    right: 20,
    bottom: 20,
    backgroundColor: '#03A9F4',
    borderRadius: 30,
    elevation: 8,
    zIndex: 10,
  },
  productsList: {
    flex: 1,
    width: '100%',
    marginTop: 10,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  productCellInfo: {
    flex: 2,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  productNameText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#BFDBFE',
    marginRight: 4,
    marginBottom: 2,
  },
  catBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#007AFF',
  },
  subCatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#A7F3D0',
    marginRight: 4,
    marginBottom: 2,
  },
  subCatBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#059669',
  },
  productCell: {
    flex: 1,
    fontSize: 14,
    textAlign: 'center',
  },
  productCellMedia: {
    flex: 1.5,
    justifyContent: 'center',
  },
  productImage: {
    width: 40,
    height: 40,
    margin: 2,
    borderRadius: 3,
  },
  videoPlaceholder: {
    width: 40,
    height: 40,
    margin: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
    lineHeight: 40,
    fontSize: 8,
    backgroundColor: '#f0f0f0',
  },
  noMediaPlaceholder: {
    width: 40,
    height: 40,
    margin: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  mediaContainer: {
    position: 'relative',
    margin: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f0f0f0',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  tableHeaderCell: {
    flex: 1,
    fontWeight: 'bold',
    fontSize: 14,
    textAlign: 'center',
  },
  tableHeaderCellEdit: {
    flex: 0.5,
    textAlign: 'left',
    paddingLeft: 5
  },
  mediaViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1,
  },
  fullScreenMedia: {
    width: '100%',
    height: '80%',
  },
  noMediaText: {
    color: 'white',
    fontSize: 18,
  },
  mediaNavButton: {
    position: 'absolute',
    top: '50%',
    zIndex: 1,
    padding: 10,
  },
  mediaNavButtonLeft: {
    left: 10,
  },
  mediaNavButtonRight: {
    right: 10,
  },
  editIcon: {
    flex: 0.5,
    alignItems: 'flex-start',
    paddingLeft: 5,
  },
});

export default ProductScreen;
