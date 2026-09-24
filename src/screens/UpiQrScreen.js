import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Linking,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { supabase, getActiveQrCode, updateOrderStatus, extractMerchantUpi } from '../services/supabase';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import { normalizeUpiId, isGenericQrName, resolveUploadedQrDetails, buildUpiPaymentUri } from '../services/qrScanService';

const UpiQrScreen = ({ navigation, route }) => {
  const { cart, totalAmount: passedAmount, shippingAddress, order, sellerId: paramSellerId, sellerName: paramSellerName, customerId: paramCustomerId } = route?.params || {};
  const [activeQrImageUrl, setActiveQrImageUrl] = useState(null);
  const [payeeUpiId, setPayeeUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [qrTab, setQrTab] = useState('dynamic'); // 'dynamic' | 'profile'
  const [isQrViewerVisible, setIsQrViewerVisible] = useState(false);
  const [qrViewerMedia, setQrViewerMedia] = useState([]);
  const [qrViewerIndex, setQrViewerIndex] = useState(0);

  const resolvedSellerId =
    paramSellerId ||
    order?.seller_id ||
    order?.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
    cart?.cart_items?.[0]?.product_variant_combinations?.products?.user_id ||
    null;
  const resolvedSellerName = paramSellerName || order?.seller_name || payeeName || null;
  const resolvedCustomerId = paramCustomerId || order?.customer_id || null;

  const amount =
    passedAmount ||
    order?.total_amount ||
    (cart?.cart_items || []).reduce(
      (sum, item) =>
        sum +
        Number(item?.product_variant_combinations?.price || item?.price || 0) *
          Number(item?.quantity || 1),
      0
    ) ||
    0;

  useEffect(() => {
    const fetchQrCode = async () => {
      try {
        setLoading(true);
        // Look up seller user ID from order or cart
        let sellerId = null;
        if (order?.order_items && order.order_items.length > 0) {
          const prod = order.order_items[0]?.product_variant_combinations?.products;
          sellerId = prod?.user_id || prod?.customer_id || null;
        } else if (cart?.cart_items && cart.cart_items.length > 0) {
          const prod = cart.cart_items[0]?.product_variant_combinations?.products;
          sellerId = prod?.user_id || prod?.customer_id || null;
        }

        const { data: { user } } = await supabase.auth.getUser();
        const targetUserId = resolvedSellerId || sellerId || user?.id;

        if (targetUserId) {
          let foundUpi = '';

          // 1. Primary source of truth: Seller Profile
          let prof = null;
          try {
            const { data, error } = await supabase
              .from('profiles')
              .select('id, full_name, mobile, media_urls, upi_id')
              .eq('id', targetUserId)
              .maybeSingle();

            if (data) {
              prof = data;
            } else if (error && error.message?.includes('upi_id')) {
              const { data: fallbackData } = await supabase
                .from('profiles')
                .select('id, full_name, mobile, media_urls')
                .eq('id', targetUserId)
                .maybeSingle();
              prof = fallbackData;
            }
          } catch (_) {}

          if (prof) {
            const normProf =
              normalizeUpiId(prof.upi_id) ||
              normalizeUpiId(extractMerchantUpi(prof.media_urls));
            if (normProf && !isGenericQrName(normProf)) {
              foundUpi = normProf;
              setPayeeUpiId(foundUpi);
            }
          }

          // 2. Active QR code record (strictly extracts details from uploaded QR code)
          const qrCode = await getActiveQrCode(targetUserId);
          if (qrCode) {
            const url = qrCode.qr_image_url || qrCode.qr_code_url;
            setActiveQrImageUrl(url);
            try {
              const qrDetails = await resolveUploadedQrDetails(qrCode);
              if (qrDetails?.upiId) {
                foundUpi = qrDetails.upiId;
                setPayeeUpiId(foundUpi);
              }
              if (qrDetails?.payeeName) {
                setPayeeName(qrDetails.payeeName);
              }
            } catch (_) {}
          }

          // 3. Current user metadata fallback
          if (!foundUpi && user?.id === targetUserId && user?.user_metadata?.upi_id) {
            const metaUpi = normalizeUpiId(user.user_metadata.upi_id);
            if (metaUpi && !isGenericQrName(metaUpi)) {
              foundUpi = metaUpi;
              setPayeeUpiId(foundUpi);
            }
          }
        }
      } catch (err) {
        console.warn('Error in fetchQrCode:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchQrCode();
  }, [order, cart]);

  const activeVpa = payeeUpiId || 'store@okaxis';
  const orderRef = order?.order_number || (order?.id ? order.id.substring(0, 8) : 'Order');
  const dynamicUpiUri = activeVpa
    ? buildUpiPaymentUri({
        upiId: activeVpa,
        payeeName: payeeName || '',
        amount: Number(amount) > 0 ? Number(amount) : undefined,
        note: 'Bill Order ' + orderRef,
      })
    : '';
  const dynamicQrImageUrl = dynamicUpiUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(dynamicUpiUri)}`
    : null;

  const displayedQrUrl =
    qrTab === 'profile' && activeQrImageUrl ? activeQrImageUrl : dynamicQrImageUrl;

  const openQrImageViewer = () => {
    const list = [];
    if (dynamicQrImageUrl) {
      list.push({
        id: 'upi-dynamic-qr',
        uri: dynamicQrImageUrl,
        type: 'image',
        title: `Dynamic UPI QR Code (₹${Number(amount).toFixed(2)})`,
        subtitle: `Pay to ${resolvedSellerName || payeeName}`,
      });
    }
    if (activeQrImageUrl) {
      list.push({
        id: 'upi-profile-qr',
        uri: activeQrImageUrl,
        type: 'image',
        title: `Profile QR Code - ${resolvedSellerName || payeeName}`,
        subtitle: `UPI ID: ${activeVpa}`,
      });
    }
    const orderItems = order?.order_items || cart?.cart_items || [];
    orderItems.forEach((oi) => {
      const prod = oi?.product_variant_combinations?.products;
      const pMedia = (prod?.product_media || []).filter((m) => m && (m.media_url || m.uri));
      const prodName = prod?.product_name || 'Item';
      const prodPrice = oi.price || oi?.product_variant_combinations?.price || prod?.amount;
      if (pMedia.length > 0) {
        pMedia.forEach((m, mIdx) => {
          list.push({
            id: `upi-oi-${oi.id}-m-${mIdx}`,
            uri: m.media_url || m.uri,
            type: m.media_type || 'image',
            title: prodName,
            subtitle: prodPrice ? `₹${prodPrice}` : null,
          });
        });
      } else if (prod?.image_url || oi?.image_url) {
        list.push({
          id: `upi-oi-${oi.id}-img`,
          uri: prod?.image_url || oi?.image_url,
          type: 'image',
          title: prodName,
          subtitle: prodPrice ? `₹${prodPrice}` : null,
        });
      }
    });

    if (list.length > 0) {
      const targetIdx = qrTab === 'profile' && activeQrImageUrl ? Math.max(0, list.findIndex((i) => i.id === 'upi-profile-qr')) : 0;
      setQrViewerMedia(list);
      setQrViewerIndex(targetIdx);
      setIsQrViewerVisible(true);
    }
  };

  const handleCopyUpiId = async () => {
    try {
      if (Clipboard && Clipboard.setStringAsync) {
        await Clipboard.setStringAsync(activeVpa);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(activeVpa);
      }
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    } catch (_) {}
  };

  const handleDirectUpiPay = () => {
    Linking.openURL(dynamicUpiUri).catch(() => {
      Alert.alert(
        'UPI App Not Found',
        `Please scan the QR code on screen using Google Pay, PhonePe, Paytm, or any UPI app to pay ₹${Number(amount).toFixed(2)}.`
      );
    });
  };

  const handleSimulatePaymentSuccess = async () => {
    if (!order?.id) {
      Alert.alert('Payment Received', `Payment of ₹${Number(amount).toFixed(2)} simulated successfully.`);
      navigation.goBack();
      return;
    }
    setLoading(true);
    const updatedOrder = await updateOrderStatus(order.id, 'paid');
    if (updatedOrder) {
      Alert.alert('Payment Successful', 'Your payment has been verified and processed.');
      navigation.navigate('OrderConfirmation', { order: updatedOrder });
    } else {
      Alert.alert('Notice', 'Order recorded. Proceeding to confirmation.');
      navigation.navigate('OrderConfirmation', { order });
    }
    setLoading(false);
  };

  const handleSimulatePaymentFailure = async () => {
    if (!order?.id) {
      navigation.goBack();
      return;
    }
    setLoading(true);
    await updateOrderStatus(order.id, 'failed');
    Alert.alert('Payment Failed', 'Your payment could not be processed. You may retry or pay via Cash on Delivery.');
    setLoading(false);
  };

  return (
    <View
      style={[
        styles.mainContainer,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHeaderBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan & Pay with UPI</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
          <Icon name="close" size={20} color="#64748B" />
        </TouchableOpacity>
      </View>

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
        {/* Bill Amount Pill */}
        <View style={styles.amountPill}>
          <View>
            <Text style={styles.amountPillLabel}>Bill Amount to Pay:</Text>
            <Text style={styles.amountPillSub}>
              {Platform.OS === 'web' ? 'Scan QR or copy UPI ID below' : 'Auto-filled in QR code'}
            </Text>
          </View>
          <Text style={styles.amountPillValue}>₹{Number(amount).toFixed(2)}</Text>
        </View>

        {/* Tab Switcher if Profile QR is uploaded */}
        {activeQrImageUrl && (
          <View style={styles.qrTabContainer}>
            <TouchableOpacity
              style={[styles.qrTabButton, qrTab === 'dynamic' && styles.qrTabButtonActive]}
              onPress={() => setQrTab('dynamic')}
              activeOpacity={0.8}
            >
              <Icon
                name="bolt"
                size={12}
                color={qrTab === 'dynamic' ? '#007AFF' : '#64748B'}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.qrTabText, qrTab === 'dynamic' && styles.qrTabTextActive]}>
                QR with Bill Amount
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.qrTabButton, qrTab === 'profile' && styles.qrTabButtonActive]}
              onPress={() => setQrTab('profile')}
              activeOpacity={0.8}
            >
              <Icon
                name="image"
                size={12}
                color={qrTab === 'profile' ? '#007AFF' : '#64748B'}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.qrTabText, qrTab === 'profile' && styles.qrTabTextActive]}>
                Profile QR Code
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* QR Code Container Box */}
        <View style={styles.qrBox}>
          {loading ? (
            <View style={styles.qrLoadingBox}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.qrLoadingText}>Generating QR Code...</Text>
            </View>
          ) : (
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={openQrImageViewer}
                accessibilityLabel="Tap to view full screen QR code"
              >
                <Image
                  source={{
                    uri: displayedQrUrl,
                  }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
                <View style={styles.qrAmountOverlay}>
                  <Text style={styles.qrAmountOverlayText}>
                    Order Bill: ₹{Number(amount).toFixed(2)}
                  </Text>
                </View>
              </TouchableOpacity>
          )}
        </View>

        <Text style={styles.instructions}>
          {qrTab === 'profile'
            ? `Scan with Google Pay / PhonePe / Paytm and enter ₹${Number(amount).toFixed(2)}.`
            : `✨ Amount ₹${Number(amount).toFixed(2)} is automatically pre-filled when scanned with any UPI app!`}
        </Text>

        {/* Direct 1-Tap Pay via UPI App - Mobile only */}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={styles.directUpiPayButton}
            onPress={handleDirectUpiPay}
            activeOpacity={0.85}
          >
            <Icon name="mobile-phone" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.directUpiPayButtonText}>
              Pay ₹{Number(amount).toFixed(2)} in UPI App
            </Text>
          </TouchableOpacity>
        )}

        {/* UPI ID Row with 1-Tap Copy */}
        <View style={styles.upiIdRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.upiIdLabel}>Merchant / Store UPI ID:</Text>
            <Text style={styles.upiIdText} numberOfLines={1}>
              {activeVpa}
            </Text>
            <Text style={styles.payeeNameText}>Payee: {payeeName}</Text>
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
      </ScrollView>

      {/* Docked Action Footer Bar */}
      <View style={styles.dockedFooterBar}>
        <TouchableOpacity
          style={styles.footerCancelBtn}
          onPress={handleSimulatePaymentFailure}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.footerCancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.footerConfirmBtn}
          onPress={handleSimulatePaymentSuccess}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Icon name="check-circle" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.footerConfirmBtnText}>Payment Completed</Text>
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
        customerId={resolvedCustomerId}
        forceShow={true}
      />

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
    alignItems: 'center',
  },
  amountPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  amountPillLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  amountPillSub: {
    fontSize: 11,
    color: '#0284C7',
    marginTop: 2,
  },
  amountPillValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0284C7',
  },
  qrTabContainer: {
    width: '100%',
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
    backgroundColor: '#FFFFFF',
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
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    marginBottom: 14,
  },
  qrImage: {
    width: 230,
    height: 230,
    borderRadius: 8,
  },
  qrLoadingBox: {
    height: 230,
    width: 230,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrLoadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
  },
  qrAmountOverlay: {
    marginTop: 12,
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
  instructions: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  directUpiPayButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: 16,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  directUpiPayButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  upiIdRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
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
  payeeNameText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
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
  footerCancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  footerCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  footerConfirmBtn: {
    flex: 1,
    marginLeft: 12,
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
  footerConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default UpiQrScreen;
