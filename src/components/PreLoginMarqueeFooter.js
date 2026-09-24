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
  const [containerWidth, setContainerWidth] = useState(SCREEN_WIDTH || 360);
  const [textWidth, setTextWidth] = useState(600);

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

  // Marquee scrolling animation loop
  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
    }

    const startX = containerWidth > 0 ? containerWidth : SCREEN_WIDTH;
    const endX = -Math.max(textWidth, 500);
    const totalDistance = startX - endX;
    // Speed: ~40px per second for smooth easy readability
    const duration = Math.max(8000, totalDistance * 26);

    scrollAnim.setValue(startX);

    animRef.current = Animated.loop(
      Animated.timing(scrollAnim, {
        toValue: endX,
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
  }, [containerWidth, textWidth]);

  const handleContainerLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - containerWidth) > 5) {
      setContainerWidth(w);
    }
  };

  const handleTextLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - textWidth) > 5) {
      setTextWidth(w);
    }
  };

  const marqueeMessage = `🚀 Digitalize Your Business Setup • Schedule a Free Live Demo Today • Hyperlocal GPS Order & Delivery Tracking • Contact Admin: ${adminContact.displayMobile} • Instant WhatsApp & Call Support • Transform your local store to an online marketplace • `;

  return (
    <View style={[styles.wrapper, style]} onLayout={handleContainerLayout}>
      {/* 1. Moving Marquee Banner Bar */}
      <TouchableOpacity
        style={styles.marqueeContainer}
        activeOpacity={0.9}
        onPress={() => openAdminWhatsApp()}
        accessibilityLabel="Digitalize business and contact admin marquee"
      >
        <View style={styles.badgeBox}>
          <Icon name="bolt" size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
          <Text style={styles.badgeText}>SETUP & DEMO</Text>
        </View>

        <View style={styles.tickerViewport}>
          <Animated.View
            style={[
              styles.tickerTrack,
              { transform: [{ translateX: scrollAnim }] },
            ]}
          >
            <Text
              style={styles.marqueeText}
              numberOfLines={1}
              onLayout={handleTextLayout}
            >
              {marqueeMessage}
            </Text>
          </Animated.View>
        </View>
      </TouchableOpacity>

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
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    overflow: 'hidden',
  },
  badgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingHorizontal: 7,
    paddingVertical: 3,
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
    height: 20,
    justifyContent: 'center',
  },
  tickerTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  marqueeText: {
    color: '#F8FAFC',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.3,
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
