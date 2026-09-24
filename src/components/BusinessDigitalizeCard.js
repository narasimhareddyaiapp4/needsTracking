import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import {
  getAdminContactInfo,
  getAdminContactSync,
  openAdminWhatsApp,
  callAdmin,
  sendAdminSms,
  shareToFacebook,
} from '../services/adminContactService';

export default function BusinessDigitalizeCard({ style = null }) {
  const [adminContact, setAdminContact] = useState(getAdminContactSync());

  useEffect(() => {
    let isMounted = true;
    getAdminContactInfo().then((info) => {
      if (isMounted && info) {
        setAdminContact(info);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleQuickInquiry = (topic) => {
    const msg = `Hello Admin, I would like to inquire about: "${topic}" to digitalize my business setup on NeedsTracker.`;
    openAdminWhatsApp(msg);
  };

  return (
    <View style={[styles.card, style]}>
      {/* Top Banner Tag */}
      <View style={styles.topBanner}>
        <View style={styles.badgeRow}>
          <View style={styles.boltIcon}>
            <Icon name="rocket" size={13} color="#FFFFFF" />
          </View>
          <Text style={styles.badgeText}>INDUSTRY & BUSINESS DIGITALIZATION</Text>
        </View>
        <View style={styles.liveTag}>
          <View style={styles.pulseDot} />
          <Text style={styles.liveText}>FREE DEMO</Text>
        </View>
      </View>

      {/* Main Title & Description */}
      <View style={styles.contentBox}>
        <Text style={styles.title}>Digitalize Your Business Setup & Request a Demo</Text>
        <Text style={styles.subtitle}>
          Transform your local shop into an online powerhouse! Instant products & barcode catalog, real-time orders with sound alerts, live GPS delivery tracking, thermal POS billing, and automated inventory.
        </Text>

        {/* Feature Highlights Grid */}
        <View style={styles.featuresGrid}>
          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#EFF6FF' }]}>
              <Icon name="cube" size={14} color="#007AFF" />
            </View>
            <Text style={styles.featureText}>Products & Barcode Catalog</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#ECFDF5' }]}>
              <Icon name="shopping-cart" size={14} color="#10B981" />
            </View>
            <Text style={styles.featureText}>Real-Time Orders & Sound Alerts</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#FDF2F8' }]}>
              <Icon name="motorcycle" size={14} color="#DB2777" />
            </View>
            <Text style={styles.featureText}>Live GPS Delivery Tracking</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#F3E8FF' }]}>
              <Icon name="print" size={14} color="#9333EA" />
            </View>
            <Text style={styles.featureText}>Thermal POS Billing & Invoices</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#EEF2FF' }]}>
              <Icon name="sliders" size={14} color="#4F46E5" />
            </View>
            <Text style={styles.featureText}>Automated Stock & Inventory</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconBox, { backgroundColor: '#FEF3C7' }]}>
              <Icon name="qrcode" size={14} color="#D97706" />
            </View>
            <Text style={styles.featureText}>Store QR Menus & Dine-In</Text>
          </View>
        </View>

        {/* Admin Contact Highlight Box */}
        <View style={styles.adminBox}>
          <View style={styles.adminLeftCol}>
            <View style={styles.avatarCircle}>
              {adminContact.avatar_url ? (
                <Image source={{ uri: adminContact.avatar_url }} style={styles.avatarImg} />
              ) : (
                <Icon name="user-circle" size={32} color="#0284C7" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.adminNameRow}>
                <Text style={styles.adminName}>{adminContact.full_name || 'Admin Setup Desk'}</Text>
                <View style={styles.verifiedChip}>
                  <Icon name="check-circle" size={11} color="#10B981" />
                  <Text style={styles.verifiedChipText}>Admin</Text>
                </View>
              </View>
              <Text style={styles.adminMobileText}>
                Mobile: <Text style={styles.adminMobileBold}>{adminContact.displayMobile}</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Highlighted Action Buttons (WhatsApp, Call, SMS, Facebook Share) */}
        <View style={styles.actionGrid}>
          {/* 1. Highlighted WhatsApp Button (Primary Big CTA) */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.btnWhatsApp]}
            onPress={() => openAdminWhatsApp()}
            activeOpacity={0.85}
          >
            <View style={styles.actionBtnIconBox}>
              <Icon name="whatsapp" size={20} color="#FFFFFF" />
            </View>
            <View style={styles.actionBtnTextCol}>
              <Text style={styles.actionBtnTitle}>WhatsApp Demo</Text>
              <Text style={styles.actionBtnSub}>Instant chat & demo setup</Text>
            </View>
            <Icon name="chevron-right" size={13} color="#DCFCE7" />
          </TouchableOpacity>

          {/* 2. Highlighted Direct Call Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.btnCall]}
            onPress={() => callAdmin()}
            activeOpacity={0.85}
          >
            <View style={styles.actionBtnIconBox}>
              <Icon name="phone" size={18} color="#FFFFFF" />
            </View>
            <View style={styles.actionBtnTextCol}>
              <Text style={styles.actionBtnTitle}>Direct Call</Text>
              <Text style={styles.actionBtnSub}>{adminContact.displayMobile}</Text>
            </View>
            <Icon name="chevron-right" size={13} color="#E0F2FE" />
          </TouchableOpacity>

          {/* 3. Highlighted SMS Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.btnSms]}
            onPress={() => sendAdminSms()}
            activeOpacity={0.85}
          >
            <View style={styles.actionBtnIconBox}>
              <Icon name="comment" size={17} color="#FFFFFF" />
            </View>
            <View style={styles.actionBtnTextCol}>
              <Text style={styles.actionBtnTitle}>Send SMS</Text>
              <Text style={styles.actionBtnSub}>Text your setup inquiry</Text>
            </View>
            <Icon name="chevron-right" size={13} color="#CCFBF1" />
          </TouchableOpacity>

          {/* 4. Highlighted Facebook Share Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.btnFacebook]}
            onPress={() => shareToFacebook()}
            activeOpacity={0.85}
          >
            <View style={styles.actionBtnIconBox}>
              <Icon name="facebook" size={18} color="#FFFFFF" />
            </View>
            <View style={styles.actionBtnTextCol}>
              <Text style={styles.actionBtnTitle}>Facebook Share</Text>
              <Text style={styles.actionBtnSub}>Share platform with friends</Text>
            </View>
            <Icon name="chevron-right" size={13} color="#DBEAFE" />
          </TouchableOpacity>
        </View>

        {/* Quick Demo Inquiries Chips */}
        <View style={styles.quickChipsBox}>
          <Text style={styles.quickChipsTitle}>Quick Inquiries (Tap to chat):</Text>
          <View style={styles.chipsRow}>
            {[
              'Book Free Live Demo',
              'Products & Barcode Setup',
              'Real-Time Orders & Alerts',
              'Live GPS Delivery Tracking',
              'Thermal POS Billing Setup',
              'Automated Stock & Inventory',
              'Store QR Menus Setup',
            ].map((chip, idx) => (
              <TouchableOpacity
                key={`chip-${idx}`}
                style={styles.chip}
                onPress={() => handleQuickInquiry(chip)}
                activeOpacity={0.7}
              >
                <Icon name="paper-plane" size={10} color="#0284C7" style={{ marginRight: 5 }} />
                <Text style={styles.chipText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginHorizontal: 16,
    marginVertical: 14,
    borderWidth: 2,
    borderColor: '#38BDF8',
    overflow: 'hidden',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
  topBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  boltIcon: {
    backgroundColor: '#0284C7',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 5,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    color: '#10B981',
    fontSize: 9.5,
    fontWeight: '800',
  },
  contentBox: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    lineHeight: 24,
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    gap: 6,
  },
  featureIconBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#1E293B',
    flexShrink: 1,
  },
  adminBox: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginBottom: 14,
  },
  adminLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0F2FE',
  },
  avatarImg: {
    width: 36,
    height: 36,
  },
  adminNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  adminName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0369A1',
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 8,
    gap: 3,
  },
  verifiedChipText: {
    color: '#15803D',
    fontSize: 9.5,
    fontWeight: '700',
  },
  adminMobileText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  adminMobileBold: {
    color: '#0284C7',
    fontWeight: '700',
  },
  actionGrid: {
    gap: 8,
    marginBottom: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  actionBtnIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionBtnTextCol: {
    flex: 1,
  },
  actionBtnTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  actionBtnSub: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    marginTop: 1,
  },
  // WhatsApp Highlight
  btnWhatsApp: {
    backgroundColor: '#16A34A',
    borderColor: '#4ADE80',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  // Call Highlight
  btnCall: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  // SMS Highlight
  btnSms: {
    backgroundColor: '#0D9488',
    borderColor: '#2DD4BF',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  // Facebook Highlight
  btnFacebook: {
    backgroundColor: '#1877F2',
    borderColor: '#60A5FA',
    shadowColor: '#1877F2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  quickChipsBox: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  quickChipsTitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipText: {
    color: '#0369A1',
    fontSize: 11,
    fontWeight: '600',
  },
});
