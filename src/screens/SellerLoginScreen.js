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
import { supabase, signInWithGoogle, getAuthRedirectUrl, isUserAdminOrSuperadmin } from '../services/supabase';
import { resolveEmployeeSession } from '../services/employeeService';
import { StackActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Constants from 'expo-constants';
import { ActivityIndicator } from 'react-native';
import PreLoginMarqueeFooter from '../components/PreLoginMarqueeFooter';

export default function SellerLoginScreen({ navigation, route }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const onAuthSuccess = route.params?.onAuthSuccess;

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem('pending_auth_role', 'seller');
      }
      const res = await signInWithGoogle('seller');
      if (res.success && res.user) {
        // 1. Check if user is a registered staff member/employee
        const employee = await resolveEmployeeSession(res.user);
        if (employee) {
          if (onAuthSuccess) {
            try { onAuthSuccess(res.user); } catch (_) {}
          }
          navigation.dispatch(
            StackActions.replace('ProductTabs', {
              session: res.session,
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

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('id', res.user.id)
          .maybeSingle();

        const isExistingAdmin = isUserAdminOrSuperadmin(existingProfile, res.user);

        if (!existingProfile) {
          await supabase
            .from('profiles')
            .upsert({
              id: res.user.id,
              role: 'seller',
              full_name: res.user.user_metadata?.full_name || res.user.user_metadata?.name || 'Seller',
              email: res.user.email,
              updated_at: new Date().toISOString(),
            });

          try {
            await supabase.auth.updateUser({ data: { role: 'seller' } });
          } catch (_) {}
        } else if (!isExistingAdmin && existingProfile.role !== 'seller') {
          await supabase
            .from('profiles')
            .update({
              role: 'seller',
              updated_at: new Date().toISOString(),
            })
            .eq('id', res.user.id);

          try {
            await supabase.auth.updateUser({ data: { role: 'seller' } });
          } catch (_) {}
        }

        // Always ensure users table is kept in sync
        try {
          await supabase.from('users').upsert({
            id: res.user.id,
            email: res.user.email || '',
            name: res.user.user_metadata?.full_name || res.user.user_metadata?.name || existingProfile?.full_name || 'Seller',
            user_type: isExistingAdmin ? existingProfile.role : 'seller',
            updated_at: new Date().toISOString(),
          });
        } catch (_) {}

        if (onAuthSuccess) {
          onAuthSuccess(res.user);
        }

        navigation.dispatch(StackActions.replace('ProductTabs', { session: res.session, user: res.user }));
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        Alert.alert('Login Error', error.message);
      } else {
        console.log('Login successful:', data.user);

        // 1. Check if user is a registered staff member/employee
        const employee = await resolveEmployeeSession(data.user);
        if (employee) {
          if (onAuthSuccess) {
            try { onAuthSuccess(data.user); } catch (_) {}
          }
          navigation.dispatch(
            StackActions.replace('ProductTabs', {
              session: data.session,
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

        let { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, role, full_name, mobile')
          .eq('id', data.user.id)
          .maybeSingle();

        if (profileError) {
          console.error("Error checking seller profile:", profileError.message);
        }

        const isExistingAdmin = isUserAdminOrSuperadmin(profileData, data.user);

        if (!profileData) {
          try {
            const { data: newProfile } = await supabase
              .from('profiles')
              .upsert({
                id: data.user.id,
                full_name: data.user.user_metadata?.full_name || 'Seller',
                role: 'seller',
                email: data.user.email,
                updated_at: new Date().toISOString(),
              })
              .select()
              .maybeSingle();
            profileData = newProfile;
            await supabase.auth.updateUser({ data: { role: 'seller' } });
          } catch (upsertErr) {
            console.error("Error upserting profile:", upsertErr);
          }
        } else if (!isExistingAdmin && profileData.role !== 'seller') {
          try {
            const { data: updatedProfile } = await supabase
              .from('profiles')
              .update({
                role: 'seller',
                updated_at: new Date().toISOString(),
              })
              .eq('id', data.user.id)
              .select()
              .maybeSingle();
            if (updatedProfile) profileData = updatedProfile;
            await supabase.auth.updateUser({ data: { role: 'seller' } });
          } catch (updateErr) {
            console.error("Error updating seller profile role:", updateErr);
          }
        }

        // Always ensure users table is kept in sync
        try {
          await supabase.from('users').upsert({
            id: data.user.id,
            email: data.user.email || '',
            name: profileData?.full_name || data.user.user_metadata?.full_name || 'Seller',
            user_type: isExistingAdmin ? profileData.role : 'seller',
            updated_at: new Date().toISOString(),
          });
        } catch (_) {}

        if (onAuthSuccess) {
          onAuthSuccess(data.user);
        }

        navigation.dispatch(StackActions.replace('ProductTabs', { session: data.session, user: data.user }));
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
          <Text style={styles.icon}>📦</Text>
          <Text style={styles.title}>Seller Login</Text>
          <Text style={styles.subtitle}>Sign in to manage your inventory</Text>
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
            <Text style={styles.signupText}>Don't have a seller account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup', { role: 'seller' })}>
              <Text style={styles.signupLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.signupContainer, { marginTop: 14 }]}>
            <Text style={styles.signupText}>Are you store staff or cashier? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('StaffLogin')}>
              <Text style={[styles.signupLink, { color: '#10B981', fontWeight: '700' }]}>Staff Login</Text>
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
});
