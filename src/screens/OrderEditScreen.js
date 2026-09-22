import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getOrderById, updateOrderStatus, updateOrderPaymentStatus } from '../services/supabase';
import { extractOrderNumbers } from '../services/printerService';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import { useCart } from '../context/CartContext';

const OrderEditScreen = ({ route, navigation }) => {
  const { orderId, sellerId: paramSellerId, sellerName: paramSellerName, customerId: paramCustomerId } = route?.params || {};
  const { role } = useCart();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [isSaving, setIsSaving] = useState(false);

  const canManage = role === 'seller' || role === 'admin' || role === 'superadmin' || role === 'delivery_manager';

  const resolvedSellerId =
    paramSellerId ||
    order?.seller_id ||
    order?.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
    null;
  const resolvedSellerName = paramSellerName || order?.seller_name || null;
  const resolvedCustomerId = paramCustomerId || order?.customer_id || null;

  useEffect(() => {
    if (role === 'buyer') {
      Alert.alert('Access Denied', 'Buyers are not permitted to edit orders.');
      navigation.goBack();
    }
  }, [role, navigation]);

  useEffect(() => {
    const fetchOrderDetails = async () => {
      setLoading(true);
      const fetchedOrder = await getOrderById(orderId);
      if (fetchedOrder) {
        setOrder(fetchedOrder);
        setStatus(fetchedOrder.status);
        const curPayStatus = fetchedOrder.payment_status ||
          (fetchedOrder.shipping_address && typeof fetchedOrder.shipping_address === 'object' && fetchedOrder.shipping_address.payment_status) ||
          (fetchedOrder.status === 'completed' || fetchedOrder.status === 'paid' ? 'paid' : 'pending');
        setPaymentStatus(curPayStatus);
      }
      setLoading(false);
    };

    if (orderId) {
      fetchOrderDetails();
    } else {
      setLoading(false);
    }
  }, [orderId]);

  const handleSave = async () => {
    if (!canManage) {
      Alert.alert('Access Denied', 'Buyers are not permitted to edit orders.');
      return;
    }
    setIsSaving(true);
    let targetStatus = status;
    if (paymentStatus === 'paid' && (targetStatus || '').toLowerCase() === 'pending_payment') {
      targetStatus = 'processing';
    }
    const updatedOrder = await updateOrderStatus(orderId, targetStatus);
    await updateOrderPaymentStatus(orderId, paymentStatus);
    if (updatedOrder) {
      Alert.alert('Success', 'Order and payment status updated successfully!');
      navigation.goBack();
    } else {
      Alert.alert('Error', 'Failed to update order.');
    }
    setIsSaving(false);
  };

  if (loading && !order) {
    return (
      <View
        style={[
          styles.mainContainer,
          Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backHeaderBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={16} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Order</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={[styles.loadingText, { marginTop: 12 }]}>Loading order...</Text>
        </View>
        <StoreNavigationFooter
          activeTab="orders"
          navigation={navigation}
          route={route}
          sellerId={resolvedSellerId}
          sellerName={resolvedSellerName}
          customerId={resolvedCustomerId}
          forceShow={true}
        />
      </View>
    );
  }

  if (!order) {
    return (
      <View
        style={[
          styles.mainContainer,
          Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backHeaderBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={16} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Order</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Order not found.</Text>
        </View>
        <StoreNavigationFooter
          activeTab="orders"
          navigation={navigation}
          route={route}
          sellerId={resolvedSellerId}
          sellerName={resolvedSellerName}
          customerId={resolvedCustomerId}
          forceShow={true}
        />
      </View>
    );
  }

  const { orderNumber, dayOrderNo, paymentReference } = extractOrderNumbers(order);

  return (
    <View
      style={[
        styles.mainContainer,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHeaderBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color="#0F172A" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Edit Order #{orderNumber}</Text>
          {dayOrderNo ? (
            <Text style={styles.headerSubTitle}>Day Order No: #{dayOrderNo}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close">
          <Icon name="close" size={20} color="#64748B" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={[
          styles.container,
          Platform.OS === 'web' ? { flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : null,
        ]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 150 }]}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
      >
        <View style={styles.card}>
          <Text style={styles.label}>Order Number</Text>
          <TextInput
            style={[styles.input, styles.inputDisabled]}
            value={`#${orderNumber}`}
            editable={false}
          />

          {dayOrderNo ? (
            <>
              <Text style={styles.label}>Day Order Number</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={`#${dayOrderNo}`}
                editable={false}
              />
            </>
          ) : null}

          {paymentReference ? (
            <>
              <Text style={styles.label}>6-Digit Payment Code (Reconciliation)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  style={[styles.input, styles.inputDisabled, { flex: 1, color: '#4F46E5', fontWeight: 'bold' }]}
                  value={paymentReference}
                  editable={false}
                />
              </View>
            </>
          ) : null}

          <Text style={styles.label}>Total Amount</Text>
          <TextInput
            style={[styles.input, styles.inputDisabled]}
            value={`₹${Number(order.total_amount || 0).toFixed(2)}`}
            editable={false}
          />

          <Text style={styles.label}>Fulfillment Status</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={status}
              onValueChange={(itemValue) => setStatus(itemValue)}
              style={styles.picker}
            >
              <Picker.Item label="Payment Pending" value="pending_payment" />
              <Picker.Item label="Pending" value="pending" />
              <Picker.Item label="Processing" value="processing" />
              <Picker.Item label="Out for Delivery" value="out_for_delivery" />
              <Picker.Item label="Shipped" value="shipped" />
              <Picker.Item label="Completed" value="completed" />
              <Picker.Item label="Cancelled" value="cancelled" />
            </Picker>
          </View>

          <Text style={styles.label}>Payment Status</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={paymentStatus}
              onValueChange={(itemValue) => setPaymentStatus(itemValue)}
              style={styles.picker}
            >
              <Picker.Item label="Payment Pending (Awaiting confirmation)" value="pending" />
              <Picker.Item label="Payment Done (Verified & Received)" value="paid" />
            </Picker>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.85}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="check" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom Navigation Footer (Store, Cart, Orders) */}
      <StoreNavigationFooter
        activeTab="orders"
        navigation={navigation}
        route={route}
        sellerId={resolvedSellerId}
        sellerName={resolvedSellerName}
        customerId={resolvedCustomerId}
        forceShow={true}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    height: Platform.OS === 'web' ? '100%' : undefined,
    maxHeight: Platform.OS === 'web' ? '100vh' : undefined,
    minHeight: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexShrink: 0,
  },
  backHeaderBtn: {
    padding: 8,
    marginRight: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 2,
  },
  container: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 150,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
  },
  notFoundText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '600',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 14,
  },
  inputDisabled: {
    backgroundColor: '#F1F5F9',
    color: '#64748B',
  },
  pickerContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginBottom: 20,
    overflow: 'hidden',
  },
  picker: {
    height: 48,
    width: '100%',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default OrderEditScreen;