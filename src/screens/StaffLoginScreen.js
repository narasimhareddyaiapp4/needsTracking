import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { supabase, signInWithGoogle } from '../services/supabase';
import { resolveEmployeeSession } from '../services/employeeService';
import { StackActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useTheme } from '../context/ThemeContext';
import PreLoginMarqueeFooter from '../components/PreLoginMarqueeFooter';

export default function StaffLoginScreen({ navigation, route }) {
  const { colors } = useTheme();
  const [emailOrMobile, setEmailOrMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleStaffLogin = async () => {
    if (!emailOrMobile.trim() || !password) {
      Alert.alert('Required', 'Please enter your staff email/mobile and password');
      return;
    }

    setLoading(true);
    try {
      let loginEmail = emailOrMobile.trim().toLowerCase();

      // If entered a phone number instead of email, check if there is an employee email associated
      if (!loginEmail.includes('@')) {
        const { data: empRecord } = await supabase
          .from('seller_employees')
          .select('email')
          .eq('mobile', emailOrMobile.trim())
          .eq('is_active', true)
          .maybeSingle();

        if (empRecord && empRecord.email) {
          loginEmail = empRecord.email;
        } else {
          Alert.alert('Staff Login', 'Could not locate an active staff account with this mobile number. Please check with your store owner.');
          setLoading(false);
          return;
        }
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        Alert.alert('Login Failed', error.message);
        setLoading(false);
        return;
      }

      // Check if user is linked to seller_employees
      const employee = await resolveEmployeeSession(data.user);
      if (!employee) {
        Alert.alert(
          'Not Registered as Staff',
          'Your account is not linked to any active store staff. Please ask your store owner to add your email to their staff list.'
        );
        setLoading(false);
        return;
      }

      // Successful staff login!
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
    } catch (err) {
      Alert.alert('Error', err.message || 'Staff login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleStaffLogin = async () => {
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem('pending_auth_role', 'seller_employee');
      }
      const res = await signInWithGoogle('seller_employee');
      if (res.success && res.user) {
        const employee = await resolveEmployeeSession(res.user);
        if (!employee) {
          Alert.alert(
            'Not Registered as Staff',
            'Your Google account is not added as a staff member for any store. Please ask your store owner to add your Google email to their staff list.'
          );
          setGoogleLoading(false);
          return;
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
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>

        <View style={styles.cardWrapper}>
          <View style={styles.logoBadge}>
            <Icon name="id-badge" size={32} color="#007AFF" />
          </View>

          <Text style={styles.title}>Store Staff Login</Text>
          <Text style={styles.subtitle}>
            Sign in as Cashier, Order Handler, or Store Staff
          </Text>

          {/* Form */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Staff Email or Mobile Number</Text>
            <View style={styles.inputBox}>
              <Icon name="user-o" size={15} color="#94A3B8" style={{ marginRight: 10 }} />
              <TextInput
                style={styles.textInput}
                placeholder="staff@store.com or 9876543210"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                value={emailOrMobile}
                onChangeText={setEmailOrMobile}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputBox}>
              <Icon name="lock" size={16} color="#94A3B8" style={{ marginRight: 10 }} />
              <TextInput
                style={styles.textInput}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleStaffLogin}
            disabled={loading || googleLoading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In to Store</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Sign-in */}
          <TouchableOpacity
            style={styles.googleBtn}
            onPress={handleGoogleStaffLogin}
            disabled={loading || googleLoading}
            activeOpacity={0.8}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="google" size={16} color="#EA4335" style={{ marginRight: 8 }} />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Icon name="info-circle" size={14} color="#0284C7" style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoText}>
              Your store owner must first add your email or mobile in their Seller App under "Store Staff & Employees".
            </Text>
          </View>

          {/* Switch to Seller Login */}
          <TouchableOpacity
            style={styles.sellerSwitchBtn}
            onPress={() => navigation.navigate('SellerLogin')}
          >
            <Text style={styles.sellerSwitchText}>
              Are you the Store Owner? <Text style={{ color: '#007AFF', fontWeight: '700' }}>Seller Login</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <PreLoginMarqueeFooter navigation={navigation} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  backBtn: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 24,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
  },
  textInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
  },
  primaryBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#007AFF',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  googleBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  googleBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    padding: 10,
    marginTop: 18,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: '#0369A1',
    lineHeight: 16,
  },
  sellerSwitchBtn: {
    marginTop: 18,
    alignItems: 'center',
  },
  sellerSwitchText: {
    fontSize: 13,
    color: '#64748B',
  },
});
