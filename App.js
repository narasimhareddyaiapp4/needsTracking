import 'react-native-get-random-values'; // Polyfill for crypto.getRandomValues
import { Platform } from 'react-native';

// Defensive safeguard against browser translation / extension DOM mutations and React portal removeChild errors
if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof Node === 'function' && Node.prototype) {
  const origRemove = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (!child || child.parentNode !== this) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Node.removeChild safely caught unparented child:', child);
      }
      return child;
    }
    return origRemove.apply(this, arguments);
  };

  const origInsert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, refNode) {
    if (refNode && refNode.parentNode !== this) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Node.insertBefore safely appending unparented refNode:', newNode, refNode);
      }
      return this.appendChild(newNode);
    }
    return origInsert.apply(this, arguments);
  };
}

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import {
  registerForPushNotificationsAsync,
  schedulePushNotification,
  setGlobalNotificationClickHandler,
} from './src/services/notificationService';
import NotificationBanner from './src/components/NotificationBanner';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';


// React Navigation imports
import { NavigationContainer, useNavigationContainerRef, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Import screens
import WelcomeScreen from './src/screens/WelcomeScreen';
import SellersMapScreen from './src/screens/SellersMapScreen';
import CatalogScreen from './src/screens/CatalogScreen';
import BuyerAuthScreen from './src/screens/BuyerAuthScreen';
import BuyerLoginScreen from './src/screens/BuyerLoginScreen';
import BuyerSignupScreen from './src/screens/BuyerSignupScreen';
import CartScreen from './src/screens/CartScreen';
import CheckoutScreen from './src/screens/CheckoutScreen';
import OrderConfirmationScreen from './src/screens/OrderConfirmationScreen';
import OrderListScreen from './src/screens/OrderListScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import TopProductsScreen from './src/screens/TopProductsScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import OrderEditScreen from './src/screens/OrderEditScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import SellerLoginScreen from './src/screens/SellerLoginScreen';
import ProductMapScreen from './src/screens/ProductMapScreen';
import DeliveryManagerLoginScreen from './src/screens/DeliveryManagerLoginScreen';
import DeliveryManagerDashboard from './src/screens/DeliveryManagerDashboard';
import DeliveryManagerSignupScreen from './src/screens/DeliveryManagerSignupScreen';
import AdminMapScreen from './src/screens/AdminMapScreen';
import UpiQrScreen from './src/screens/UpiQrScreen';
import CustomerDamageScreen from './src/screens/CustomerDamageScreen';
import CatalogManagementScreen from './src/screens/CatalogManagementScreen';
import ProductDetailScreen from './src/screens/ProductDetailScreen';

// Import custom navigators
import ProductTabNavigator from './src/navigation/ProductTabNavigator';

// Import services & context
import { supabase, ensureUserProfile } from './src/services/supabase';
import { getPreferredStore, setPreferredStore } from './src/services/localStorageService';
import { CartProvider } from './src/context/CartContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { announceNewOrder } from './src/services/speechService';

const Stack = createStackNavigator();

function AppInner() {
  const navigationRef = useNavigationContainerRef();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const navigateToRoleScreen = async (user, currentSession) => {
      if (!user) return;
      try {
        const profile = await ensureUserProfile(user);
        const role = profile?.role || user.user_metadata?.role || 'customer';

        const currentRoute = navigationRef.current?.getCurrentRoute()?.name;
        const rootAuthScreens = [
          'Welcome',
          'Login',
          'Signup',
          'SellerLogin',
          'BuyerLogin',
          'BuyerSignup',
          'BuyerAuth',
          'DeliveryManagerLogin',
          'DeliveryManagerSignup',
        ];

        if (!currentRoute || rootAuthScreens.includes(currentRoute)) {
          if (role === 'delivery_manager') {
            navigationRef.current?.navigate('DeliveryManagerDashboard');
          } else if (role === 'seller' || role === 'admin' || role === 'superadmin') {
            navigationRef.current?.navigate('ProductTabs', { session: currentSession, role });
          } else {
            // Customer / Buyer: If currently shopping at a preferred store (via QR scan), open that store's Catalog!
            try {
              const prefStore = await getPreferredStore();
              if (prefStore?.sellerId) {
                navigationRef.current?.navigate('Catalog', {
                  sellerId: prefStore.sellerId,
                  sellerName: prefStore.sellerName || '',
                  isDirectQr: Boolean(prefStore?.isDirectQr),
                });
                return;
              }
            } catch (_) {}
            navigationRef.current?.navigate('ProductTabs', { session: currentSession, role: 'customer' });
          }
        }
      } catch (err) {
        console.warn('[App] Error in navigateToRoleScreen:', err);
      }
    };

    const fetchAndSetSession = async () => {
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (isMounted) {
          setSession(session || null);
          if (session?.user) {
            navigateToRoleScreen(session.user, session);
          }
        }
      } catch (err) {
        console.warn('Error fetching session:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchAndSetSession(); // Initial fetch

    // Fallback safety timeout: Never keep the user stuck on the loading spinner for more than 800ms
    const timeoutTimer = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 800);

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (isMounted) {
        setSession(currentSession || null);
        setLoading(false);
      }

      if (event === 'SIGNED_OUT' || (!currentSession && event !== 'INITIAL_SESSION')) {
        try {
          if (navigationRef.isReady()) {
            navigationRef.reset({
              index: 0,
              routes: [{ name: 'Welcome' }],
            });
          }
        } catch (navErr) {
          console.warn('[App] Navigation reset on SIGNED_OUT notice:', navErr);
        }
      } else if (currentSession?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        navigateToRoleScreen(currentSession.user, currentSession);

        // Clean up URL hash / code query on Web for a clean URL bar
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
            try {
              window.history.replaceState(null, '', window.location.pathname);
            } catch (_) {}
          }
        }
      }
    });

    const handleDeepLink = async (url) => {
      if (!url) return;
      console.log('[App] Deep link received:', url);

      try {
        let accessToken = null;
        let refreshToken = null;

        if (url.includes('#')) {
          const hashParams = new URLSearchParams(url.split('#')[1]);
          accessToken = hashParams.get('access_token');
          refreshToken = hashParams.get('refresh_token');
        }

        if (!accessToken && url.includes('?')) {
          const queryParams = new URLSearchParams(url.split('?')[1]);
          accessToken = queryParams.get('access_token');
          refreshToken = queryParams.get('refresh_token');
        }

        if (accessToken && refreshToken) {
          console.log('[App] Setting session from OAuth deep link tokens');
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('[App] Error setting session from deep link:', error.message);
          } else if (data?.session && isMounted) {
            setSession(data.session);
            if (data.session.user) {
              navigateToRoleScreen(data.session.user, data.session);
            }
          }
        }
        // Check for store QR deep link (e.g. needstracking://store?sellerId=... or web link)
        if (url && (url.includes('sellerId=') || url.includes('seller='))) {
          try {
            const qs = url.includes('?') ? url.split('?')[1] : (url.includes('#') ? url.split('#')[1] : '');
            const qParams = new URLSearchParams(qs);
            const qSellerId = qParams.get('sellerId') || qParams.get('seller');
            const qSellerName = qParams.get('sellerName') || qParams.get('name');
            const isDirectQr = qParams.get('fromMap') !== 'true';
            if (qSellerId) {
              await setPreferredStore(qSellerId, qSellerName || '', isDirectQr);
              navigationRef.current?.navigate('Catalog', {
                sellerId: qSellerId,
                sellerName: qSellerName || '',
                isDirectQr,
              });
            }
          } catch (qrErr) {
            console.warn('[App] Error handling store QR deep link:', qrErr);
          }
        }
      } catch (sessionErr) {
        console.error('[App] Failed to set session from deep link:', sessionErr);
      }
    };

    // Check initial launch URL
    Linking.getInitialURL().then(handleDeepLink).catch(err => console.warn('Linking initial URL error:', err));

    // Listen to incoming deep links
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutTimer);
      authListener?.subscription?.unsubscribe?.();
      linkSubscription?.remove?.();
    };
  }, []);

  const [expoPushToken, setExpoPushToken] = useState('');
  const [notification, setNotification] = useState(false);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    async function requestLocationPermission() {
      try {
        if (Platform.OS !== 'web') {
          console.log('[App] Requesting location permissions on startup...');
          await Location.requestForegroundPermissionsAsync();
        }
      } catch (err) {
        console.warn('Error requesting startup location permission:', err);
      }
    }
    requestLocationPermission();
  }, []);

  useEffect(() => {
    // Register global notification tap navigation (works for web browser notifications & in-app banner)
    setGlobalNotificationClickHandler((data) => {
      console.log('[App] Global notification clicked with data:', data);
      if (data?.orderId) {
        navigationRef.current?.navigate('OrderDetail', { orderId: data.orderId });
      } else if (data?.productId) {
        navigationRef.current?.navigate('ProductDetailScreen', { productId: data.productId });
      }
    });

    // Register notifications across Web and Native
    registerForPushNotificationsAsync()
      .then(token => {
        if (token && typeof token === 'string' && (token.startsWith('ExponentPushToken') || token.startsWith('web:') || token.startsWith('{'))) {
          setExpoPushToken(token);
        }
      })
      .catch(err => {
        console.warn('Push notification initialization error:', err);
      });

    // PWA: Listen for 'beforeinstallprompt' event
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleBeforeInstall = (e) => {
        e.preventDefault();
        window.deferredPrompt = e;
        console.log('[PWA] App install prompt captured');
      };
      window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    }

    if (Platform.OS !== 'web') {
      try {
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
          setNotification(notification);
        });

        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
          const data = response.notification.request.content.data;
          console.log("Notification tapped with data: ", data);

          // Navigate based on the data received
          if (data?.orderId) {
            navigationRef.current?.navigate('OrderDetail', { orderId: data.orderId });
          } else if (data?.productId) {
            navigationRef.current?.navigate('ProductDetailScreen', { productId: data.productId });
          }
        });
      } catch (notifErr) {
        console.warn('Notification listener error:', notifErr);
      }
    }

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  // This effect runs whenever the push token or session changes
  useEffect(() => {
    const savePushToken = async () => {
      if (expoPushToken && session?.user?.id) {
        try {
          console.log(`Saving push token for user ${session.user.id}:`, expoPushToken);

          // Check if token already exists
          const { data: existingToken, error: fetchErr } = await supabase
            .from('push_tokens')
            .select('id, user_id')
            .eq('token', expoPushToken)
            .maybeSingle();

          if (!fetchErr && existingToken) {
            if (existingToken.user_id === session.user.id) {
              console.log('Push token is already registered for this user.');
              return;
            }
            // If registered to a different user, attempt update
            const { error: updateErr } = await supabase
              .from('push_tokens')
              .update({ user_id: session.user.id })
              .eq('token', expoPushToken);

            if (!updateErr) {
              console.log('Push token re-assigned to current user.');
              return;
            }
          }

          // Otherwise insert new push token
          const { error: insertErr } = await supabase
            .from('push_tokens')
            .insert({ 
              user_id: session.user.id, 
              token: expoPushToken 
            });

          if (insertErr) {
            console.warn('Note: Push token save notice (non-fatal):', insertErr.message);
          } else {
            console.log('Push token saved successfully.');
          }
        } catch (saveErr) {
          console.warn('Non-fatal error in savePushToken:', saveErr);
        }
      }
    };

    savePushToken();
  }, [expoPushToken, session]);

  // Web & In-App Realtime Order Voice & Message Notification listener
  useEffect(() => {
    if (!session?.user?.id) return;

    const channelName = `app_realtime_orders:${session.user.id}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          console.log('[App] Realtime order INSERT received:', payload.new);
          const order = payload.new;
          if (!order) return;

          const rawId = order.id || '';
          const orderNum = order.order_number || (rawId ? String(rawId).substring(0, 8).toUpperCase() : '');
          const amountStr = order.total_amount !== undefined ? ` (₹${order.total_amount})` : '';

          let title = '🎉 New Order Received!';
          let body = `Order #${orderNum}${amountStr} has been placed.`;

          if (order.user_id === session.user.id) {
            title = '🎉 Order Placed Successfully!';
            body = `Your order #${orderNum}${amountStr} is confirmed.`;
          } else if (order.order_type !== 'shop-order') {
            title = '🛵 New Delivery Order!';
            body = `Order #${orderNum}${amountStr} is ready for delivery.`;
          }

          // Trigger In-App message banner + browser notification + chime
          schedulePushNotification(title, body, { orderId: order.id, type: 'new_order' });

          // Also announce via Voice TTS
          try {
            announceNewOrder(order);
          } catch (e) {
            console.warn('[App] Realtime voice announcement error:', e);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          console.log('[App] Realtime order UPDATE received:', payload);
          const oldOrder = payload.old || {};
          const newOrder = payload.new || {};
          if (!newOrder.id) return;

          const orderNum = newOrder.order_number || String(newOrder.id).substring(0, 8).toUpperCase();

          // 1. Delivery Partner Assigned
          if (newOrder.delivery_manager_id && oldOrder.delivery_manager_id !== newOrder.delivery_manager_id) {
            const isAssignedToMe = newOrder.delivery_manager_id === session.user.id;
            const title = isAssignedToMe ? '🛵 Delivery Task Assigned!' : '🛵 Delivery Partner Assigned!';
            const body = isAssignedToMe
              ? `Order #${orderNum} has been assigned to you for delivery.`
              : `A delivery partner has accepted Order #${orderNum} and is on the way.`;

            schedulePushNotification(title, body, { orderId: newOrder.id, type: 'delivery_assigned' });
          }
          // 2. Order Status Changed
          else if (oldOrder.status && newOrder.status && oldOrder.status !== newOrder.status) {
            let title = '📦 Order Status Updated';
            let body = `Order #${orderNum} status changed to ${newOrder.status}.`;

            const st = (newOrder.status || '').toLowerCase();
            if (st.includes('out for delivery') || st.includes('out_for_delivery')) {
              title = '🚚 Out for Delivery!';
              body = `Order #${orderNum} is on the way. Track live on the map!`;
            } else if (st.includes('completed') || st.includes('delivered')) {
              title = '✅ Order Delivered!';
              body = `Order #${orderNum} has been delivered successfully.`;
            } else if (st.includes('cancel')) {
              title = '❌ Order Cancelled';
              body = `Order #${orderNum} has been cancelled.`;
            } else if (st.includes('processing')) {
              title = '🍳 Order In Preparation';
              body = `Order #${orderNum} is now being prepared.`;
            }

            schedulePushNotification(title, body, { orderId: newOrder.id, type: 'status_update' });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const { isDark, colors } = useTheme();

  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [isDark, colors]);

  const handleNavReady = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
        if (searchStr) {
          const urlParams = new URLSearchParams(searchStr);
          const qSellerId = urlParams.get('sellerId') || urlParams.get('seller');
          const qSellerName = urlParams.get('sellerName') || urlParams.get('name');
          const fromMap = urlParams.get('fromMap') === 'true';
          const isDirectQr = !fromMap && (urlParams.get('directQr') === 'true' || urlParams.get('qr') === '1' || !!qSellerId);
          if (qSellerId) {
            await setPreferredStore(qSellerId, qSellerName || '', isDirectQr);
            navigationRef.current?.navigate('Catalog', {
              sellerId: qSellerId,
              sellerName: qSellerName || '',
              isDirectQr: isDirectQr,
            });
          }
        }
      } catch (err) {
        console.warn('[App] Error parsing web store URL params on ready:', err);
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.primary }]}>Loading...</Text>
      </View>
    );
  }

  return (
    <CartProvider>
      <View style={[styles.rootContainer, { backgroundColor: colors.background }]}>
        <NavigationContainer ref={navigationRef} theme={navTheme} onReady={handleNavReady}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack.Navigator initialRouteName="SellersMap" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="SellersMap" component={SellersMapScreen} />
            <Stack.Screen name="Welcome" component={WelcomeScreen} initialParams={{ session }} />
            <Stack.Screen name="Catalog" component={CatalogScreen} />
            <Stack.Screen name="BuyerAuth" component={BuyerAuthScreen} />
            <Stack.Screen name="BuyerLogin" component={BuyerLoginScreen} />
            <Stack.Screen name="BuyerSignup" component={BuyerSignupScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="Checkout" component={CheckoutScreen} />
            <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
            <Stack.Screen name="UpiQr" component={UpiQrScreen} />
            <Stack.Screen name="OrderList" component={OrderListScreen} />
            <Stack.Screen name="TopProducts" component={TopProductsScreen} />
            <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
            <Stack.Screen name="OrderEdit" component={OrderEditScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
            <Stack.Screen name="SellerLogin" component={SellerLoginScreen} />
            <Stack.Screen name="ProductMapScreen" component={ProductMapScreen} />
            <Stack.Screen name="DeliveryManagerLogin" component={DeliveryManagerLoginScreen} />
            <Stack.Screen name="DeliveryManagerDashboard" component={DeliveryManagerDashboard} />
            <Stack.Screen name="DeliveryManagerSignup" component={DeliveryManagerSignupScreen} />
            <Stack.Screen name="AdminMap" component={AdminMapScreen} />
            <Stack.Screen name="CustomerDamage" component={CustomerDamageScreen} />
            <Stack.Screen name="DamageScreen" component={CustomerDamageScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="CatalogManagement" component={CatalogManagementScreen} />
            <Stack.Screen name="CategoryManagement" component={CatalogManagementScreen} />
            <Stack.Screen name="ProductDetailScreen" component={ProductDetailScreen} />
            <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
            {/* ProductTabNavigator will handle Product, Inventory, Profile, Invoice screens */}
            <Stack.Screen name="ProductTabs" component={ProductTabNavigator} initialParams={{ session }} />
            {console.log('App.js: Session passed to ProductTabs:', session)}
          </Stack.Navigator>
        </NavigationContainer>
        <NotificationBanner navigationRef={navigationRef} />
      </View>
    </CartProvider>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorSubtitle}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleReload}>
            <Text style={styles.retryButtonText}>Reload App</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    position: 'relative',
    height: '100%',
    width: '100%',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    fontSize: 18,
    color: '#007AFF',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});

