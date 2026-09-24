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
} from 'react-native';
import { supabase, signInWithGoogle, getAuthRedirectUrl } from '../services/supabase';
import { getPreferredStore } from '../services/localStorageService';
import { resolveEmployeeSession } from '../services/employeeService';
import { StackActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { ActivityIndicator } from 'react-native';

export default function LoginScreen({ navigation, route }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [preferredStore, setPreferredStoreState] = useState(null);
  const onAuthSuccess = route.params?.onAuthSuccess;

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

  const navigateAfterAuth = async (user, session) => {
    if (onAuthSuccess) {
      try { onAuthSuccess(user); } catch (e) {}
    }

    // Check if user is a registered staff member/employee
    try {
      const employee = await resolveEmployeeSession(user);
      if (employee) {
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

    const targetSellerId = preferredStore?.sellerId || route.params?.sellerId;
    const targetSellerName = preferredStore?.sellerName || route.params?.sellerName;
    if (targetSellerId) {
      navigation.navigate('Catalog', { sellerId: targetSellerId, sellerName: targetSellerName });
    } else {
      navigation.dispatch(StackActions.replace('ProductTabs', { session, user }));
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle('customer');
      if (res.success && res.user) {
        navigateAfterAuth(res.user, res.session);
      } else if (res.error) {
        Alert.alert('Google Sign-In Failed', res.error);
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      // Authenticate with Supabase auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert('Login Error', error.message);
      } else {
        console.log('Login successful:', data.user);
        navigateAfterAuth(data.user, data.session);
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
      console.error('Login error:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleForgotPassword = () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email first');
      return;
    }

    supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getAuthRedirectUrl(),
    }).then(() => {
      Alert.alert('Success', 'Password reset email sent. Please check your inbox.');
    }).catch((error) => {
      Alert.alert('Error', error.message);
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
          <Text style={styles.icon}>📍</Text>
          <Text style={styles.title}>{Constants?.expoConfig?.extra?.ORG_NAME || process.env.EXPO_PUBLIC_ORG_NAME || 'NeedsTracker'}</Text>
          <Text style={styles.subtitle}>Sign in to track your location & orders</Text>
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
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.forgotPassword}
            onPress={handleForgotPassword}
          >
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.signupLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2025 {Constants?.expoConfig?.extra?.ORG_NAME || process.env.EXPO_PUBLIC_ORG_NAME || 'NeedsTracking'}. Version 1.0</Text>
      </View>
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
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#F2F2F7',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  forgotPassword: {
    alignItems: 'center',
    marginTop: 16,
  },
  forgotPasswordText: {
    color: '#007AFF',
    fontSize: 16,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 15,
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
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '600',
  },
  signupContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 30,
  },
  signupText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  signupLink: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
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