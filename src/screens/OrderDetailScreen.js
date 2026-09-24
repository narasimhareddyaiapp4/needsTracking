import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { supabase, getOrderById, updateOrderStatus, updateOrderPaymentStatus, getActiveQrCode } from '../services/supabase';
import { printReceipt, extractOrderNumbers, announceOrderPrint } from '../services/printerService';
import UniversalWebView from '../components/UniversalWebView';
import { useCart } from '../context/CartContext';
import PrinterSettingsModal from '../components/PrinterSettingsModal';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import { downloadQrCodeImage } from '../utils/qrDownloadUtils';
import { showAlert } from '../utils/alertUtils';
import {
  generateQrDataUrl,
  buildUpiPaymentUri,
  buildAndroidIntentUri,
  normalizeUpiId,
  isGenericQrName,
  decodeQrFromImage,
  parseUpiString,
  resolveUploadedQrDetails,
} from '../services/qrScanService';

const OrderDetailScreen = ({ navigation, route }) => {
  const { orderId, sellerId: paramSellerId, sellerName: paramSellerName, customerId: paramCustomerId } = route?.params || {};
  const { role } = useCart();
  const [order, setOrder] = useState(null);

  const resolvedSellerId =
    paramSellerId ||
    order?.seller_id ||
    order?.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
    order?.order_items?.[0]?.product_variant_combinations?.products?.customer_id ||
    null;
  const resolvedSellerName = paramSellerName || order?.seller_name || null;
  const resolvedCustomerId = paramCustomerId || order?.customer_id || null;
  const [deliveryPartner, setDeliveryPartner] = useState(null);
  const [partnerCoords, setPartnerCoords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerTitle, setViewerTitle] = useState('');
  const webViewRef = useRef(null);

  const [sellerUpiId, setSellerUpiId] = useState('');
  const [dynamicQrUri, setDynamicQrUri] = useState('');
  const [dynamicQrDataUrl, setDynamicQrDataUrl] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  useEffect(() => {
    if (!order) return;
    let isMounted = true;

    const loadOrderPaymentQr = async () => {
      setLoadingQr(true);
      const totalAmount = Number(order.total_amount || 0);
      const { orderNumber } = extractOrderNumbers(order);
      let resolvedUpi = '';
      let name = resolvedSellerName || order.seller_name || '';

      // 1. Direct from order
      if (order.seller_upi_id && !isGenericQrName(order.seller_upi_id)) {
        resolvedUpi = normalizeUpiId(order.seller_upi_id);
      } else if (order.upi_id && !isGenericQrName(order.upi_id)) {
        resolvedUpi = normalizeUpiId(order.upi_id);
      }

      // 2. Shipping billing
      if (!resolvedUpi) {
        const shipping = typeof order.shipping_address === 'object' ? order.shipping_address : null;
        if (shipping?.billing?.upi_id && !isGenericQrName(shipping.billing.upi_id)) {
          resolvedUpi = normalizeUpiId(shipping.billing.upi_id);
        }
      }

      // 3. Profiles
      if (!resolvedUpi && resolvedSellerId) {
        try {
          const { data: prof } = await supabase
            .from('profiles')
            .select('upi_id, full_name')
            .eq('id', resolvedSellerId)
            .maybeSingle();
          if (prof?.upi_id && !isGenericQrName(prof.upi_id)) {
            resolvedUpi = normalizeUpiId(prof.upi_id);
          }
          if (!name && prof?.full_name) {
            name = prof.full_name;
          }
        } catch (_) {}
      }

      // 4. user_qr_codes
      if (resolvedSellerId) {
        try {
          const qrData = await getActiveQrCode(resolvedSellerId);
          if (qrData) {
            if (!resolvedUpi && qrData.name && !isGenericQrName(qrData.name)) {
              const norm = normalizeUpiId(qrData.name);
              if (norm && !isGenericQrName(norm)) {
                resolvedUpi = norm;
              }
            }
            if (!resolvedUpi && (qrData.qr_image_url || qrData.qr_code_url)) {
              try {
                const decoded = await decodeQrFromImage(qrData.qr_image_url || qrData.qr_code_url);
                if (decoded) {
                  const parsed = parseUpiString(decoded);
                  if (parsed?.upiId && !isGenericQrName(parsed.upiId)) {
                    resolvedUpi = normalizeUpiId(parsed.upiId);
                  }
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      if (!isMounted) return;

      setSellerUpiId(resolvedUpi);

      const uri = buildUpiPaymentUri({
        upiId: resolvedUpi || 'merchant@upi',
        payeeName: name || 'Store',
        amount: totalAmount > 0 ? totalAmount : undefined,
        note: `Order ${orderNumber}`,
      });

      setDynamicQrUri(uri);

      try {
        const dataUrl = await generateQrDataUrl(uri, { width: 350, margin: 2 });
        if (isMounted) setDynamicQrDataUrl(dataUrl);
      } catch (_) {}

      if (isMounted) setLoadingQr(false);
    };

    loadOrderPaymentQr();

    return () => {
      isMounted = false;
    };
  }, [order, resolvedSellerId, resolvedSellerName]);

  const qrImageSource = dynamicQrDataUrl || (dynamicQrUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(dynamicQrUri)}`
    : null);

  const handleDownloadQr = async () => {
    if (!qrImageSource) {
      showAlert('Error', 'Payment QR code is not ready yet.');
      return;
    }
    setIsDownloadingQr(true);
    try {
      const { orderNumber } = extractOrderNumbers(order);
      const fileName = `Order-${orderNumber}-Payment-QR-Rs${Math.round(Number(order.total_amount || 0))}`;
      await downloadQrCodeImage(qrImageSource, fileName);
    } catch (err) {
      showAlert('Download Error', 'Could not save QR code: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDownloadingQr(false);
    }
  };

  const handleCopyUpi = async () => {
    if (!sellerUpiId) return;
    try {
      await Clipboard.setStringAsync(sellerUpiId);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
      showAlert('Copied', `UPI ID ${sellerUpiId} copied to clipboard.`);
    } catch (_) {}
  };

  const handleOpenUpiApp = async (appId = 'any') => {
    if (!dynamicQrUri) return;
    try {
      if (Platform.OS === 'android') {
        const intentUri = buildAndroidIntentUri(dynamicQrUri, appId);
        const can = await Linking.canOpenURL(intentUri);
        if (can) {
          await Linking.openURL(intentUri);
          return;
        }
      }
      const can = await Linking.canOpenURL(dynamicQrUri);
      if (can) {
        await Linking.openURL(dynamicQrUri);
      } else {
        showAlert(
          'Open UPI App',
          `Could not open UPI app directly. Please scan the QR code on screen or pay to:\n\n${sellerUpiId || 'Store'}\nExact Amount: ₹${Number(order.total_amount || 0).toFixed(2)}`
        );
      }
    } catch (err) {
      showAlert('Notice', 'Please scan the QR code on screen using your phone camera or UPI app.');
    }
  };

  const handleViewQrFullScreen = () => {
    if (!qrImageSource) return;
    const { orderNumber } = extractOrderNumbers(order);
    setViewerImages([
      {
        id: 'order-detail-qr',
        uri: qrImageSource,
        title: `Order #${orderNumber} Dynamic Payment QR`,
        subtitle: `Exact Amount: ₹${Number(order.total_amount || 0).toFixed(2)} • ${sellerUpiId || 'UPI Pay'}`,
      },
    ]);
    setViewerIndex(0);
    setViewerTitle(`Order #${orderNumber} Payment QR`);
    setIsViewerVisible(true);
  };

  const openItemImageViewer = (tappedItem) => {
    const items = order?.order_items || [];
    const mediaList = [];
    let initialIdx = 0;

    items.forEach((oi) => {
      const prod = oi?.product_variant_combinations?.products;
      const pMedia = (prod?.product_media || []).filter((m) => m && (m.media_url || m.uri));
      const isTarget = String(oi.id) === String(tappedItem?.id);
      const prodName = prod?.product_name || 'Order Item';
      const itemPrice = oi.price || prod?.amount;

      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          if (isTarget && mIdx === 0) {
            initialIdx = mediaList.length;
          }
          mediaList.push({
            id: `order-item-${oi.id}-m-${mIdx}`,
            uri: m.media_url || m.uri,
            type: m.media_type || 'image',
            title: pMedia.length > 1 ? `${prodName} (${mIdx + 1}/${pMedia.length})` : prodName,
            subtitle: itemPrice ? `₹${itemPrice}` : null,
          });
        });
      } else {
        const url = prod?.image_url;
        if (url) {
          if (isTarget) {
            initialIdx = mediaList.length;
          }
          mediaList.push({
            id: `order-item-${oi.id}-img`,
            uri: url,
            type: 'image',
            title: prodName,
            subtitle: itemPrice ? `₹${itemPrice}` : null,
          });
        }
      }
    });

    if (mediaList.length > 0) {
      setViewerImages(mediaList);
      setViewerIndex(initialIdx);
      setViewerTitle(order?.order_number ? `Order #${order.order_number}` : 'Order Item Images');
      setIsViewerVisible(true);
    }
  };

  const fetchOrderDetails = async () => {
    try {
      const fetchedOrder = await getOrderById(orderId);
      if (fetchedOrder) {
        setOrder(fetchedOrder);
        setSelectedStatus(fetchedOrder.status);

        // If delivery manager assigned, fetch their profile & live location
        if (fetchedOrder.delivery_manager_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, full_name, mobile')
            .eq('id', fetchedOrder.delivery_manager_id)
            .maybeSingle();

          if (profile) setDeliveryPartner(profile);

          const { data: loc } = await supabase
            .from('delivery_partner_locations')
            .select('latitude, longitude, heading, speed, updated_at')
            .eq('partner_id', fetchedOrder.delivery_manager_id)
            .maybeSingle();

          if (loc && loc.latitude && loc.longitude) {
            setPartnerCoords({ lat: loc.latitude, lon: loc.longitude });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching order details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderDetails();

    if (!orderId) return;

    // Realtime channel for order updates & live delivery location
    const channel = supabase
      .channel(`order-live-tracking:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          if (payload.new) {
            setOrder((prev) => ({ ...prev, ...payload.new }));
            setSelectedStatus(payload.new.status);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'delivery_partner_locations',
        },
        (payload) => {
          if (payload.new && payload.new.latitude && payload.new.longitude) {
            const { latitude, longitude } = payload.new;
            setPartnerCoords({ lat: latitude, lon: longitude });

            // Send live update to map
            if (webViewRef.current) {
              const script = `if (window.updateMarkerLocation) { window.updateMarkerLocation(${latitude}, ${longitude}); } true;`;
              if (Platform.OS === 'web') {
                try {
                  webViewRef.current.contentWindow?.eval(script);
                } catch (e) {}
              } else {
                webViewRef.current.injectJavaScript?.(script);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  const handleUpdateStatus = async () => {
    if (selectedStatus !== order.status) {
      setLoading(true);
      const success = await updateOrderStatus(orderId, selectedStatus);
      if (success) {
        setOrder({ ...order, status: selectedStatus });
        Alert.alert('Success', 'Order status updated successfully.');
      } else {
        Alert.alert('Error', 'Failed to update order status.');
      }
      setLoading(false);
    }
  };

  const handleTogglePayment = async () => {
    const isPaid = (order?.payment_status === 'paid' || order?.status === 'completed' || order?.status === 'paid');
    const nextStatus = isPaid ? 'pending' : 'paid';
    const payRef = extractOrderNumbers(order).paymentReference || order?.payment_reference || order?.shipping_address?.payment_reference || 'N/A';

    Alert.alert(
      'Update Payment Status',
      `Payment Reference: ${payRef}\n\nDo you want to mark payment as "${nextStatus === 'paid' ? 'DONE (PAID)' : 'PENDING'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'paid' ? 'Mark Paid' : 'Mark Pending',
          onPress: async () => {
            const updated = await updateOrderPaymentStatus(orderId, nextStatus);
            if (updated) {
              setOrder(prev => ({
                ...prev,
                payment_status: nextStatus,
                status: (nextStatus === 'paid' && (prev?.status || '').toLowerCase() === 'pending_payment')
                  ? 'processing'
                  : prev?.status,
              }));
              Alert.alert('Success', `Payment marked as ${nextStatus.toUpperCase()}.`);
            } else {
              Alert.alert('Error', 'Failed to update payment status.');
            }
          },
        },
      ]
    );
  };

  const handleCallPartner = (phone) => {
    if (!phone) {
      Alert.alert('No Phone', 'No phone number available for delivery partner.');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const getShippingLocation = () => {
    if (!order?.shipping_address) return null;
    if (typeof order.shipping_address === 'object') {
      return order.shipping_address;
    }
    try {
      return JSON.parse(order.shipping_address);
    } catch {
      return null;
    }
  };

  const renderOrderItem = ({ item }) => {
    const prod = item?.product_variant_combinations?.products;
    const media = prod?.product_media;
    const mediaUrl = Array.isArray(media) && media.length > 0 ? media[0]?.media_url : null;

    return (
      <View style={styles.orderItemDetail}>
        {mediaUrl ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openItemImageViewer(item)}
            style={{ position: 'relative' }}
            accessibilityLabel={`View full image for ${prod?.product_name || 'Product'}`}
          >
            <Image source={{ uri: mediaUrl }} style={styles.orderItemImage} resizeMode="cover" />
            <View style={styles.itemZoomBadge}>
              <Icon name="search-plus" size={10} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.orderItemPlaceholder}>
            <Icon name="shopping-bag" size={20} color="#94a3b8" />
          </View>
        )}
        <View style={styles.orderItemTextContainer}>
          <Text style={styles.itemProductName}>
            {prod?.product_name || 'Product'}
            {item.product_variant_combinations?.combination_string
              ? ` (${item.product_variant_combinations.combination_string})`
              : ''}
          </Text>
          <Text style={styles.itemQuantity}>Quantity: {item.quantity}</Text>
          <Text style={styles.itemPrice}>Price: ₹{Number(item.price || 0).toFixed(2)}</Text>
        </View>
      </View>
    );
  };

  const getHtmlContent = () => {
    const shipping = getShippingLocation();

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Order Live Tracking</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
          <style>
              body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
              #mapid { width: 100vw; height: 280px; background-color: #f1f5f9; }

              .bike-marker-container {
                  position: relative;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
              }
              .radar-pulse {
                  position: absolute;
                  top: 0;
                  left: 2px;
                  width: 44px;
                  height: 44px;
                  border-radius: 50%;
                  background: rgba(0, 122, 255, 0.25);
                  animation: radarRipple 2s infinite ease-out;
                  z-index: 1;
              }
              @keyframes radarRipple {
                  0% { transform: scale(0.6); opacity: 1; }
                  100% { transform: scale(1.8); opacity: 0; }
              }
              .bike-pin {
                  width: 44px;
                  height: 44px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #007AFF 0%, #00C6FF 100%);
                  border: 2.5px solid #FFFFFF;
                  box-shadow: 0 4px 14px rgba(0, 122, 255, 0.5);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: #FFFFFF;
                  font-size: 19px;
                  z-index: 2;
                  position: relative;
                  transition: transform 0.2s ease;
              }
              .marker-badge {
                  margin-top: 3px;
                  background: rgba(15, 23, 42, 0.85);
                  color: #FFFFFF;
                  font-size: 10px;
                  font-weight: 700;
                  padding: 2px 7px;
                  border-radius: 6px;
                  white-space: nowrap;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                  z-index: 3;
              }

              .dest-marker-container {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
              }
              .dest-pin {
                  width: 38px;
                  height: 38px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #EF4444 0%, #F87171 100%);
                  border: 2.5px solid #FFFFFF;
                  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.45);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: #FFFFFF;
                  font-size: 16px;
              }
              .dest-badge {
                  margin-top: 3px;
                  background: rgba(239, 68, 68, 0.9);
                  color: #FFFFFF;
                  font-size: 10px;
                  font-weight: 700;
                  padding: 2px 6px;
                  border-radius: 6px;
                  white-space: nowrap;
              }
          </style>
      </head>
      <body>
          <div id="mapid"></div>
          <script>
              var map = L.map('mapid', { zoomControl: true, scrollWheelZoom: false }).setView([20.5937, 78.9629], 5);
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '&copy; OpenStreetMap',
                  maxZoom: 19
              }).addTo(map);

              var managerCoords = ${JSON.stringify(partnerCoords)};
              var destCoords = ${JSON.stringify(
                shipping?.latitude && shipping?.longitude
                  ? { lat: shipping.latitude, lon: shipping.longitude }
                  : null
              )};

              var deliveryMarker = null;
              var waypoints = [];

              var deliveryIcon = L.divIcon({
                  className: 'custom-bike-wrapper',
                  html: '<div class="bike-marker-container"><div class="radar-pulse"></div><div class="bike-pin"><i class="fas fa-motorcycle"></i></div><div class="marker-badge">🛵 In Transit</div></div>',
                  iconSize: [60, 68],
                  iconAnchor: [30, 24]
              });

              var destIcon = L.divIcon({
                  className: 'custom-dest-wrapper',
                  html: '<div class="dest-marker-container"><div class="dest-pin"><i class="fas fa-home"></i></div><div class="dest-badge">📍 Delivery</div></div>',
                  iconSize: [50, 58],
                  iconAnchor: [25, 20]
              });

              if (managerCoords && managerCoords.lat && managerCoords.lon) {
                  deliveryMarker = L.marker([managerCoords.lat, managerCoords.lon], { icon: deliveryIcon })
                      .addTo(map)
                      .bindPopup('<b>🛵 Delivery Partner Live Location</b>')
                      .openPopup();
                  waypoints.push([managerCoords.lat, managerCoords.lon]);
              }

              if (destCoords && destCoords.lat && destCoords.lon) {
                  L.marker([destCoords.lat, destCoords.lon], { icon: destIcon })
                      .addTo(map)
                      .bindPopup('<b>📍 Customer Destination</b>');
                  waypoints.push([destCoords.lat, destCoords.lon]);
              }

              if (waypoints.length > 1) {
                  L.polyline(waypoints, { color: '#007AFF', weight: 4, dashArray: '6, 8', opacity: 0.8 }).addTo(map);
                  map.fitBounds(L.latLngBounds(waypoints).pad(0.35));
              } else if (waypoints.length === 1) {
                  map.setView(waypoints[0], 15);
              }

              window.updateMarkerLocation = function(lat, lon) {
                  if (deliveryMarker) {
                      deliveryMarker.setLatLng([lat, lon]);
                  } else {
                      deliveryMarker = L.marker([lat, lon], { icon: deliveryIcon })
                          .addTo(map)
                          .bindPopup('<b>🛵 Delivery Partner Live Location</b>');
                  }
                  map.panTo([lat, lon], { animate: true });
              };
          </script>
      </body>
      </html>
    `;
  };

  if (loading && !order) {
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
            <Icon name="arrow-left" size={17} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={[styles.loadingText, { marginTop: 12 }]}>Loading order details...</Text>
        </View>
        <StoreNavigationFooter
          activeTab="orders"
          navigation={navigation}
          route={route}
          sellerId={resolvedSellerId}
          sellerName={resolvedSellerName}
          customerId={resolvedCustomerId}
          forceShow={true}
        />
      </View>
    );
  }

  if (!order) {
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
            <Icon name="arrow-left" size={17} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Order not found.</Text>
        </View>
        <StoreNavigationFooter
          activeTab="orders"
          navigation={navigation}
          route={route}
          sellerId={resolvedSellerId}
          sellerName={resolvedSellerName}
          customerId={resolvedCustomerId}
          forceShow={true}
        />
      </View>
    );
  }

  const shipping = getShippingLocation();
  const isDeliveryAssigned = Boolean(order.delivery_manager_id);
  const canUpdateStatus = role === 'seller' || role === 'admin' || role === 'delivery_manager';
  const { orderNumber, dayOrderNo } = extractOrderNumbers(order);

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
          accessibilityLabel="Back to Orders"
        >
          <Icon name="arrow-left" size={17} color="#0F172A" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle}>Order #{orderNumber}</Text>
          {dayOrderNo ? (
            <Text style={styles.headerSubTitle}>Day Order No: #{dayOrderNo}</Text>
          ) : null}
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={{ marginRight: 16 }}
            onPress={() => announceOrderPrint(order)}
            accessibilityLabel="Announce Order Aloud"
          >
            <Icon name="volume-up" size={22} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity style={{ marginRight: 16 }} onPress={() => printReceipt(order)} accessibilityLabel="Print Receipt">
            <Icon name="print" size={22} color="#1E293B" />
          </TouchableOpacity>
          <TouchableOpacity style={{ marginRight: 16 }} onPress={() => setShowPrinterSettings(true)} accessibilityLabel="Printer Settings">
            <Icon name="cog" size={22} color="#64748B" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
            <Icon name="times" size={22} color="#1E293B" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={[
          styles.container,
          Platform.OS === 'web' ? { flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : null,
        ]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 150 }]}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
      >
        {/* Live Tracking Map if Delivery Partner is Assigned */}
        {isDeliveryAssigned && (
          <View style={styles.trackingCard}>
            <View style={styles.trackingHeader}>
              <View style={styles.trackingTitleRow}>
                <Icon name="motorcycle" size={18} color="#007AFF" />
                <Text style={styles.trackingTitle}>Live Delivery Tracking</Text>
              </View>
              <View style={styles.livePulseBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.livePulseText}>LIVE</Text>
              </View>
            </View>

            <View style={styles.mapContainer}>
              <UniversalWebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: getHtmlContent() }}
                style={{ height: 280, width: '100%' }}
                javaScriptEnabled={true}
                domStorageEnabled={true}
              />
            </View>

            {/* Delivery Partner Info */}
            <View style={styles.partnerInfoRow}>
              <View style={styles.partnerAvatar}>
                <Icon name="user" size={18} color="#007AFF" />
              </View>
              <View style={styles.partnerDetails}>
                <Text style={styles.partnerName}>
                  {deliveryPartner?.full_name || 'Assigned Delivery Partner'}
                </Text>
                <Text style={styles.partnerSub}>
                  {partnerCoords ? 'Broadcasting live location' : 'Partner assigned'}
                </Text>
              </View>
              {deliveryPartner?.mobile && (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={() => handleCallPartner(deliveryPartner.mobile)}
                >
                  <Icon name="phone" size={14} color="#FFFFFF" />
                  <Text style={styles.callBtnText}>Call</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Order Identification & Status Card */}
        <View style={styles.detailCard}>
          <View style={styles.orderMetaTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNumberLarge}>Order No: {orderNumber}</Text>
              {dayOrderNo ? (
                <Text style={styles.dayOrderHighlight}>Day Order No: #{dayOrderNo}</Text>
              ) : null}
            </View>
            {dayOrderNo ? (
              <View style={styles.dayOrderBadgeBox}>
                <Text style={styles.dayOrderBadgeSmall}>DAY ORDER</Text>
                <Text style={styles.dayOrderBadgeNum}>#{dayOrderNo}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.innerDivider} />

          <Text style={styles.label}>Order Status</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, getStatusStyle(order.status)]}>
              <Text style={styles.statusBadgeText}>{(order.status ? order.status.replace(/_/g, ' ') : 'Pending').toUpperCase()}</Text>
            </View>
            <Text style={styles.statusDateText}>{new Date(order.created_at).toLocaleString()}</Text>
          </View>
        </View>

        {/* Status Update (for Sellers/Admins/Delivery Managers) */}
        {canUpdateStatus && (
          <View style={styles.detailCard}>
            <Text style={styles.label}>Update Order Status</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedStatus}
                onValueChange={(itemValue) => setSelectedStatus(itemValue)}
                style={styles.picker}
              >
                <Picker.Item label="Payment Pending" value="pending_payment" />
                <Picker.Item label="Pending" value="pending" />
                <Picker.Item label="Processing" value="processing" />
                <Picker.Item label="Out for Delivery" value="out_for_delivery" />
                <Picker.Item label="Shipped" value="shipped" />
                <Picker.Item label="Completed" value="completed" />
                <Picker.Item label="Cancelled" value="cancelled" />
              </Picker>
            </View>
            <TouchableOpacity style={styles.saveButton} onPress={handleUpdateStatus}>
              <Text style={styles.saveButtonText}>Save Status</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Total Amount & Payment */}
        {(() => {
          const orderBilling = (typeof shipping === 'object' && shipping?.billing)
            ? shipping.billing
            : (typeof order?.shipping_address === 'object' && order?.shipping_address?.billing)
            ? order.shipping_address.billing
            : null;

          const orderItemsTotal = (order.order_items || []).reduce(
            (sum, it) => sum + (Number(it.price || 0) * Number(it.quantity || 1)),
            0
          );
          const detailSubtotal = order.subtotal !== undefined && order.subtotal !== null && Number(order.subtotal) > 0
            ? Number(order.subtotal)
            : orderBilling?.subtotal !== undefined && Number(orderBilling.subtotal) > 0
            ? Number(orderBilling.subtotal)
            : orderItemsTotal > 0
            ? orderItemsTotal
            : Number(order.total_amount || 0);

          const detailCgst = Number(order.cgst_amount || orderBilling?.cgst_amount || 0);
          const detailSgst = Number(order.sgst_amount || orderBilling?.sgst_amount || 0);
          const detailService = Number(order.service_cost || orderBilling?.service_cost || 0);
          const detailCgstRate = order.cgst_rate !== undefined ? order.cgst_rate : (orderBilling?.cgst_rate !== undefined ? orderBilling.cgst_rate : 2.5);
          const detailSgstRate = order.sgst_rate !== undefined ? order.sgst_rate : (orderBilling?.sgst_rate !== undefined ? orderBilling.sgst_rate : 2.5);
          const detailServiceRate = order.service_cost_rate !== undefined ? order.service_cost_rate : (orderBilling?.service_cost_rate !== undefined ? orderBilling.service_cost_rate : 0);
          const hasTaxBreakdown = detailCgst > 0 || detailSgst > 0 || detailService > 0;

          return (
            <View style={styles.detailCard}>
              {hasTaxBreakdown && (
                <View style={{ marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>Items Subtotal</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>₹{detailSubtotal.toFixed(2)}</Text>
                  </View>
                  {detailCgst > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#64748B' }}>CGST ({detailCgstRate}%)</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{detailCgst.toFixed(2)}</Text>
                    </View>
                  )}
                  {detailSgst > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#64748B' }}>SGST ({detailSgstRate}%)</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{detailSgst.toFixed(2)}</Text>
                    </View>
                  )}
                  {detailService > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#64748B' }}>Service Charge ({detailServiceRate}%)</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{detailService.toFixed(2)}</Text>
                    </View>
                  )}
                </View>
              )}
              <View style={styles.amountRow}>
                <Text style={styles.label}>Total Amount</Text>
                <Text style={styles.amountValue}>₹{Number(order.total_amount || 0).toFixed(2)}</Text>
              </View>
              {/* Payment Section & 6-Digit Code Verification */}
              <View style={styles.paymentSectionBox}>
                <View style={styles.paymentMetaRow}>
                  <Text style={styles.paymentMethodText}>
                    Mode: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{(order.payment_method || 'Cash on Delivery').toUpperCase()}</Text>
                  </Text>
                  <View style={[
                    styles.paymentStatusPillDetail,
                    (order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid')
                      ? styles.paymentStatusPaidDetail
                      : styles.paymentStatusPendingDetail
                  ]}>
                    <Icon
                      name={(order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid') ? "check-circle" : "clock-o"}
                      size={11}
                      color={(order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid') ? "#16A34A" : "#D97706"}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[
                      styles.paymentStatusTextDetail,
                      (order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid') ? styles.textGreen : styles.textAmber
                    ]}>
                      {(order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid') ? 'Payment Done' : 'Payment Pending'}
                    </Text>
                  </View>
                </View>

                {(() => {
                  const payRef = extractOrderNumbers(order).paymentReference ||
                    order.payment_reference ||
                    shipping?.payment_reference ||
                    shipping?.billing?.payment_reference ||
                    shipping?.payment_note;
                  if (!payRef) return null;
                  return (
                    <View style={styles.payVerificationBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Icon name="tag" size={13} color="#4F46E5" style={{ marginRight: 6 }} />
                          <Text style={styles.payRefLabel}>6-Digit Payment Code:</Text>
                        </View>
                        <Text style={styles.payRefValue}>{payRef}</Text>
                      </View>
                      <Text style={styles.payRefHelpText}>
                        Reconciliation: Check this 6-digit code against your UPI or bank statement credits to confirm payment done properly.
                      </Text>
                    </View>
                  );
                })()}

                {canUpdateStatus && (
                  <TouchableOpacity
                    style={[
                      styles.togglePayBtn,
                      (order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid')
                        ? styles.togglePayBtnPending
                        : styles.togglePayBtnPaid
                    ]}
                    onPress={handleTogglePayment}
                    activeOpacity={0.85}
                  >
                    <Icon
                      name={(order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid') ? "undo" : "check-circle"}
                      size={13}
                      color="#FFFFFF"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.togglePayBtnText}>
                      {(order.payment_status === 'paid' || order.status === 'completed' || order.status === 'paid')
                        ? "Mark Payment as Pending"
                        : "Mark Payment as Done (Received)"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })()}

        {/* Dynamic Payment QR Card to Pay Anytime */}
        <View style={styles.dynamicQrCard}>
          <View style={styles.dynamicQrHeader}>
            <View style={styles.qrHeaderIconCircle}>
              <Icon name="qrcode" size={18} color="#007AFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dynamicQrTitle}>Pay Anytime via Dynamic QR</Text>
              <Text style={styles.dynamicQrSubtitle}>
                Scan with Google Pay, PhonePe, Paytm, or any UPI app
              </Text>
            </View>
            <View style={styles.liveTag}>
              <Text style={styles.liveTagText}>⚡ DYNAMIC</Text>
            </View>
          </View>

          <View style={styles.qrImageBox}>
            {loadingQr ? (
              <View style={styles.qrLoadingBox}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.qrLoadingText}>Loading Payment QR...</Text>
              </View>
            ) : qrImageSource ? (
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={handleViewQrFullScreen}
                style={styles.qrTouchable}
                accessibilityLabel="Tap to view full screen QR"
              >
                <Image source={{ uri: qrImageSource }} style={styles.qrImg} resizeMode="contain" />
                <View style={styles.qrAmountOverlay}>
                  <Text style={styles.qrAmountOverlayText}>
                    Exact Bill: ₹{Number(order.total_amount || 0).toFixed(2)}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: '#64748B', marginVertical: 20 }}>QR Code not available</Text>
            )}
          </View>

          {sellerUpiId ? (
            <View style={styles.upiCopyRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name="credit-card" size={13} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.upiCopyText} numberOfLines={1}>
                  UPI: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{sellerUpiId}</Text>
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.copyUpiBtn, copiedUpi && styles.copyUpiBtnSuccess]}
                onPress={handleCopyUpi}
                activeOpacity={0.7}
              >
                <Icon
                  name={copiedUpi ? "check" : "copy"}
                  size={12}
                  color={copiedUpi ? "#16A34A" : "#007AFF"}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.copyUpiBtnText, copiedUpi && styles.copyUpiBtnTextSuccess]}>
                  {copiedUpi ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Highlighted QR Code Download Button */}
          <TouchableOpacity
            style={styles.downloadQrHighlightBtn}
            onPress={handleDownloadQr}
            disabled={isDownloadingQr || loadingQr}
            activeOpacity={0.84}
            accessibilityLabel="Download Payment QR to Device"
          >
            {isDownloadingQr ? (
              <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
            ) : (
              <View style={styles.downloadIconBadge}>
                <Icon name="download" size={16} color="#FFFFFF" />
              </View>
            )}
            <View style={styles.downloadQrTextContainer}>
              <Text style={styles.downloadQrBtnText}>Download QR Code to Device</Text>
              <Text style={styles.downloadQrBtnSubText}>
                Save QR to gallery so you can pay anytime
              </Text>
            </View>
            <Icon name="chevron-right" size={14} color="#FFFFFF" style={{ opacity: 0.85, marginLeft: 6 }} />
          </TouchableOpacity>

          {/* Direct 1-Tap Pay via UPI Apps on Mobile */}
          {Platform.OS !== 'web' && (
            <View style={styles.quickPayAppsRow}>
              <TouchableOpacity
                style={[styles.quickPayAppBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                onPress={() => handleOpenUpiApp('gpay')}
                activeOpacity={0.8}
              >
                <Icon name="google-wallet" size={13} color="#16A34A" style={{ marginRight: 4 }} />
                <Text style={[styles.quickPayAppText, { color: '#16A34A' }]}>GPay</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickPayAppBtn, { backgroundColor: '#FAF5FF', borderColor: '#E9D5FF' }]}
                onPress={() => handleOpenUpiApp('phonepe')}
                activeOpacity={0.8}
              >
                <Icon name="mobile-phone" size={16} color="#9333EA" style={{ marginRight: 4 }} />
                <Text style={[styles.quickPayAppText, { color: '#9333EA' }]}>PhonePe</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickPayAppBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                onPress={() => handleOpenUpiApp('paytm')}
                activeOpacity={0.8}
              >
                <Icon name="shield" size={13} color="#007AFF" style={{ marginRight: 4 }} />
                <Text style={[styles.quickPayAppText, { color: '#007AFF' }]}>Paytm</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickPayAppBtn, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}
                onPress={() => handleOpenUpiApp('any')}
                activeOpacity={0.8}
              >
                <Icon name="qrcode" size={13} color="#475569" style={{ marginRight: 4 }} />
                <Text style={[styles.quickPayAppText, { color: '#475569' }]}>Any UPI</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.qrHelpNote}>
            💡 Pay with pre-filled bill total directly to the seller anytime before delivery.
          </Text>
        </View>

        {/* Shipping Address */}
        <View style={styles.detailCard}>
          <Text style={styles.label}>Delivery Address</Text>
          <Text style={styles.addressText}>
            {shipping?.address || order.shipping_address || 'No address provided'}
            {shipping?.city ? `, ${shipping.city}` : ''}
          </Text>
        </View>

        {/* Items List */}
        <Text style={styles.sectionTitle}>Order Items</Text>
        {order.order_items && order.order_items.length > 0 ? (
          <View style={styles.itemsList}>
            {order.order_items.map((item, index) => (
              <View key={item.id || index}>
                {renderOrderItem({ item, index })}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noItemsText}>No items in this order.</Text>
        )}
      </ScrollView>

      {/* Screen Footer Bar */}
      <View style={styles.screenFooterBar}>
        <TouchableOpacity
          style={styles.footerBackBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Icon name="arrow-left" size={14} color="#0F172A" style={{ marginRight: 8 }} />
          <Text style={styles.footerBackBtnText}>Back to Orders</Text>
        </TouchableOpacity>

        <View style={styles.footerRightBtns}>
          <TouchableOpacity
            style={styles.footerVoiceBtn}
            onPress={() => announceOrderPrint(order)}
            accessibilityLabel="Announce Order Aloud"
            activeOpacity={0.8}
          >
            <Icon name="volume-up" size={16} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.footerPrintBtn}
            onPress={() => printReceipt(order)}
            accessibilityLabel="Print Receipt"
            activeOpacity={0.8}
          >
            <Icon name="print" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.footerPrintBtnText}>Print</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Navigation Footer (Store, Cart, Orders) */}
      <StoreNavigationFooter
        activeTab="orders"
        navigation={navigation}
        route={route}
        sellerId={resolvedSellerId}
        sellerName={resolvedSellerName}
        customerId={resolvedCustomerId}
        forceShow={true}
      />

      <PrinterSettingsModal
        visible={showPrinterSettings}
        onClose={() => setShowPrinterSettings(false)}
      />

      <FullScreenImageViewer
        visible={isViewerVisible}
        mediaList={viewerImages}
        initialIndex={viewerIndex}
        onClose={() => setIsViewerVisible(false)}
        title={viewerTitle || 'Order Items'}
      />
    </View>
  );
};

function getStatusStyle(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('completed') || s.includes('delivered')) return { backgroundColor: '#ECFDF5' };
  if (s.includes('out')) return { backgroundColor: '#EFF6FF' };
  if (s.includes('cancelled')) return { backgroundColor: '#FEF2F2' };
  if (s.includes('pending_payment') || s.includes('payment')) return { backgroundColor: '#FEF3C7' };
  return { backgroundColor: '#FFFBEB' };
}

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
    marginRight: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 2,
  },
  orderMetaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderNumberLarge: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  dayOrderHighlight: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 3,
  },
  dayOrderBadgeBox: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  dayOrderBadgeSmall: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  dayOrderBadgeNum: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0284C7',
  },
  innerDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 150,
  },
  screenFooterBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
    flexShrink: 0,
  },
  footerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
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
  footerRightBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerVoiceBtn: {
    padding: 9,
    borderRadius: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  footerPrintBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  notFoundText: {
    fontSize: 16,
    color: '#64748B',
  },
  trackingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  trackingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  trackingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  livePulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  livePulseText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  mapContainer: {
    height: 280,
    width: '100%',
  },
  partnerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  partnerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  partnerDetails: {
    flex: 1,
  },
  partnerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  partnerSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  callBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusDateText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  picker: {
    height: 48,
    width: '100%',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  paymentMethodText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  addressText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 10,
    marginBottom: 10,
  },
  itemsList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  orderItemDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  orderItemImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
  },
  itemZoomBadge: {
    position: 'absolute',
    bottom: 2,
    right: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderItemPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  orderItemTextContainer: {
    flex: 1,
  },
  itemProductName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  itemQuantity: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
    marginTop: 2,
  },
  noItemsText: {
    textAlign: 'center',
    color: '#94A3B8',
    marginVertical: 16,
  },
  paymentSectionBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  paymentMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentStatusPillDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  paymentStatusPaidDetail: {
    backgroundColor: '#DCFCE7',
  },
  paymentStatusPendingDetail: {
    backgroundColor: '#FEF3C7',
  },
  paymentStatusTextDetail: {
    fontSize: 12,
    fontWeight: '700',
  },
  textGreen: {
    color: '#16A34A',
  },
  textAmber: {
    color: '#D97706',
  },
  payVerificationBox: {
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    padding: 10,
    marginVertical: 8,
  },
  payRefLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3730A3',
  },
  payRefValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  payRefHelpText: {
    fontSize: 11,
    color: '#4B5563',
    lineHeight: 15,
    marginTop: 2,
  },
  togglePayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 6,
  },
  togglePayBtnPaid: {
    backgroundColor: '#16A34A',
  },
  togglePayBtnPending: {
    backgroundColor: '#D97706',
  },
  togglePayBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  dynamicQrCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 16,
    marginVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  dynamicQrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  qrHeaderIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dynamicQrTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  dynamicQrSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  liveTag: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  qrImageBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  qrLoadingBox: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrLoadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#64748B',
  },
  qrTouchable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImg: {
    width: 210,
    height: 210,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  qrAmountOverlay: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  qrAmountOverlayText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  upiCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  upiCopyText: {
    fontSize: 12,
    color: '#475569',
  },
  copyUpiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginLeft: 8,
  },
  copyUpiBtnSuccess: {
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
  },
  copyUpiBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  copyUpiBtnTextSuccess: {
    color: '#16A34A',
  },
  downloadQrHighlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669', // Emerald highlight
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#047857',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 4,
  },
  downloadIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
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
  quickPayAppsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 10,
  },
  quickPayAppBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickPayAppText: {
    fontSize: 11,
    fontWeight: '700',
  },
  qrHelpNote: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 16,
    fontStyle: 'italic',
  },
});

export default OrderDetailScreen;
