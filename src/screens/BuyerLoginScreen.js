import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { supabase, signInWithGoogle, addToCart, getAuthRedirectUrl } from '../services/supabase';
import { getGuestCart, clearGuestCart, getPreferredStore } from '../services/localStorageService';
import { resolveEmployeeSession } from '../services/employeeService';
import { StackActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Constants from 'expo-constants';
import PreLoginMarqueeFooter from '../components/PreLoginMarqueeFooter';

import { showAlert } from '../utils/alertUtils';

const mergeGuestCart = async (userId) => {
  try {
    const guestCart = await getGuestCart();
    if (guestCart && guestCart.length > 0) {
      for (const item of guestCart) {
        await addToCart(userId, item.product_variant_combination_id || item.id, item.quantity || 1);
      }
      await clearGuestCart();
    }
  } catch (e) {
    console.warn('Error merging guest cart:', e);
  }
};

export default function BuyerLoginScreen({ navigation, route }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [preferredStore, setPreferredStoreState] = useState(null);
  const onAuthSuccess = route.params?.onAuthSuccess;
  const redirectTo = route.params?.redirectTo || route.params?.redirectScreen;
  const redirectParams = route.params?.redirectParams || (route.params?.productId ? { productId: route.params.productId, customerId: route.params.customerId } : undefined);

  React.useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const pref = await getPreferredStore();
        if (isMounted && pref?.sellerId) {
          setPreferredStoreState(pref);
        }
      } catch (_) {}
    })();
    return () => { isMounted = false; };
  }, []);

  const navigateAfterAuth = async (user) => {
    if (onAuthSuccess) {
      try {
        onAuthSuccess(user);
      } catch (e) {
        console.warn('onAuthSuccess error:', e);
      }
    }

    // Check if user is a registered staff member/employee
    try {
      const employee = await resolveEmployeeSession(user);
      if (employee) {
        const { data: { session } = {} } = await supabase.auth.getSession();
        navigation.dispatch(
          StackActions.replace('ProductTabs', {
            session,
            role: 'seller_employee',
            sellerId: employee.seller_id,
            employeeId: employee.id,
            employeeName: employee.name,
            employeeDesignation: employee.designation,
            permissions: employee.permissions,
          })
        );
        return;
      }
    } catch (_) {}

    if (redirectTo) {
      navigation.navigate(redirectTo, redirectParams || {});
    } else if (preferredStore?.sellerId || route.params?.sellerId) {
      navigation.navigate('Catalog', {
        sellerId: preferredStore?.sellerId || route.params?.sellerId,
        sellerName: preferredStore?.sellerName || route.params?.sellerName,
      });
    } else {
      navigation.navigate('Catalog');
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      showAlert('Error', 'Please fill in both email and password');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        showAlert('Login Error', error.message);
      } else if (data?.user) {
        // Ensure profile exists with customer role
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!profile) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.user_metadata?.full_name || 'Buyer',
            role: 'customer',
            updated_at: new Date().toISOString(),
          });
        }

        await mergeGuestCart(data.user.id);
        navigateAfterAuth(data.user);
      }
    } catch (error) {
      showAlert('Error', 'An unexpected error occurred during login');
      console.error('Login error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle('customer');
      if (res.success && res.user) {
        await mergeGuestCart(res.user.id);
        navigateAfterAuth(res.user);
      } else if (res.error) {
        showAlert('Google Sign-In Failed', res.error);
      }
    } catch (err) {
      showAlert('Error', err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      showAlert('Error', 'Please enter your email first');
      return;
    }

    supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getAuthRedirectUrl(),
    }).then(() => {
      showAlert('Success', 'Password reset email sent. Please check your inbox.');
    }).catch((error) => {
      showAlert('Error', error.message);
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity 
        style={styles.closeButton} 
        onPress={() => navigation.goBack()}
      >
        <Icon name="close" size={28} color="#000" />
      </TouchableOpacity>
      
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.icon}>🛍️</Text>
          <Text style={styles.title}>Buyer Sign In</Text>
          <Text style={styles.subtitle}>Sign in to browse shops, order & track items</Text>
          {preferredStore?.sellerId && (
            <View style={styles.storeLoginBanner}>
              <View style={styles.storeLoginIconBox}>
                <FontAwesome name="shopping-bag" size={15} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeLoginSub}>Shopping At Store</Text>
                <Text style={styles.storeLoginTitle} numberOfLines={1}>
                  {preferredStore.sellerName || 'Individual Store'}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading || googleLoading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Signing In...' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
            onPress={handleGoogleLogin}
            disabled={loading || googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#4285F4" />
            ) : (
              <View style={styles.googleButtonContent}>
                <FontAwesome name="google" size={20} color="#EA4335" style={{ marginRight: 10 }} />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.guestButton}
            onPress={() => navigation.navigate('Catalog')}
          >
            <FontAwesome name="shopping-bag" size={16} color="#007AFF" style={{ marginRight: 8 }} />
            <Text style={styles.guestButtonText}>Browse Catalog as Guest</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.forgotPassword}
            onPress={handleForgotPassword}
          >
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('BuyerSignup', { redirectTo, redirectParams })}>
              <Text style={styles.signupLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <PreLoginMarqueeFooter navigation={navigation} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  closeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#f8fafc',
    color: '#1e293b',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '600',
  },
  guestButton: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  guestButtonText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '700',
  },
  forgotPassword: {
    alignItems: 'center',
    marginTop: 16,
  },
  forgotPasswordText: {
    color: '#007AFF',
    fontSize: 15,
  },
  signupContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  signupText: {
    fontSize: 15,
    color: '#64748b',
  },
  signupLink: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    backgroundColor: '#F2F2F7',
  },
  footerText: {
    fontSize: 12,
    color: '#8E8E93',
  },
  storeLoginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    gap: 10,
    width: '100%',
  },
  storeLoginIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeLoginSub: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  storeLoginTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 1,
  },
});

