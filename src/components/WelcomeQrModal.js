import React, { useState, useEffect } from 'react';
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
  Share,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'qrcode';
import { printStoreStandee } from '../services/printerService';
import { downloadQrCodeImage } from '../utils/qrDownloadUtils';
import { showAlert } from '../utils/alertUtils';

/**
 * Returns the canonical URL to the app's Welcome / Landing page.
 */
export function getAppWelcomeUrl() {
  let baseUrl = 'https://narasimhareddyaiapp2-localwala.github.io/needsTracking';
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/\/$/, '');
    baseUrl = `${origin}${pathname}`;
  }
  return baseUrl;
}

export default function WelcomeQrModal({ visible, onClose }) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  const appUrl = getAppWelcomeUrl();
  const remoteQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=8&ecc=L&data=${encodeURIComponent(appUrl)}`;

  // Generate local high-res data URL for crisp rendering & instant offline download
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(appUrl, {
          errorCorrectionLevel: 'L',
          margin: 3,
          width: 500,
          color: {
            dark: '#0F172A',
            light: '#FFFFFF',
          },
        });
        if (isMounted) {
          setQrDataUrl(dataUrl);
          setImageLoading(false);
        }
      } catch (_) {
        if (isMounted) {
          setQrDataUrl(null);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [appUrl]);

  const activeQrSrc = qrDataUrl || remoteQrUrl;

  const handleCopyLink = async () => {
    try {
      await Clipboard.setStringAsync(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      showAlert('Error', 'Failed to copy link to clipboard');
    }
  };

  const handleShareLink = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Needs Tracker - Hyperlocal Marketplace',
          text: 'Open Needs Tracker to browse verified local stores and track deliveries in real-time!',
          url: appUrl,
        });
        return;
      }
      await Share.share({
        title: 'Needs Tracker',
        message: `Open Needs Tracker to browse verified local stores and track deliveries: ${appUrl}`,
        url: appUrl,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        handleCopyLink();
      }
    }
  };

  const handleDownloadQr = async () => {
    setDownloading(true);
    try {
      await downloadQrCodeImage(activeQrSrc, 'NeedsTracker-Welcome-QR');
    } catch (err) {
      showAlert('Download Notice', err.message || 'Could not download QR image');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrintStandee = async () => {
    setPrinting(true);
    try {
      await printStoreStandee({
        sellerName: 'Needs Tracker',
        sellerAddress: 'Hyperlocal Marketplace & Delivery Platform',
        sellerPhone: 'Scan with any phone camera to open',
        storeUrl: appUrl,
        qrImageUrl: activeQrSrc,
      });
    } catch (err) {
      showAlert('Print Error', err.message || 'Could not launch standee print');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconBox}>
                <Icon name="qrcode" size={18} color="#007AFF" />
              </View>
              <View>
                <Text style={styles.modalTitle}>App QR Code</Text>
                <Text style={styles.modalSubtitle}>Scan to open Needs Tracker on mobile</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Icon name="times" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* App Brand Header Card */}
            <View style={styles.brandCard}>
              <View style={styles.brandIconBox}>
                <Icon name="map-marker" size={24} color="#007AFF" />
              </View>
              <View style={styles.brandInfo}>
                <Text style={styles.brandName}>Needs Tracker</Text>
                <Text style={styles.brandTagline}>Hyperlocal Marketplace & Logistics</Text>
              </View>
              <View style={styles.directBadge}>
                <Icon name="bolt" size={11} color="#059669" />
                <Text style={styles.directBadgeText}>Instant</Text>
              </View>
            </View>

            {/* QR Code Container */}
            <View style={styles.qrCard}>
              <View style={styles.qrImageFrame}>
                {imageLoading && (
                  <View style={styles.qrLoadingBox}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.qrLoadingText}>Generating QR...</Text>
                  </View>
                )}
                <Image
                  source={{ uri: activeQrSrc }}
                  style={[styles.qrImage, imageLoading && { display: 'none' }]}
                  onLoadEnd={() => setImageLoading(false)}
                  resizeMode="contain"
                />
              </View>

              <Text style={styles.qrInstruction}>
                Point any phone camera (iPhone, Android, or Google Lens) to open this page directly on your phone.
              </Text>
              <Text style={styles.noAppNote}>No app download required • Works on any smartphone browser</Text>
            </View>

            {/* App Link Box */}
            <View style={styles.urlBox}>
              <View style={styles.urlTextWrap}>
                <Icon name="link" size={12} color="#64748B" style={{ marginRight: 6 }} />
                <Text style={styles.urlText} numberOfLines={1}>
                  {appUrl}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.copyUrlBtn, copied && styles.copyUrlBtnSuccess]}
                onPress={handleCopyLink}
                activeOpacity={0.8}
              >
                <Icon
                  name={copied ? 'check' : 'clone'}
                  size={12}
                  color={copied ? '#FFFFFF' : '#007AFF'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.copyUrlText, copied && styles.copyUrlTextSuccess]}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Action Buttons Grid */}
            <View style={styles.actionsGrid}>
              {/* Share Link Button */}
              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={handleShareLink}
                activeOpacity={0.85}
              >
                <Icon name="share-alt" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.primaryActionBtnText}>Share Link</Text>
              </TouchableOpacity>

              {/* Download QR Button */}
              <TouchableOpacity
                style={styles.secondaryActionBtn}
                onPress={handleDownloadQr}
                disabled={downloading}
                activeOpacity={0.85}
              >
                {downloading ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : (
                  <>
                    <Icon name="download" size={14} color="#007AFF" style={{ marginRight: 6 }} />
                    <Text style={styles.secondaryActionBtnText}>Download QR</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Print Standee Poster Button */}
              <TouchableOpacity
                style={styles.secondaryActionBtn}
                onPress={handlePrintStandee}
                disabled={printing}
                activeOpacity={0.85}
              >
                {printing ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : (
                  <>
                    <Icon name="print" size={14} color="#007AFF" style={{ marginRight: 6 }} />
                    <Text style={styles.secondaryActionBtnText}>Print Poster</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Helpful Note */}
            <View style={styles.tipBox}>
              <Icon name="lightbulb-o" size={16} color="#D97706" style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.tipText}>
                <Text style={{ fontWeight: '700' }}>Quick Tip:</Text> Anyone can scan this QR code with their mobile camera to explore the app, view local sellers, place orders, and test the checkout system right away!
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
  },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  brandIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  brandInfo: {
    flex: 1,
  },
  brandName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  brandTagline: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  directBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  directBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  qrImageFrame: {
    width: 240,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  qrLoadingBox: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 220,
  },
  qrLoadingText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  qrImage: {
    width: '100%',
    height: '100%',
  },
  qrInstruction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  noAppNote: {
    fontSize: 11,
    color: '#059669',
    marginTop: 6,
    fontWeight: '600',
    textAlign: 'center',
  },
  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
    marginBottom: 16,
  },
  urlTextWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  urlText: {
    fontSize: 12,
    color: '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyUrlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginLeft: 8,
  },
  copyUrlBtnSuccess: {
    backgroundColor: '#10B981',
    borderColor: '#059669',
  },
  copyUrlText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  copyUrlTextSuccess: {
    color: '#FFFFFF',
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 10,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryActionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  secondaryActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  tipText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
});
