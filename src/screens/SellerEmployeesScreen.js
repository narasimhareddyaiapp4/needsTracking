import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useTheme } from '../context/ThemeContext';
import { showAlert } from '../utils/alertUtils';
import {
  getSellerEmployees,
  addSellerEmployee,
  updateSellerEmployee,
  deleteSellerEmployee,
} from '../services/employeeService';
import { supabase } from '../services/supabase';

const ROLE_PRESETS = [
  {
    id: 'cashier',
    name: 'Cashier / Counter Staff',
    description: 'Can punch POS bills, take cash/UPI, and print receipts',
    icon: 'calculator',
    color: '#10B981',
    permissions: {
      can_pos_bill: true,
      can_manage_orders: true,
      can_manage_inventory: false,
      can_manage_products: false,
      can_view_reports: false,
    },
  },
  {
    id: 'order_manager',
    name: 'Kitchen / Order Staff',
    description: 'Can view live incoming orders and update preparation status',
    icon: 'cutlery',
    color: '#F59E0B',
    permissions: {
      can_pos_bill: false,
      can_manage_orders: true,
      can_manage_inventory: false,
      can_manage_products: false,
      can_view_reports: false,
    },
  },
  {
    id: 'inventory_manager',
    name: 'Stock / Inventory Manager',
    description: 'Can scan barcodes, adjust stock counts, and record damages',
    icon: 'cubes',
    color: '#06B6D4',
    permissions: {
      can_pos_bill: false,
      can_manage_orders: false,
      can_manage_inventory: true,
      can_manage_products: true,
      can_view_reports: false,
    },
  },
  {
    id: 'store_manager',
    name: 'Store Supervisor / Manager',
    description: 'Full operational access including sales reports and products',
    icon: 'user-secret',
    color: '#8B5CF6',
    permissions: {
      can_pos_bill: true,
      can_manage_orders: true,
      can_manage_inventory: true,
      can_manage_products: true,
      can_view_reports: true,
    },
  },
  {
    id: 'custom',
    name: 'Custom Role',
    description: 'Choose custom individual permissions',
    icon: 'sliders',
    color: '#64748B',
    permissions: {
      can_pos_bill: false,
      can_manage_orders: false,
      can_manage_inventory: false,
      can_manage_products: false,
      can_view_reports: false,
    },
  },
];

