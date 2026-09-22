import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  getSellerContactInfo,
  makeSellerCall,
  sendSellerSms,
  openSellerWhatsApp,
  shareProductDetails,
} from '../services/sellerContactService';
import { showAlert } from '../utils/alertUtils';

export default function SellerContactShareModal({
  visible,
  onClose,
  product,
  sellerId = null,
  sellerInfo = null,
  storeName = '',
}) {
  const [loading, setLoading] = useState(true);
  const [sellerContact, setSellerContact] = useState(null);
  const [copied, setCopied] = useState(false);
  const [highlightMode, setHighlightMode] = useState(true);
  const [customNote, setCustomNote] = useState('');

  // Fetch or map seller contact details whenever visible or product/seller changes
  useEffect(() => {
    let isMounted = true;
    if (!visible) return;

    async function loadContact() {
      setLoading(true);
      try {
        const contact = await getSellerContactInfo({
          sellerId: sellerId || product?.user_id || product?.customer_id,
          customerId: product?.customer_id,
          product,
          fallbackSeller: sellerInfo,
        });
        if (isMounted) {
          setSellerContact(contact);
        }
      } catch (err) {
        console.warn('[SellerContactShareModal] Error loading seller contact:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadContact();

    return () => {
      isMounted = false;
    };
  }, [visible, product, sellerId, sellerInfo]);

  const activeMobile = sellerContact?.mobile || sellerInfo?.mobile || product?.seller_mobile || null;
  const activeSellerName = sellerContact?.full_name || sellerInfo?.full_name || storeName || 'Verified Seller';
  const productName = product?.product_name || product?.name || 'Selected Product';
  const productPrice = product?.amount || product?.price || null;

  // Primary image
  const firstMedia = (product?.product_media || []).find(
    (m) => (m.media_url || m.uri) && (m.media_type === 'image' || !m.media_type)
  );
  const productImage = firstMedia?.media_url || firstMedia?.uri || product?.image_url || null;

  // Copy mobile number
  const handleCopyNumber = async () => {
    if (!activeMobile) return;
    try {
      await Clipboard.setStringAsync(activeMobile);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      showAlert('Notice', `Seller mobile: ${activeMobile}`);
    }
  };

  // 1. Mobile Call
  const handleCall = async () => {
    if (!activeMobile) {
      showAlert('Contact Info Missing', 'Seller has not registered a mobile number yet.');
      return;
    }
    try {
      await makeSellerCall(activeMobile);
    } catch (err) {
      showAlert('Call Error', err.message || 'Unable to initiate call on this device.');
    }
  };

  // 2. Message / SMS
  const handleSms = async (customMessage = '') => {
    if (!activeMobile) {
      showAlert('Contact Info Missing', 'Seller has not registered a mobile number yet.');
      return;
    }
    try {
      await sendSellerSms(activeMobile, {
        productName: customMessage ? `${productName} (${customMessage})` : productName,
        productPrice,
        storeName: activeSellerName,
      });
    } catch (err) {
      showAlert('SMS Error', err.message || 'Unable to open SMS application.');
    }
  };

  // 3. WhatsApp Call & Chat
  const handleWhatsApp = async () => {
    if (!activeMobile) {
      showAlert('Contact Info Missing', 'Seller has not registered a mobile number yet.');
      return;
    }
    try {
      await openSellerWhatsApp(activeMobile, {
        productName,
        productPrice,
        storeName: activeSellerName,
      });
    } catch (err) {
      showAlert('WhatsApp Error', err.message || 'Unable to open WhatsApp.');
    }
  };

  // 4. Share Product Details
  const handleShare = async () => {
    try {
      await shareProductDetails({
        product,
        sellerContact: sellerContact || sellerInfo,
        storeName: activeSellerName,
      });
    } catch (err) {
      showAlert('Share Error', err.message || 'Unable to open share menu.');
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, highlightMode && styles.modalCardHighlight]}>
          {/* Header */}
          <View style={[styles.headerContainer, highlightMode && styles.headerContainerHighlight]}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerIconBox, highlightMode && styles.headerIconBoxHighlight]}>
                <Icon name="share-alt" size={17} color={highlightMode ? "#0284C7" : "#475569"} />
              </View>
              <View>
                <View style={styles.titleRow}>
                  <Text style={styles.headerTitle}>Connect & Share</Text>
                  {highlightMode && (
                    <View style={styles.highlightBadge}>
                      <Icon name="bolt" size={10} color="#0284C7" />
                      <Text style={styles.highlightBadgeText}>HIGHLIGHT MODE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.headerSubtitle}>Direct seller communication & quick share</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityLabel="Close modal">
              <Icon name="times" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Highlight Mode Toggle Banner */}
            <View style={styles.highlightToggleRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="magic" size={14} color={highlightMode ? "#0284C7" : "#64748B"} />
                <Text style={styles.toggleLabel}>Highlight Mode (Quick Connect)</Text>
              </View>
              <Switch
                value={highlightMode}
                onValueChange={setHighlightMode}
                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                thumbColor={highlightMode ? '#0284C7' : '#94A3B8'}
              />
            </View>

            {/* Product Summary Card */}
            {product && (
              <View style={[styles.productCard, highlightMode && styles.productCardHighlight]}>
                {productImage ? (
                  <Image source={{ uri: productImage }} style={styles.productImg} resizeMode="cover" />
                ) : (
                  <View style={styles.productImgPlaceholder}>
                    <Icon name="shopping-bag" size={24} color="#94A3B8" />
                  </View>
                )}
                <View style={styles.productInfo}>
                  <Text style={styles.productNameText} numberOfLines={2}>
                    {productName}
                  </Text>
                  <View style={styles.productPriceRow}>
                    {productPrice != null && (
                      <Text style={styles.productPriceText}>₹{productPrice}</Text>
                    )}
                    {product.size ? (
                      <Text style={styles.productSizeBadge}>{product.size}</Text>
                    ) : null}
                  </View>
                </View>
              </View>
            )}

            {/* Seller Contact Info (Mapped Automatically) */}
            <View style={[styles.sellerCard, highlightMode && styles.sellerCardHighlight]}>
              <View style={styles.sellerHeaderRow}>
                <View style={styles.sellerAvatarBox}>
                  {sellerContact?.avatar_url ? (
                    <Image source={{ uri: sellerContact.avatar_url }} style={styles.sellerAvatar} />
                  ) : (
                    <Icon name="user-circle" size={32} color="#0284C7" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.sellerNameRow}>
                    <Text style={styles.sellerNameText} numberOfLines={1}>
                      {activeSellerName}
                    </Text>
                    <View style={styles.verifiedBadge}>
                      <Icon name="check-circle" size={11} color="#10B981" />
                      <Text style={styles.verifiedText}>Seller</Text>
                    </View>
                  </View>
                  {sellerContact?.address ? (
                    <Text style={styles.sellerAddressText} numberOfLines={1}>
                      📍 {sellerContact.address}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Mobile Number Display Box */}
              <View style={[styles.phoneContainer, highlightMode && styles.phoneContainerHighlight]}>
                <View style={styles.phoneLabelRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="phone" size={13} color="#0284C7" />
                    <Text style={styles.phoneLabel}>SELLER MOBILE NUMBER (MAPPED)</Text>
                  </View>
                  {loading && <ActivityIndicator size="small" color="#0284C7" />}
                </View>

                {activeMobile ? (
                  <View style={styles.phoneNumberBox}>
                    <Text style={[styles.phoneNumberText, highlightMode && styles.phoneNumberTextHighlight]}>
                      {activeMobile}
                    </Text>
                    <TouchableOpacity
                      style={[styles.copyBtn, copied && styles.copyBtnDone]}
                      onPress={handleCopyNumber}
                      activeOpacity={0.7}
                    >
                      <Icon name={copied ? "check" : "copy"} size={13} color={copied ? "#10B981" : "#0284C7"} />
                      <Text style={[styles.copyBtnText, copied && styles.copyBtnTextDone]}>
                        {copied ? 'Copied' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.noPhoneBox}>
                    <Text style={styles.noPhoneText}>
                      {loading ? 'Retrieving seller contact...' : 'No direct mobile number found for this seller.'}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Quick Action Points ("opoints") */}
            <Text style={styles.actionsSectionTitle}>Direct Communication Options</Text>

            <View style={styles.actionGrid}>
              {/* Point 1: Mobile Call */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnCall, highlightMode && styles.actionBtnCallHighlight]}
                onPress={handleCall}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: '#DCFCE7' }]}>
                  <Icon name="phone" size={20} color="#16A34A" />
                </View>
                <View style={styles.actionBtnContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.actionBtnTitle}>Mobile Call</Text>
                    <View style={[styles.actionMiniTag, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={[styles.actionMiniTagText, { color: '#16A34A' }]}>Dialer</Text>
                    </View>
                  </View>
                  <Text style={styles.actionBtnDesc}>Call seller immediately</Text>
                </View>
                <Icon name="chevron-right" size={13} color="#94A3B8" />
              </TouchableOpacity>

              {/* Point 2: WhatsApp Call & Chat */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnWhatsApp, highlightMode && styles.actionBtnWhatsAppHighlight]}
                onPress={handleWhatsApp}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: '#DCFCE7' }]}>
                  <Icon name="whatsapp" size={22} color="#25D366" />
                </View>
                <View style={styles.actionBtnContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.actionBtnTitle}>WhatsApp Chat / Call</Text>
                    <View style={[styles.actionMiniTag, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={[styles.actionMiniTagText, { color: '#25D366' }]}>WhatsApp</Text>
                    </View>
                  </View>
                  <Text style={styles.actionBtnDesc}>Instant chat & voice/video call</Text>
                </View>
                <Icon name="chevron-right" size={13} color="#94A3B8" />
              </TouchableOpacity>

              {/* Point 3: Message / SMS */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSms, highlightMode && styles.actionBtnSmsHighlight]}
                onPress={() => handleSms()}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: '#E0F2FE' }]}>
                  <Icon name="comment" size={18} color="#0284C7" />
                </View>
                <View style={styles.actionBtnContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.actionBtnTitle}>Message / SMS</Text>
                    <View style={[styles.actionMiniTag, { backgroundColor: '#E0F2FE' }]}>
                      <Text style={[styles.actionMiniTagText, { color: '#0284C7' }]}>Text</Text>
                    </View>
                  </View>
                  <Text style={styles.actionBtnDesc}>Send inquiry via default SMS</Text>
                </View>
                <Icon name="chevron-right" size={13} color="#94A3B8" />
              </TouchableOpacity>

              {/* Point 4: Native Share */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnShare, highlightMode && styles.actionBtnShareHighlight]}
                onPress={handleShare}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: '#EDE9FE' }]}>
                  <Icon name="share-alt" size={18} color="#6366F1" />
                </View>
                <View style={styles.actionBtnContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.actionBtnTitle}>Share Product</Text>
                    <View style={[styles.actionMiniTag, { backgroundColor: '#EDE9FE' }]}>
                      <Text style={[styles.actionMiniTagText, { color: '#6366F1' }]}>Social</Text>
                    </View>
                  </View>
                  <Text style={styles.actionBtnDesc}>Share link with price & seller info</Text>
                </View>
                <Icon name="chevron-right" size={13} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Quick Inquiry Prompts for SMS */}
            <View style={styles.quickPromptsContainer}>
              <Text style={styles.quickPromptsTitle}>Quick SMS Inquiries:</Text>
              <View style={styles.promptChipsRow}>
                {[
                  'Is this available in stock?',
                  'Can you offer home delivery?',
                  'Best discounted price?',
                ].map((prompt, idx) => (
                  <TouchableOpacity
                    key={`prompt-${idx}`}
                    style={styles.promptChip}
                    onPress={() => handleSms(prompt)}
                    activeOpacity={0.7}
                  >
                    <Icon name="paper-plane-o" size={11} color="#0284C7" />
                    <Text style={styles.promptChipText}>{prompt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footerContainer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.doneBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '92%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
  },
  modalCardHighlight: {
    borderWidth: 2,
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
    shadowOpacity: 0.35,
    shadowRadius: 22,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerContainerHighlight: {
    backgroundColor: '#F0F9FF',
    borderBottomColor: '#BAE6FD',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBoxHighlight: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  highlightBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  highlightToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  productCardHighlight: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  productImg: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#CBD5E1',
  },
  productImgPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  productPriceText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0284C7',
  },
  productSizeBadge: {
    fontSize: 11,
    color: '#64748B',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  sellerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sellerCardHighlight: {
    borderColor: '#BAE6FD',
    backgroundColor: '#F8FAFC',
  },
  sellerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  sellerAvatarBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sellerNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
  },
  sellerAddressText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  phoneContainer: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  phoneContainerHighlight: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  phoneLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  phoneLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.5,
  },
  phoneNumberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phoneNumberText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  phoneNumberTextHighlight: {
    color: '#0369A1',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  copyBtnDone: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  copyBtnTextDone: {
    color: '#16A34A',
  },
  noPhoneBox: {
    paddingVertical: 4,
  },
  noPhoneText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
  },
  actionsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  actionGrid: {
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionBtnCall: {
    borderLeftWidth: 4,
    borderLeftColor: '#16A34A',
  },
  actionBtnCallHighlight: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  actionBtnWhatsApp: {
    borderLeftWidth: 4,
    borderLeftColor: '#25D366',
  },
  actionBtnWhatsAppHighlight: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  actionBtnSms: {
    borderLeftWidth: 4,
    borderLeftColor: '#0284C7',
  },
  actionBtnSmsHighlight: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  actionBtnShare: {
    borderLeftWidth: 4,
    borderLeftColor: '#6366F1',
  },
  actionBtnShareHighlight: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
  actionIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionBtnContent: {
    flex: 1,
  },
  actionBtnTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionMiniTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  actionMiniTagText: {
    fontSize: 9,
    fontWeight: '800',
  },
  actionBtnDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  quickPromptsContainer: {
    marginTop: 14,
    marginBottom: 8,
  },
  quickPromptsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
  },
  promptChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  promptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  promptChipText: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
  },
  footerContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  doneBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
