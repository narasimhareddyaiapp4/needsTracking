import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Dimensions,
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function PreLoginMarqueeFooter({
  customMessage = '',
  navigation = null,
  style = null,
}) {
  const [adminContact, setAdminContact] = useState(getAdminContactSync());
  const [setWidth, setSetWidth] = useState(1600);

  // Marquee horizontal scroll animation
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);

  // Pulse animation for Highlighted WhatsApp badge
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Fetch verified admin mobile info on mount
  useEffect(() => {
    let isMounted = true;
    getAdminContactInfo().then((info) => {
      if (isMounted && info) {
        setAdminContact(info);
      }
    });

    // Start pulsing effect for highlight
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    pulseLoop.start();

    return () => {
      isMounted = false;
      pulseLoop.stop();
    };
  }, []);

  // Platform features showcased with icons & emojis
  const platformFeatures = [
    {
      id: 'digitalize',
      icon: 'rocket',
      color: '#38BDF8',
      bgColor: 'rgba(56, 189, 248, 0.18)',
      emoji: '🚀',
      title: 'Digitalize Your Business',
      desc: 'Instant Online Store Setup',
    },
    {
      id: 'products',
      icon: 'cube',
      color: '#60A5FA',
      bgColor: 'rgba(96, 165, 250, 0.18)',
      emoji: '📦',
      title: 'Products & Barcode Catalog',
      desc: 'Mobile Scanner & Variants',
    },
    {
      id: 'orders',
      icon: 'shopping-cart',
      color: '#34D399',
      bgColor: 'rgba(52, 211, 153, 0.18)',
      emoji: '🛒',
      title: 'Real-Time Orders',
      desc: 'Live Audio & Instant Bell Alerts',
    },
    {
      id: 'delivery',
      icon: 'motorcycle',
      color: '#F472B6',
      bgColor: 'rgba(244, 114, 182, 0.18)',
      emoji: '🚚',
      title: 'Live GPS Delivery Tracking',
      desc: 'Hyperlocal Map & Rider Location',
    },
    {
      id: 'billing',
      icon: 'print',
      color: '#FBBF24',
      bgColor: 'rgba(251, 191, 36, 0.18)',
      emoji: '🧾',
      title: 'Thermal POS Billing',
      desc: 'Bluetooth 58/80mm Receipts & Tax',
    },
    {
      id: 'inventory',
      icon: 'sliders',
      color: '#A78BFA',
      bgColor: 'rgba(167, 139, 250, 0.18)',
      emoji: '📊',
      title: 'Smart Stock & Inventory',
      desc: 'Auto Stock Counters & Low Alerts',
    },
    {
      id: 'store_qr',
      icon: 'qrcode',
      color: '#FB923C',
      bgColor: 'rgba(251, 146, 60, 0.18)',
      emoji: '📱',
      title: 'Store QR Menus',
      desc: 'Contactless Dine-In & Self-Order',
    },
    {
      id: 'demo',
      icon: 'calendar-check-o',
      color: '#4ADE80',
      bgColor: 'rgba(74, 222, 128, 0.18)',
      emoji: '🎯',
      title: 'Book Free Live Demo',
      desc: 'Schedule With Admin Today',
    },
    {
      id: 'admin',
      icon: 'phone',
      color: '#38BDF8',
      bgColor: 'rgba(56, 189, 248, 0.18)',
      emoji: '📞',
      title: 'Admin Desk',
      desc: adminContact.displayMobile,
    },
  ];

  // Continuous seamless loop scrolling animation
  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
    }
    if (setWidth <= 0) return;

    scrollAnim.setValue(0);
    // Smooth reading speed: ~35px per second
    const duration = Math.max(14000, setWidth * 28);

    animRef.current = Animated.loop(
      Animated.timing(scrollAnim, {
        toValue: -setWidth,
        duration: duration,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    animRef.current.start();

    return () => {
      if (animRef.current) {
        animRef.current.stop();
      }
    };
  }, [setWidth]);

  const handleSetLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w > 100 && Math.abs(w - setWidth) > 8) {
      setSetWidth(w);
    }
  };

  const handleFeaturePress = (feature) => {
    const msg = `Hello Admin, I am interested in: "${feature.title} (${feature.desc})" to digitalize my business setup on NeedsTracker.`;
    openAdminWhatsApp(msg);
  };

  const renderFeaturePills = (setIndex, onLayoutCallback = null) => (
    <View
      key={`feature-set-${setIndex}`}
      style={styles.setRow}
      onLayout={onLayoutCallback}
    >
      {platformFeatures.map((item, idx) => (
        <TouchableOpacity
          key={`pill-${setIndex}-${idx}`}
          style={styles.tickerPill}
          activeOpacity={0.75}
          onPress={() => handleFeaturePress(item)}
        >
          <View style={[styles.pillIconBox, { backgroundColor: item.bgColor, borderColor: item.color }]}>
            <Icon name={item.icon} size={11} color={item.color} />
          </View>
          <Text style={styles.pillEmoji}>{item.emoji}</Text>
          <Text style={[styles.pillTitle, { color: item.color }]}>{item.title}</Text>
          <Text style={styles.pillDesc}>• {item.desc}</Text>
          <View style={styles.pillDot} />
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[styles.wrapper, style]}>
      {/* 1. Moving Marquee Banner Bar */}
      <View style={styles.marqueeContainer}>
        {/* Left Fixed Tag Badge */}
        <TouchableOpacity
          style={styles.badgeBox}
          activeOpacity={0.8}
          onPress={() => openAdminWhatsApp('Hello Admin, I would like to book a free live demo for business digitalization.')}
        >
          <Icon name="bolt" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
          <Text style={styles.badgeText}>FEATURES & DEMO</Text>
        </TouchableOpacity>

        {/* Ticker Moving Viewport */}
        <View style={styles.tickerViewport}>
          <Animated.View
            style={[
              styles.tickerTrack,
              { transform: [{ translateX: scrollAnim }] },
            ]}
          >
            {/* 3 repeating sets of features to ensure a 100% gapless continuous marquee loop */}
            {renderFeaturePills(0, handleSetLayout)}
            {renderFeaturePills(1)}
            {renderFeaturePills(2)}
          </Animated.View>
        </View>
      </View>

      {/* 2. Highlighted Direct Action Icons Bar */}
      <View style={styles.actionsBar}>
        {/* Admin Contact Number Label / Tag */}
        <View style={styles.adminMetaRow}>
          <View style={styles.liveDot} />
          <Text style={styles.adminMetaLabel}>
            Contact Admin: <Text style={styles.adminMetaHighlight}>{adminContact.displayMobile}</Text>
          </Text>
        </View>

        {/* 4 Highlighted Action Buttons */}
        <View style={styles.iconButtonsRow}>
          {/* Highlight 1: WhatsApp Icon (Vibrant Green with Glowing Ring) */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[styles.highlightBtn, styles.btnWhatsApp]}
              onPress={() => openAdminWhatsApp()}
              activeOpacity={0.8}
              accessibilityLabel="Chat on WhatsApp with Admin"
            >
              <View style={styles.iconCircle}>
                <Icon name="whatsapp" size={19} color="#FFFFFF" />
              </View>
              <Text style={styles.btnLabel}>WhatsApp</Text>
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>Demo</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Highlight 2: Phone Call Icon */}
          <TouchableOpacity
            style={[styles.highlightBtn, styles.btnCall]}
            onPress={() => callAdmin()}
            activeOpacity={0.8}
            accessibilityLabel="Call Admin"
          >
            <View style={styles.iconCircle}>
              <Icon name="phone" size={17} color="#FFFFFF" />
            </View>
            <Text style={styles.btnLabel}>Call</Text>
          </TouchableOpacity>

          {/* Highlight 3: Mobile SMS Icon */}
          <TouchableOpacity
            style={[styles.highlightBtn, styles.btnSms]}
            onPress={() => sendAdminSms()}
            activeOpacity={0.8}
            accessibilityLabel="Send SMS to Admin"
          >
            <View style={styles.iconCircle}>
              <Icon name="comment" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.btnLabel}>SMS</Text>
          </TouchableOpacity>

          {/* Highlight 4: Facebook Share Icon */}
          <TouchableOpacity
            style={[styles.highlightBtn, styles.btnFacebook]}
            onPress={() => shareToFacebook()}
            activeOpacity={0.8}
            accessibilityLabel="Share on Facebook"
          >
            <View style={styles.iconCircle}>
              <Icon name="facebook" size={17} color="#FFFFFF" />
            </View>
            <Text style={styles.btnLabel}>FB Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderTopWidth: 2,
    borderTopColor: '#38BDF8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 12,
    zIndex: 998,
  },
  marqueeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    overflow: 'hidden',
  },
  badgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
    flexShrink: 0,
    zIndex: 2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tickerViewport: {
    flex: 1,
    overflow: 'hidden',
    height: 28,
    justifyContent: 'center',
  },
  tickerTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexWrap: 'nowrap',
    ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}),
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    flexWrap: 'nowrap',
    ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}),
  },
  tickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 14,
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.6)',
    flexShrink: 0,
  },
  pillIconBox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  pillEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  pillTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginRight: 5,
  },
  pillDesc: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#38BDF8',
    marginLeft: 8,
  },
  actionsBar: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 22 : 8,
  },
  adminMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  adminMetaLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  adminMetaHighlight: {
    color: '#38BDF8',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  iconButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 6,
  },
  highlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 72,
    position: 'relative',
  },
  iconCircle: {
    marginRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // WhatsApp Highlight
  btnWhatsApp: {
    backgroundColor: '#16A34A',
    borderColor: '#4ADE80',
    shadowColor: '#22C55E',
  },
  popularBadge: {
    position: 'absolute',
    top: -7,
    right: -4,
    backgroundColor: '#EF4444',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  popularBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },
  // Call Highlight
  btnCall: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
  },
  // SMS Highlight
  btnSms: {
    backgroundColor: '#0D9488',
    borderColor: '#2DD4BF',
    shadowColor: '#14B8A6',
  },
  // Facebook Highlight
  btnFacebook: {
    backgroundColor: '#1877F2',
    borderColor: '#60A5FA',
    shadowColor: '#1D4ED8',
  },
});
