import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import SellerSalesReport from '../components/SellerSalesReport';
import SellerPnLReport from '../components/SellerPnLReport';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import { supabase } from '../services/supabase';
import { useCart } from '../context/CartContext';

const SellerSalesReportScreen = ({ navigation, route }) => {
  const { role: contextRole } = useCart();
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(contextRole || null);
  const [reportTab, setReportTab] = useState(route?.params?.initialTab || 'pnl'); // 'pnl' | 'sales'

  const routeSellerId = route?.params?.sellerId;
  const routeSellerName = route?.params?.sellerName;
  const customerId = route?.params?.customerId;

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);
        if (!contextRole) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
          setUserRole(prof?.role || 'seller');
        }
      }
    };
    fetchUser();
  }, [contextRole]);

  const effectiveSellerId = routeSellerId || route?.params?.userId || currentUser?.id;
  const canGoBack = Boolean(navigation?.canGoBack && navigation.canGoBack());

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        {canGoBack && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={16} color="#0F172A" />
          </TouchableOpacity>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {reportTab === 'pnl' ? '💰 Profit & Loss / Expenses' : '📊 Sales & Hourly Analytics'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {routeSellerName ? routeSellerName : 'Store Financials & Performance'}
          </Text>
        </View>

        {/* Top Report Mode Switcher */}
        <View style={styles.reportSwitchGroup}>
          <TouchableOpacity
            style={[styles.reportSwitchBtn, reportTab === 'pnl' && styles.reportSwitchBtnActive]}
            onPress={() => setReportTab('pnl')}
          >
            <Text style={[styles.reportSwitchText, reportTab === 'pnl' && styles.reportSwitchTextActive]}>
              P&L / Expenses
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.reportSwitchBtn, reportTab === 'sales' && styles.reportSwitchBtnActive]}
            onPress={() => setReportTab('sales')}
          >
            <Text style={[styles.reportSwitchText, reportTab === 'sales' && styles.reportSwitchTextActive]}>
              Sales
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Report Body */}
      <View style={{ flex: 1 }}>
        {reportTab === 'pnl' ? (
          <SellerPnLReport
            sellerId={effectiveSellerId}
            sellerName={routeSellerName}
            onClose={canGoBack ? () => navigation.goBack() : undefined}
          />
        ) : (
          <SellerSalesReport
            sellerId={effectiveSellerId}
            sellerName={routeSellerName}
            onClose={canGoBack ? () => navigation.goBack() : undefined}
          />
        )}
      </View>

      {/* Footer Navigation (only shows when outside Tab navigator) */}
      <StoreNavigationFooter
        activeTab="orders"
        navigation={navigation}
        route={route}
        sellerId={effectiveSellerId}
        sellerName={routeSellerName}
        customerId={customerId}
        forceShow={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    padding: 8,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  reportSwitchGroup: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 3,
    marginLeft: 10,
  },
  reportSwitchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  reportSwitchBtnActive: {
    backgroundColor: '#0F172A',
  },
  reportSwitchText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  reportSwitchTextActive: {
    color: '#FFFFFF',
  },
});

export default SellerSalesReportScreen;
