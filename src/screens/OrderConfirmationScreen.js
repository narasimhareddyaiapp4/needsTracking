import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { printReceipt, extractOrderNumbers, announceOrderPrint } from '../services/printerService';
import PrinterSettingsModal from '../components/PrinterSettingsModal';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import { downloadQrCodeImage } from '../utils/qrDownloadUtils';
import { showAlert } from '../utils/alertUtils';
import { supabase, getActiveQrCode } from '../services/supabase';
import {
  generateQrDataUrl,
  buildUpiPaymentUri,
  buildAndroidIntentUri,
  normalizeUpiId,
  isGenericQrName,
  decodeQrFromImage,
  parseUpiString,
} from '../services/qrScanService';

const OrderConfirmationScreen = ({ navigation, route }) => {
  const { order, customerId } = route?.params || {};
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const { orderNumber, dayOrderNo } = extractOrderNumbers(order);

  const resolvedSellerId =
    route?.params?.sellerId ||
    order?.seller_id ||
    order?.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
    null;
  const resolvedSellerName = route?.params?.sellerName || order?.seller_name || null;
  const resolvedCustomerId = route?.params?.customerId || customerId || order?.customer_id || null;

  const totalAmount = Number(order?.total_amount || 0);
  const [sellerUpiId, setSellerUpiId] = useState('');
  const [sellerDisplayName, setSellerDisplayName] = useState(resolvedSellerName || 'Store');
  const [dynamicQrUri, setDynamicQrUri] = useState('');
  const [dynamicQrDataUrl, setDynamicQrDataUrl] = useState(null);
  const [loadingQr, setLoadingQr] = useState(true);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [isQrViewerVisible, setIsQrViewerVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadSellerPaymentInfo = async () => {
      setLoadingQr(true);
      let resolvedUpi = '';
      let name = resolvedSellerName || '';

      // 1. Direct from order
      if (order?.seller_upi_id && !isGenericQrName(order.seller_upi_id)) {
        resolvedUpi = normalizeUpiId(order.seller_upi_id);
      } else if (order?.upi_id && !isGenericQrName(order.upi_id)) {
        resolvedUpi = normalizeUpiId(order.upi_id);
      }

      // 2. Shipping billing info
      if (!resolvedUpi) {
        const confBilling = order?.billing || (typeof order?.shipping_address === 'object' ? order.shipping_address?.billing : null);
        if (confBilling?.upi_id && !isGenericQrName(confBilling.upi_id)) {
          resolvedUpi = normalizeUpiId(confBilling.upi_id);
        }
      }

      // 3. Query profiles for seller
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

      // 4. Query user_qr_codes for seller
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
      if (name) setSellerDisplayName(name);

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

    loadSellerPaymentInfo();

    return () => {
      isMounted = false;
    };
  }, [order, resolvedSellerId, resolvedSellerName, orderNumber, totalAmount]);

  const qrImageSource = dynamicQrDataUrl || (dynamicQrUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=8&data=${encodeURIComponent(dynamicQrUri)}`
    : null);

  const handleDownloadQr = async () => {
    if (!qrImageSource) {
      showAlert('Error', 'Payment QR code is not available yet.');
      return;
    }
    setIsDownloadingQr(true);
    try {
      const fileName = `Order-${orderNumber}-Payment-QR-Rs${Math.round(totalAmount)}`;
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
          `Could not open UPI app directly. Please scan the QR code above or pay to:\n\n${sellerUpiId || 'Store'}\nExact Amount: ₹${totalAmount.toFixed(2)}`
        );
      }
    } catch (err) {
      showAlert('Notice', 'Please scan the QR code on screen using your phone camera or UPI app.');
    }
  };

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
          onPress={() => navigation.popToTop()}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Confirmation</Text>
        <TouchableOpacity onPress={() => navigation.popToTop()} accessibilityLabel="Close">
          <Icon name="close" size={20} color="#64748B" />
        </TouchableOpacity>
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
        <View style={styles.confirmationCard}>
          <View style={styles.iconCircle}>
            <Icon name="check" size={42} color="#10B981" />
          </View>
          <Text style={styles.title}>Thank You for Your Order!</Text>
          <Text style={styles.subtitle}>Your order has been placed and received by the store.</Text>

          <View style={styles.orderIdBadge}>
            <Text style={styles.orderIdLabel}>Order No:</Text>
            <Text style={styles.orderId}>#{orderNumber}</Text>
          </View>

          {dayOrderNo ? (
            <View style={styles.dayOrderBadge}>
              <Text style={styles.dayOrderLabel}>Day Order No:</Text>
              <Text style={styles.dayOrderId}>#{dayOrderNo}</Text>
            </View>
          ) : null}

          {(() => {
            const confirmationBilling = order?.billing || (typeof order?.shipping_address === 'object' ? order.shipping_address?.billing : null);
            const confSubtotal = Number(order?.subtotal || confirmationBilling?.subtotal || 0);
            const confCgst = Number(order?.cgst_amount || confirmationBilling?.cgst_amount || 0);
            const confSgst = Number(order?.sgst_amount || confirmationBilling?.sgst_amount || 0);
            const confService = Number(order?.service_cost || confirmationBilling?.service_cost || 0);
            const confCgstRate = order?.cgst_rate !== undefined ? order.cgst_rate : (confirmationBilling?.cgst_rate || 2.5);
            const confSgstRate = order?.sgst_rate !== undefined ? order.sgst_rate : (confirmationBilling?.sgst_rate || 2.5);
            const confServiceRate = order?.service_cost_rate !== undefined ? order.service_cost_rate : (confirmationBilling?.service_cost_rate || 0);
            const hasConfBreakdown = confCgst > 0 || confSgst > 0 || confService > 0;

            if (!hasConfBreakdown) return null;

            return (
              <View style={{ width: '100%', marginVertical: 8, paddingHorizontal: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                {confSubtotal > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>Items Subtotal</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>₹{confSubtotal.toFixed(2)}</Text>
                  </View>
                )}
                {confCgst > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>CGST ({confCgstRate}%)</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{confCgst.toFixed(2)}</Text>
                  </View>
                )}
                {confSgst > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>SGST ({confSgstRate}%)</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{confSgst.toFixed(2)}</Text>
                  </View>
                )}
                {confService > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>Service Charge ({confServiceRate}%)</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E293B' }}>+₹{confService.toFixed(2)}</Text>
                  </View>
                )}
              </View>
            );
          })()}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Paid / Due:</Text>
            <Text style={styles.totalAmount}>₹{Number(order?.total_amount || 0).toFixed(2)}</Text>
          </View>

          {order?.payment_method && (
            <Text style={[styles.paymentMethod, { marginBottom: 8 }]}>
              Payment: {order.payment_method.toUpperCase()}
            </Text>
          )}

          {(() => {
            const payRef = order?.payment_reference ||
              route?.params?.paymentReference ||
              (typeof order?.shipping_address === 'object' ? order?.shipping_address?.payment_reference : null) ||
              (typeof order?.shipping_address === 'object' ? order?.shipping_address?.billing?.payment_reference : null) ||
              order?.shipping_address?.payment_note;
            if (!payRef) return null;
            return (
              <View style={styles.paymentRefBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Icon name="tag" size={13} color="#4F46E5" style={{ marginRight: 6 }} />
                  <Text style={styles.paymentRefBoxLabel}>UPI / Payment Reference Code:</Text>
                </View>
                <Text style={styles.paymentRefBoxVal}>{payRef}</Text>
                <Text style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                  Keep this 6-digit code to easily verify payment in your bank or UPI statement.
                </Text>
              </View>
            );
          })()}

          {/* Dynamic Payment QR Code Card to Pay Anytime */}
          <View style={styles.dynamicQrCard}>
            <View style={styles.dynamicQrHeader}>
              <View style={styles.qrHeaderIconCircle}>
                <Icon name="qrcode" size={18} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dynamicQrTitle}>Pay Anytime via Dynamic QR</Text>
                <Text style={styles.dynamicQrSubtitle}>
                  Exact bill pre-filled • Scan to pay anytime
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
                  <Text style={styles.qrLoadingText}>Generating Payment QR...</Text>
                </View>
              ) : qrImageSource ? (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => setIsQrViewerVisible(true)}
                  style={styles.qrTouchable}
                  accessibilityLabel="Tap to view full screen QR"
                >
                  <Image source={{ uri: qrImageSource }} style={styles.qrImg} resizeMode="contain" />
                  <View style={styles.qrAmountOverlay}>
                    <Text style={styles.qrAmountOverlayText}>
                      Exact Bill: ₹{totalAmount.toFixed(2)}
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

            {/* Highlighted Download Button with Icon */}
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
              💡 You can scan and pay right now, or download the QR code above to pay anytime before delivery.
            </Text>
          </View>

          <View style={styles.printActionRow}>
            <TouchableOpacity
              style={styles.printButton}
              onPress={() => printReceipt(order)}
              activeOpacity={0.85}
            >
              <Icon name="print" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.printButtonText}>Print Receipt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsIconBtn}
              onPress={() => announceOrderPrint(order)}
              accessibilityLabel="Announce Order Aloud"
              activeOpacity={0.8}
            >
              <Icon name="volume-up" size={20} color="#007AFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsIconBtn}
              onPress={() => setShowPrinterSettings(true)}
              accessibilityLabel="Printer Settings"
              activeOpacity={0.8}
            >
              <Icon name="cog" size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.navButtons}>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => navigation.navigate('Catalog', { sellerId: resolvedSellerId, sellerName: resolvedSellerName, customerId: resolvedCustomerId })}
              activeOpacity={0.85}
            >
              <Icon name="shopping-bag" size={15} color="#007AFF" style={{ marginRight: 8 }} />
              <Text style={styles.continueButtonText}>Continue Shopping</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ordersButton}
              onPress={() => navigation.navigate('OrderList', { sellerId: resolvedSellerId, sellerName: resolvedSellerName, customerId: resolvedCustomerId })}
              activeOpacity={0.85}
            >
              <Icon name="list-alt" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.ordersButtonText}>View My Orders</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

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
        visible={isQrViewerVisible}
        mediaList={qrImageSource ? [{ id: 'order-qr', uri: qrImageSource, title: `Order #${orderNumber} Payment QR`, subtitle: `Bill Total: ₹${totalAmount.toFixed(2)}` }] : []}
        initialIndex={0}
        onClose={() => setIsQrViewerVisible(false)}
        title={`Order #${orderNumber} Payment QR`}
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
    justifyContent: 'center',
  },
  confirmationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#A7F3D0',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  orderIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 8,
  },
  orderIdLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
    marginRight: 6,
  },
  orderId: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  dayOrderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 16,
  },
  dayOrderLabel: {
    fontSize: 13,
    color: '#0369A1',
    fontWeight: '700',
    marginRight: 6,
  },
  dayOrderId: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 15,
    color: '#475569',
    fontWeight: '600',
    marginRight: 8,
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
  },
  paymentMethod: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 20,
  },
  paymentRefBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  paymentRefBoxLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginRight: 6,
  },
  paymentRefBoxVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#007AFF',
    letterSpacing: 0.5,
  },
  printActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    width: '100%',
  },
  printButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  printButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsIconBtn: {
    marginLeft: 10,
    padding: 12,
    backgroundColor: '#F0F7FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtons: {
    width: '100%',
    gap: 10,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  continueButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ordersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  ordersButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
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

export default OrderConfirmationScreen;