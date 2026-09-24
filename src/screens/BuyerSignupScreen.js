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

export default function BuyerSignupScreen({ navigation, route }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  const navigateAfterAuth = (user) => {
    if (onAuthSuccess) {
      try {
        onAuthSuccess(user);
      } catch (e) {
        console.warn('onAuthSuccess error:', e);
      }
    }
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

  const handleSignup = async () => {
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      showAlert('Error', 'Please fill in all required fields');
      return;
    }

    if (password !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      showAlert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const signupOptions = {
        emailRedirectTo: getAuthRedirectUrl(),
        data: {
          full_name: name.trim(),
          name: name.trim(),
          role: 'customer',
        }
      };
      if (mobile && mobile.trim()) {
        signupOptions.data.mobile = mobile.trim();
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: signupOptions,
      });

      if (error) {
        showAlert('Signup Error', error.message);
      } else {
        if (data?.user) {
          const profileData = {
            id: data.user.id,
            full_name: name.trim(),
            email: email.trim(),
            role: 'customer',
            updated_at: new Date().toISOString(),
          };
          if (mobile && mobile.trim()) {
            profileData.mobile = mobile.trim();
          }

          try {
            await supabase.from('profiles').upsert(profileData);
          } catch (pErr) {
            console.error('Error creating profile on buyer signup:', pErr);
          }
          await mergeGuestCart(data.user.id);
        }

        if (data?.session) {
          if (onAuthSuccess) {
            try { onAuthSuccess(data.user); } catch (e) {}
          }
          showAlert(
            'Success',
            'Account created successfully!',
            [{ text: 'Start Shopping', onPress: () => navigateAfterAuth(data.user) }]
          );
        } else {
          showAlert(
            'Account Created',
            'Your account has been created! Please log in to continue.',
            [{ text: 'OK', onPress: () => navigation.navigate('BuyerLogin', { redirectTo, redirectParams }) }]
          );
        }
      }
    } catch (error) {
      showAlert('Error', 'An unexpected error occurred during signup');
      console.error('Signup error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
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
      showAlert('Error', err.message || 'Google sign-up failed');
    } finally {
      setGoogleLoading(false);
    }
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
          <Text style={styles.title}>Buyer Sign Up</Text>
          <Text style={styles.subtitle}>Create an account to order from local shops</Text>
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
            <Text style={styles.label}>Full Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email Address *</Text>
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
            <Text style={styles.label}>Mobile Number (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. +91 9876543210"
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="At least 6 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={loading || googleLoading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </Text>
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
            onPress={handleGoogleSignup}
            disabled={loading || googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#4285F4" />
            ) : (
              <View style={styles.googleButtonContent}>
                <FontAwesome name="google" size={20} color="#EA4335" style={{ marginRight: 10 }} />
                <Text style={styles.googleButtonText}>Sign up with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.loginContainer}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('BuyerLogin', { redirectTo, redirectParams })}>
              <Text style={styles.loginLink}>Sign In</Text>
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
    marginBottom: 28,
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
    marginBottom: 16,
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
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 26,
  },
  loginText: {
    fontSize: 15,
    color: '#64748b',
  },
  loginLink: {
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

