import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Image,
  TouchableOpacity,
  Platform,
  StatusBar,
  SafeAreaView,
  useWindowDimensions,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  PanResponder,
  Animated,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { FontAwesome as Icon } from '@expo/vector-icons';

/**
 * Universal Full-Screen Media & Image Viewer
 * Features:
 * - Full image view in all scenarios (resizeMode="contain", no clipping)
 * - Responsive left/right navigation:
 *   1. Smooth Touch/Swipe Gestures (real-time interactive drag & slide with PanResponder)
 *   2. Prominent floating Left (<) & Right (>) navigation buttons
 *   3. Interactive bottom thumbnail strip with active highlight & auto-centering
 *   4. Web keyboard arrow navigation (ArrowLeft, ArrowRight, Escape)
 *   5. Mouse wheel & trackpad horizontal scroll support
 * - Cyclic navigation (wrap around first <-> last seamlessly)
 * - 1x / 2x / 3x zoom toggle with pan protection
 * - Video playback support with native controls
 * - Per-item dynamic title, subtitle badge, and item counter (e.g. 1 / 8)
 * - Instant rendering with background preloading of adjacent images
 * - Reliable image loading indicator with auto-timeout and graceful retry fallback
 */
const FullScreenImageViewer = ({
  visible = false,
  mediaList = [],
  initialIndex = 0,
  onClose,
  title,
  onToggleFavorite,
  onShare,
  favoriteProductIds = [],
  isFavorite,
}) => {
  const windowDims = useWindowDimensions();
  const screenWidth = windowDims.width || Dimensions.get('window').width || 360;
  const screenHeight = windowDims.height || Dimensions.get('window').height || 640;

  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
  const [imageLoadingMap, setImageLoadingMap] = useState({});
  const [imageErrorMap, setImageErrorMap] = useState({});
  const [zoomScale, setZoomScale] = useState(1);

  const currentIndexRef = useRef(initialIndex || 0);
  const thumbnailScrollRef = useRef(null);
  const loadedMapRef = useRef({});
  const loadingTimerRef = useRef(null);
  const lastWheelTime = useRef(0);

  // Animated values for slide drag & transitions
  const panX = useRef(new Animated.Value(0)).current;
  const slideOpacity = useRef(new Animated.Value(1)).current;

  // Normalize media items into { id, uri, type: 'image' | 'video', title, subtitle }
  const normalizedMedia = useMemo(() => {
    if (!mediaList || !Array.isArray(mediaList)) return [];
    return mediaList
      .map((item, idx) => {
        if (!item) return null;
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (!trimmed) return null;
          const isVid = !!trimmed.match(/\.(mp4|mov|webm|m4v|avi)($|\?)/i);
          return {
            id: `media-str-${idx}-${trimmed}`,
            uri: trimmed,
            type: isVid ? 'video' : 'image',
            title: null,
            subtitle: null,
          };
        }
        const uri = item.uri || item.url || item.media_url || item.file_url || item.image_url;
        if (!uri || typeof uri !== 'string' || !uri.trim()) return null;
        const cleanUri = uri.trim();
        const type = (item.type || item.media_type || item.file_type || '').toLowerCase();
        const isVid = type.includes('video') || !!cleanUri.match(/\.(mp4|mov|webm|m4v|avi)($|\?)/i);
        return {
          id: item.id ? `${String(item.id)}-${idx}` : `media-obj-${idx}-${cleanUri}`,
          productId: item.productId || item.product_id || null,
          uri: cleanUri,
          type: isVid ? 'video' : 'image',
          title: item.title || item.name || item.product_name || item.label || null,
          subtitle: item.subtitle || (item.price || item.amount ? `₹${item.amount || item.price}` : null),
        };
      })
      .filter(Boolean);
  }, [mediaList]);

  const totalCount = normalizedMedia.length;

  // Keep currentIndexRef synchronized
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Center active thumbnail in bottom carousel
  const centerThumbnail = useCallback(
    (index) => {
      if (thumbnailScrollRef.current && totalCount > 1) {
        const thumbWidth = 64; // 54 thumb width + 10 gap
        const scrollOffset = Math.max(0, index * thumbWidth - screenWidth / 2 + thumbWidth / 2);
        setTimeout(() => {
          if (thumbnailScrollRef.current && typeof thumbnailScrollRef.current.scrollTo === 'function') {
            thumbnailScrollRef.current.scrollTo({ x: scrollOffset, animated: true });
          }
        }, 50);
      }
    },
    [totalCount, screenWidth]
  );

  // Jump to specific index with smooth directional transition
  const goToIndex = useCallback(
    (index, direction = 'none') => {
      if (totalCount === 0) return;
      let safeIdx = index;
      if (safeIdx < 0) safeIdx = totalCount - 1;
      if (safeIdx >= totalCount) safeIdx = 0;

      if (safeIdx === currentIndexRef.current && zoomScale === 1) return;

      setZoomScale(1);
      setCurrentIndex(safeIdx);
      currentIndexRef.current = safeIdx;
      centerThumbnail(safeIdx);

      // Transition animations
      if (direction === 'next') {
        panX.setValue(36);
        slideOpacity.setValue(0.5);
        Animated.parallel([
          Animated.timing(panX, {
            toValue: 0,
            duration: 160,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(slideOpacity, {
            toValue: 1,
            duration: 160,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start();
      } else if (direction === 'prev') {
        panX.setValue(-36);
        slideOpacity.setValue(0.5);
        Animated.parallel([
          Animated.timing(panX, {
            toValue: 0,
            duration: 160,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(slideOpacity, {
            toValue: 1,
            duration: 160,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start();
      } else {
        panX.setValue(0);
        slideOpacity.setValue(0.65);
        Animated.timing(slideOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
    },
    [totalCount, zoomScale, centerThumbnail, panX, slideOpacity]
  );

  const handleNext = useCallback(() => {
    if (totalCount <= 1) return;
    const nextIdx = currentIndexRef.current < totalCount - 1 ? currentIndexRef.current + 1 : 0;
    goToIndex(nextIdx, 'next');
  }, [totalCount, goToIndex]);

  const handlePrev = useCallback(() => {
    if (totalCount <= 1) return;
    const prevIdx = currentIndexRef.current > 0 ? currentIndexRef.current - 1 : totalCount - 1;
    goToIndex(prevIdx, 'prev');
  }, [totalCount, goToIndex]);

  // Cycle zoom: 1x -> 2x -> 3x -> 1x
  const toggleZoom = useCallback(() => {
    setZoomScale((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 3;
      return 1;
    });
  }, []);

  // Stable Image loading callbacks to prevent React Native Web abort-and-reload loop
  const handleImageLoadStart = useCallback((id) => {
    if (!loadedMapRef.current[id]) {
      setImageLoadingMap((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    }
  }, []);

  const handleImageLoad = useCallback((id) => {
    loadedMapRef.current[id] = true;
    setImageLoadingMap((prev) => ({ ...prev, [id]: false }));
    setImageErrorMap((prev) => ({ ...prev, [id]: false }));
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  const handleImageLoadEnd = useCallback((id) => {
    setImageLoadingMap((prev) => ({ ...prev, [id]: false }));
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  const handleImageError = useCallback((id) => {
    setImageLoadingMap((prev) => ({ ...prev, [id]: false }));
    setImageErrorMap((prev) => ({ ...prev, [id]: true }));
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  // PanResponder to enable smooth swipe gestures across Web, iOS, and Android
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (zoomScale > 1 || totalCount <= 1) return false;
          const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4;
          return isHorizontal && Math.abs(gestureState.dx) > 10;
        },
        onPanResponderMove: (_, gestureState) => {
          if (zoomScale > 1 || totalCount <= 1) return;
          panX.setValue(gestureState.dx);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (zoomScale > 1 || totalCount <= 1) return;
          const { dx, vx } = gestureState;
          const swipeThreshold = Math.min(65, screenWidth * 0.16);

          if (dx < -swipeThreshold || vx < -0.3) {
            // Dragged left -> advance to Next
            Animated.timing(panX, {
              toValue: -screenWidth * 0.7,
              duration: 130,
              useNativeDriver: Platform.OS !== 'web',
            }).start(() => {
              handleNext();
              panX.setValue(0);
            });
          } else if (dx > swipeThreshold || vx > 0.3) {
            // Dragged right -> go to Prev
            Animated.timing(panX, {
              toValue: screenWidth * 0.7,
              duration: 130,
              useNativeDriver: Platform.OS !== 'web',
            }).start(() => {
              handlePrev();
              panX.setValue(0);
            });
          } else {
            // Snap back to center
            Animated.spring(panX, {
              toValue: 0,
              bounciness: 0,
              useNativeDriver: Platform.OS !== 'web',
            }).start();
          }
        },
      }),
    [zoomScale, totalCount, screenWidth, handleNext, handlePrev, panX]
  );

  // Synchronize when modal opens or initialIndex changes
  useEffect(() => {
    if (visible && totalCount > 0) {
      const safeIdx = Math.min(Math.max(0, initialIndex || 0), totalCount - 1);
      setCurrentIndex(safeIdx);
      currentIndexRef.current = safeIdx;
      setZoomScale(1);
      panX.setValue(0);
      slideOpacity.setValue(1);
      centerThumbnail(safeIdx);
    }
  }, [visible, initialIndex, totalCount, centerThumbnail, panX, slideOpacity]);

  // Safety fallback: dismiss loading indicator after 2s so spinner NEVER spins forever
  const currentMedia = normalizedMedia[currentIndex] || normalizedMedia[0];
  useEffect(() => {
    if (!visible || !currentMedia || currentMedia.type === 'video') return;
    const mediaId = currentMedia.id || `media-${currentIndex}`;

    // If already recorded as loaded, immediately mark loading as false
    if (loadedMapRef.current[mediaId]) {
      setImageLoadingMap((prev) => (prev[mediaId] === false ? prev : { ...prev, [mediaId]: false }));
      return;
    }

    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    loadingTimerRef.current = setTimeout(() => {
      setImageLoadingMap((prev) => ({ ...prev, [mediaId]: false }));
    }, 2000);

    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [visible, currentIndex, currentMedia]);

  // Web Keyboard & Mouse Wheel navigation
  useEffect(() => {
    if (Platform.OS === 'web' && visible && typeof window !== 'undefined') {
      const handleKeyDown = (e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrev();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNext();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose?.();
        }
      };

      const handleWheel = (e) => {
        const now = Date.now();
        if (now - lastWheelTime.current < 280) return;
        const delta = Math.abs(e.deltaX) > 10 ? e.deltaX : (Math.abs(e.deltaY) > 10 ? e.deltaY : 0);
        if (delta > 20) {
          lastWheelTime.current = now;
          handleNext();
        } else if (delta < -20) {
          lastWheelTime.current = now;
          handlePrev();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('wheel', handleWheel, { passive: true });

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('wheel', handleWheel);
      };
    }
  }, [visible, handlePrev, handleNext, onClose]);

  const isVideo = currentMedia?.type === 'video';
  const mediaId = currentMedia?.id || `media-${currentIndex}`;
  const isLoaded = !!loadedMapRef.current[mediaId];
  const isLoading = !isVideo && !isLoaded && (imageLoadingMap[mediaId] ?? true);
  const hasError = !!imageErrorMap[mediaId];
  const activeTitle = currentMedia?.title || title || 'Full Screen View';
  const activeSubtitle = currentMedia?.subtitle || null;
  const currentProductId = currentMedia?.productId;

  const isCurrentFav = useMemo(() => {
    if (currentProductId && Array.isArray(favoriteProductIds)) {
      return favoriteProductIds.some((id) => String(id) === String(currentProductId));
    }
    if (typeof isFavorite === 'function') {
      return isFavorite(currentMedia, currentIndex);
    }
    if (typeof isFavorite === 'boolean') {
      return isFavorite;
    }
    return false;
  }, [isFavorite, currentMedia, currentIndex, currentProductId, favoriteProductIds]);

  const handleFavoritePress = useCallback(() => {
    if (onToggleFavorite && currentMedia) {
      onToggleFavorite(currentMedia.productId || currentMedia, currentIndex);
    }
  }, [onToggleFavorite, currentMedia, currentIndex]);

  // Adjacent items for instant background preloading
  const nextMedia = totalCount > 1 ? normalizedMedia[(currentIndex + 1) % totalCount] : null;
  const prevMedia = totalCount > 1 ? normalizedMedia[(currentIndex - 1 + totalCount) % totalCount] : null;

  const handleRetry = useCallback(() => {
    if (!currentMedia) return;
    delete loadedMapRef.current[mediaId];
    setImageErrorMap((prev) => ({ ...prev, [mediaId]: false }));
    setImageLoadingMap((prev) => ({ ...prev, [mediaId]: true }));
  }, [currentMedia, mediaId]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <View style={styles.headerInfo}>
              {totalCount > 1 && (
                <View style={styles.counterBadge}>
                  <Text style={styles.counterText}>
                    {currentIndex + 1} / {totalCount}
                  </Text>
                </View>
              )}
              <View style={styles.headerTitleWrap}>
                {activeTitle ? (
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    {activeTitle}
                  </Text>
                ) : null}
                {activeSubtitle ? (
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    {activeSubtitle}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.headerActions}>
              {/* Share & Contact Seller Button beside Favorite */}
              {onShare ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.shareHighlightButton]}
                  onPress={() => {
                    const target = currentProductId || currentMedia?.productId || currentMedia;
                    onShare(target, currentIndex);
                  }}
                  activeOpacity={0.75}
                  accessibilityLabel="Share product & contact seller"
                >
                  <Icon name="share-alt" size={15} color="#38BDF8" />
                </TouchableOpacity>
              ) : null}

              {/* Favorite Button (when onToggleFavorite is provided) */}
              {onToggleFavorite ? (
                <TouchableOpacity
                  style={[styles.favButton, isCurrentFav && styles.favButtonActive]}
                  onPress={handleFavoritePress}
                  activeOpacity={0.75}
                  accessibilityLabel={isCurrentFav ? "Remove from favorites" : "Add to favorites"}
                >
                  <Icon
                    name={isCurrentFav ? "heart" : "heart-o"}
                    size={17}
                    color={isCurrentFav ? "#EF4444" : "#FFFFFF"}
                  />
                </TouchableOpacity>
              ) : null}

              {/* Zoom Button (for images) */}
              {!isVideo && (
                <TouchableOpacity
                  style={[styles.actionButton, zoomScale > 1 && styles.actionButtonActive]}
                  onPress={toggleZoom}
                  activeOpacity={0.8}
                  accessibilityLabel="Toggle zoom level"
                >
                  <Icon
                    name={zoomScale > 1 ? 'search-minus' : 'search-plus'}
                    size={15}
                    color="#FFFFFF"
                  />
                  <Text style={styles.zoomButtonText}>{zoomScale}x</Text>
                </TouchableOpacity>
              )}

              {/* Close Button */}
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                activeOpacity={0.8}
                accessibilityLabel="Close full screen view"
              >
                <Icon name="times" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Carousel Slide Area */}
          {totalCount === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name="image" size={54} color="#475569" />
              <Text style={styles.emptyText}>No image available to display</Text>
            </View>
          ) : (
            <View style={styles.carouselWrapper} {...panResponder.panHandlers}>
              {/* Active Animated Slide */}
              <Animated.View
                style={[
                  styles.activeSlide,
                  {
                    transform: [{ translateX: panX }],
                    opacity: slideOpacity,
                  },
                ]}
              >
                {isVideo ? (
                  <View style={styles.mediaFrame}>
                    <Video
                      source={{ uri: currentMedia.uri }}
                      style={styles.fullMedia}
                      useNativeControls
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay={true}
                      isLooping
                    />
                  </View>
                ) : (
                  <View style={styles.mediaFrame}>
                    {isLoading && !hasError && (
                      <View style={styles.mediaLoader}>
                        <ActivityIndicator size="large" color="#38BDF8" />
                      </View>
                    )}

                    {hasError ? (
                      <View style={styles.errorFrame}>
                        <Icon name="exclamation-triangle" size={44} color="#F59E0B" />
                        <Text style={styles.errorTitle}>Unable to load image</Text>
                        <Text style={styles.errorSubtitle}>Check connection or try again</Text>
                        <TouchableOpacity
                          style={styles.retryButton}
                          onPress={handleRetry}
                          activeOpacity={0.8}
                        >
                          <Icon name="refresh" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                          <Text style={styles.retryButtonText}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Image
                        key={mediaId}
                        source={{ uri: currentMedia.uri }}
                        style={[
                          styles.fullMedia,
                          zoomScale > 1 ? { transform: [{ scale: zoomScale }] } : null,
                        ]}
                        resizeMode="contain"
                        onLoadStart={() => handleImageLoadStart(mediaId)}
                        onLoad={() => handleImageLoad(mediaId)}
                        onLoadEnd={() => handleImageLoadEnd(mediaId)}
                        onError={() => handleImageError(mediaId)}
                      />
                    )}
                  </View>
                )}
              </Animated.View>

              {/* Prominent Left Arrow Button (<) */}
              {totalCount > 1 && (
                <TouchableOpacity
                  style={[styles.navArrow, styles.navArrowLeft]}
                  onPress={handlePrev}
                  activeOpacity={0.85}
                  hitSlop={{ top: 25, bottom: 25, left: 25, right: 25 }}
                  accessibilityLabel="Previous image"
                >
                  <Icon name="chevron-left" size={24} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {/* Prominent Right Arrow Button (>) */}
              {totalCount > 1 && (
                <TouchableOpacity
                  style={[styles.navArrow, styles.navArrowRight]}
                  onPress={handleNext}
                  activeOpacity={0.85}
                  hitSlop={{ top: 25, bottom: 25, left: 25, right: 25 }}
                  accessibilityLabel="Next image"
                >
                  <Icon name="chevron-right" size={24} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Bottom Thumbnails Strip */}
          {totalCount > 1 && (
            <View style={styles.bottomBar}>
              <ScrollView
                ref={thumbnailScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbnailScrollContent}
              >
                {normalizedMedia.map((m, idx) => {
                  const isActive = idx === currentIndex;
                  const isThumbVid = m.type === 'video';

                  return (
                    <TouchableOpacity
                      key={`thumb-${m.id || idx}`}
                      style={[styles.thumbnailWrap, isActive && styles.thumbnailWrapActive]}
                      onPress={() => goToIndex(idx, idx > currentIndex ? 'next' : 'prev')}
                      activeOpacity={0.8}
                      accessibilityLabel={`View media ${idx + 1}`}
                    >
                      {isThumbVid ? (
                        <View style={styles.thumbnailVideoPlaceholder}>
                          <Icon name="play" size={12} color="#FFFFFF" />
                        </View>
                      ) : (
                        <Image
                          source={{ uri: m.uri }}
                          style={styles.thumbnailImage}
                          resizeMode="cover"
                        />
                      )}
                      {isActive && <View style={styles.thumbnailActiveIndicator} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Invisible Background Preloaders for Adjacent Images */}
          {nextMedia && nextMedia.type === 'image' && nextMedia.uri !== currentMedia?.uri && (
            <Image
              source={{ uri: nextMedia.uri }}
              style={styles.hiddenPreload}
              onLoad={() => {
                loadedMapRef.current[nextMedia.id] = true;
              }}
            />
          )}
          {prevMedia && prevMedia.type === 'image' && prevMedia.uri !== currentMedia?.uri && prevMedia.uri !== nextMedia?.uri && (
            <Image
              source={{ uri: prevMedia.uri }}
              style={styles.hiddenPreload}
              onLoad={() => {
                loadedMapRef.current[prevMedia.id] = true;
              }}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? {
          height: '100vh',
          width: '100vw',
        }
      : {}),
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    zIndex: 50,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  counterBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    marginRight: 10,
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    gap: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  actionButtonActive: {
    backgroundColor: '#0284C7',
  },
  zoomButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  favButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  shareHighlightButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 0,
    backgroundColor: 'rgba(2, 132, 199, 0.3)',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  favButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1.5,
    borderColor: '#EF4444',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  carouselWrapper: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web'
      ? {
          cursor: 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }
      : {}),
  },
  activeSlide: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaFrame: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    padding: 6,
  },
  fullMedia: {
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    ...(Platform.OS === 'web'
      ? {
          userSelect: 'none',
        }
      : {}),
  },
  mediaLoader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  errorFrame: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  errorTitle: {
    color: '#F87171',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  errorSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  navArrow: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -28 }],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
    ...(Platform.OS === 'web'
      ? {
          cursor: 'pointer',
          userSelect: 'none',
        }
      : {}),
  },
  navArrowLeft: {
    left: 16,
  },
  navArrowRight: {
    right: 16,
  },
  bottomBar: {
    height: 76,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    justifyContent: 'center',
    zIndex: 50,
  },
  thumbnailScrollContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
  },
  thumbnailWrap: {
    width: 54,
    height: 54,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#1E293B',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  thumbnailWrapActive: {
    borderColor: '#38BDF8',
    transform: [{ scale: 1.08 }],
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailVideoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailActiveIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#38BDF8',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '500',
  },
  hiddenPreload: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    left: -9999,
    top: -9999,
  },
});

export default FullScreenImageViewer;