export default function SellerEmployeesScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sellerId, setSellerId] = useState(route.params?.sellerId || null);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formMobile, setFormMobile] = useState('');
  const [formDesignation, setFormDesignation] = useState('cashier');
  const [formPin, setFormPin] = useState('');
  const [formPermissions, setFormPermissions] = useState({
    can_pos_bill: true,
    can_manage_orders: true,
    can_manage_inventory: false,
    can_manage_products: false,
    can_view_reports: false,
  });

  // Resolve Seller ID
  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (!sellerId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && isMounted) {
          setSellerId(user.id);
        }
      }
    })();
    return () => { isMounted = false; };
  }, [sellerId]);

  // Load Employees
  const fetchEmployees = useCallback(async () => {
    if (!sellerId) return;
    setLoading(true);
    try {
      const data = await getSellerEmployees(sellerId);
      setEmployees(data || []);
    } catch (err) {
      console.warn('Error fetching employees:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sellerId]);

  useEffect(() => {
    if (sellerId) {
      fetchEmployees();
    }
  }, [sellerId, fetchEmployees]);

  const openAddModal = () => {
    setEditingEmployee(null);
    setFormName('');
    setFormEmail('');
    setFormMobile('');
    setFormDesignation('cashier');
    setFormPin('');
    setFormPermissions({
      can_pos_bill: true,
      can_manage_orders: true,
      can_manage_inventory: false,
      can_manage_products: false,
      can_view_reports: false,
    });
    setModalVisible(true);
  };

  const openEditModal = (emp) => {
    setEditingEmployee(emp);
    setFormName(emp.name || '');
    setFormEmail(emp.email || '');
    setFormMobile(emp.mobile || '');
    setFormDesignation(emp.designation || 'cashier');
    setFormPin(emp.pin_code || '');
    setFormPermissions(emp.permissions || {
      can_pos_bill: true,
      can_manage_orders: true,
      can_manage_inventory: false,
      can_manage_products: false,
      can_view_reports: false,
    });
    setModalVisible(true);
  };

  const handleSelectRolePreset = (preset) => {
    setFormDesignation(preset.id);
    setFormPermissions({ ...preset.permissions });
  };

  const togglePermission = (key) => {
    setFormPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setFormDesignation('custom');
  };

  const handleSaveEmployee = async () => {
    if (!formName.trim()) {
      showAlert('Required', 'Please enter employee name');
      return;
    }
    if (!formEmail.trim() && !formMobile.trim()) {
      showAlert('Contact Required', 'Please enter either an email or mobile number for staff login');
      return;
    }

    let activeSellerId = sellerId;
    if (!activeSellerId) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          activeSellerId = user.id;
          setSellerId(user.id);
        }
      } catch (_) {}
    }

    if (!activeSellerId) {
      showAlert('Error', 'Unable to resolve seller store account ID. Please re-open your profile.');
      return;
    }

    setSaving(true);
    try {
      if (editingEmployee) {
        await updateSellerEmployee(editingEmployee.id, {
          name: formName,
          email: formEmail,
          mobile: formMobile,
          designation: formDesignation,
          pin_code: formPin,
          permissions: formPermissions,
        });
        showAlert('Success', 'Staff member updated successfully');
      } else {
        await addSellerEmployee(activeSellerId, {
          name: formName,
          email: formEmail,
          mobile: formMobile,
          designation: formDesignation,
          pin_code: formPin,
          permissions: formPermissions,
        });
        showAlert('Success', 'New staff member added successfully! They can now log in.');
      }
      setModalVisible(false);
      fetchEmployees();
    } catch (err) {
      showAlert('Error', err.message || 'Failed to save staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (emp) => {
    try {
      const updated = !emp.is_active;
      await updateSellerEmployee(emp.id, { is_active: updated });
      setEmployees((prev) =>
        prev.map((e) => (e.id === emp.id ? { ...e, is_active: updated } : e))
      );
    } catch (err) {
      showAlert('Error', 'Failed to update employee status');
    }
  };

  const handleDelete = (emp) => {
    showAlert(
      'Remove Staff Member',
      `Are you sure you want to remove "${emp.name}" from your store staff?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSellerEmployee(emp.id);
              setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
              showAlert('Success', 'Staff member removed');
            } catch (err) {
              showAlert('Error', 'Failed to delete staff member: ' + (err.message || ''));
            }
          },
        },
      ]
    );
  };

  const renderEmployeeItem = ({ item }) => {
    const preset = ROLE_PRESETS.find((p) => p.id === item.designation) || ROLE_PRESETS[0];

    return (
      <View style={[styles.empCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.empCardHeader}>
          <View style={[styles.roleIconBox, { backgroundColor: (preset.color || '#007AFF') + '20' }]}>
            <Icon name={preset.icon || 'user'} size={18} color={preset.color || '#007AFF'} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.empName, { color: colors.text }]}>{item.name}</Text>
              <Switch
                value={item.is_active}
                onValueChange={() => handleToggleActive(item)}
                trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <View style={[styles.designationBadge, { backgroundColor: (preset.color || '#007AFF') + '15' }]}>
                <Text style={[styles.designationBadgeText, { color: preset.color || '#007AFF' }]}>
                  {preset.name}
                </Text>
              </View>
              {item.pin_code && (
                <View style={styles.pinBadge}>
                  <Icon name="key" size={10} color="#64748B" style={{ marginRight: 3 }} />
                  <Text style={styles.pinBadgeText}>PIN: {item.pin_code}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Contact Info */}
        <View style={styles.empContactRow}>
          {item.email ? (
            <View style={styles.contactItem}>
              <Icon name="envelope-o" size={11} color="#64748B" style={{ marginRight: 4 }} />
              <Text style={styles.contactText}>{item.email}</Text>
            </View>
          ) : null}
          {item.mobile ? (
            <View style={styles.contactItem}>
              <Icon name="phone" size={11} color="#64748B" style={{ marginRight: 4 }} />
              <Text style={styles.contactText}>{item.mobile}</Text>
            </View>
          ) : null}
        </View>

        {/* Permissions Chips */}
        <View style={styles.permissionsRow}>
          {item.permissions?.can_pos_bill && (
            <View style={styles.permChip}><Text style={styles.permChipText}>🛒 POS Billing</Text></View>
          )}
          {item.permissions?.can_manage_orders && (
            <View style={styles.permChip}><Text style={styles.permChipText}>📦 Orders</Text></View>
          )}
          {item.permissions?.can_manage_inventory && (
            <View style={styles.permChip}><Text style={styles.permChipText}>📊 Inventory</Text></View>
          )}
          {item.permissions?.can_manage_products && (
            <View style={styles.permChip}><Text style={styles.permChipText}>🏷️ Products</Text></View>
          )}
          {item.permissions?.can_view_reports && (
            <View style={styles.permChip}><Text style={styles.permChipText}>📈 Reports</Text></View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.empCardFooter}>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => openEditModal(item)}
            activeOpacity={0.7}
          >
            <Icon name="pencil" size={13} color="#007AFF" style={{ marginRight: 5 }} />
            <Text style={styles.editBtnText}>Edit Permissions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            activeOpacity={0.7}
          >
            <Icon name="trash-o" size={14} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={16} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Store Staff & Employees</Text>
          <Text style={styles.headerSubtitle}>Manage cashiers, order handlers & permissions</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={openAddModal}
          activeOpacity={0.8}
        >
          <Icon name="plus" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
          <Text style={styles.addBtnText}>Add Staff</Text>
        </TouchableOpacity>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading store employees...</Text>
        </View>
      ) : employees.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBox}>
            <Icon name="users" size={42} color="#007AFF" />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Staff Added Yet</Text>
          <Text style={styles.emptySubtitle}>
            Add cashiers, order handlers, or store managers to give your team access to POS billing and order handling.
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={openAddModal} activeOpacity={0.85}>
            <Icon name="user-plus" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.emptyAddBtnText}>Add Your First Employee</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={employees}
          keyExtractor={(item) => item.id}
          renderItem={renderEmployeeItem}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchEmployees();
          }}
        />
      )}

      {/* Add / Edit Employee Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {editingEmployee ? 'Edit Staff Member' : 'Add New Staff Member'}
                </Text>
                <Text style={styles.modalSubtitle}>Configure contact & operational access</Text>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Icon name="times" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Name */}
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. Ramesh Kumar"
                placeholderTextColor="#94A3B8"
                value={formName}
                onChangeText={setFormName}
              />

              {/* Email */}
              <Text style={styles.inputLabel}>Email Address (For Staff Sign-In)</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. staff@example.com"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                keyboardType="email-address"
                value={formEmail}
                onChangeText={setFormEmail}
              />

              {/* Mobile */}
              <Text style={styles.inputLabel}>Mobile Number</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. 9876543210"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={formMobile}
                onChangeText={setFormMobile}
              />

              {/* Quick Counter PIN */}
              <Text style={styles.inputLabel}>Quick Counter PIN (4-6 digits for fast POS login)</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. 1234"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
                maxLength={6}
                value={formPin}
                onChangeText={setFormPin}
              />

              {/* Role Presets */}
              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Select Staff Role Preset</Text>
              <View style={styles.presetsContainer}>
                {ROLE_PRESETS.map((preset) => {
                  const isSelected = formDesignation === preset.id;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      style={[
                        styles.presetCard,
                        isSelected && { borderColor: preset.color || '#007AFF', backgroundColor: (preset.color || '#007AFF') + '10' },
                      ]}
                      onPress={() => handleSelectRolePreset(preset)}
                      activeOpacity={0.75}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name={preset.icon} size={14} color={isSelected ? preset.color : '#64748B'} style={{ marginRight: 8 }} />
                        <Text style={[styles.presetCardTitle, isSelected && { color: preset.color, fontWeight: '700' }]}>
                          {preset.name}
                        </Text>
                      </View>
                      <Text style={styles.presetCardDesc}>{preset.description}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Granular Permission Toggles */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>Detailed Access Permissions</Text>
              <View style={styles.permList}>
                <View style={styles.permToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permToggleTitle}>🛒 POS Billing & Checkout</Text>
                    <Text style={styles.permToggleDesc}>Take customer orders at counter, apply UPI/Cash, and print bills</Text>
                  </View>
                  <Switch
                    value={formPermissions.can_pos_bill}
                    onValueChange={() => togglePermission('can_pos_bill')}
                    trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                  />
                </View>

                <View style={styles.permToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permToggleTitle}>📦 Order Management</Text>
                    <Text style={styles.permToggleDesc}>View incoming orders and update statuses (preparing, ready, delivered)</Text>
                  </View>
                  <Switch
                    value={formPermissions.can_manage_orders}
                    onValueChange={() => togglePermission('can_manage_orders')}
                    trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                  />
                </View>

                <View style={styles.permToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permToggleTitle}>📊 Inventory & Damages</Text>
                    <Text style={styles.permToggleDesc}>Adjust stock quantities, scan barcodes, and report damage items</Text>
                  </View>
                  <Switch
                    value={formPermissions.can_manage_inventory}
                    onValueChange={() => togglePermission('can_manage_inventory')}
                    trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                  />
                </View>

                <View style={styles.permToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permToggleTitle}>🏷️ Product Catalog Editing</Text>
                    <Text style={styles.permToggleDesc}>Add or modify products, prices, and variant descriptions</Text>
                  </View>
                  <Switch
                    value={formPermissions.can_manage_products}
                    onValueChange={() => togglePermission('can_manage_products')}
                    trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                  />
                </View>

                <View style={styles.permToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permToggleTitle}>📈 Sales & Revenue Reports</Text>
                    <Text style={styles.permToggleDesc}>View financial analytics, daily revenue, and product rankings</Text>
                  </View>
                  <Switch
                    value={formPermissions.can_view_reports}
                    onValueChange={() => togglePermission('can_view_reports')}
                    trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                  />
                </View>
              </View>
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSaveEmployee}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>{editingEmployee ? 'Save Changes' : 'Create Staff Member'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#64748B',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  empCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  empCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  roleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empName: {
    fontSize: 15,
    fontWeight: '700',
  },
  designationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  designationBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pinBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  empContactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 12,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactText: {
    fontSize: 12,
    color: '#475569',
  },
  permissionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  permChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  permChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#334155',
  },
  empCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  deleteBtn: {
    padding: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  modalBody: {
    maxHeight: 460,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    marginBottom: 12,
  },
  presetsContainer: {
    gap: 8,
    marginBottom: 12,
  },
  presetCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#FFFFFF',
  },
  presetCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  presetCardDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  permList: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  permToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  permToggleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  permToggleDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  saveBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
