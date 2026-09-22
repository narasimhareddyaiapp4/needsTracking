import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const ACTIVE_EMPLOYEE_KEY = 'active_seller_employee';

/**
 * Fetch all employees belonging to a specific store/seller
 * @param {string} sellerId
 * @returns {Promise<Array>}
 */
export async function getSellerEmployees(sellerId) {
  if (!sellerId) return [];
  try {
    const { data, error } = await supabase
      .from('seller_employees')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[employeeService] getSellerEmployees error:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[employeeService] getSellerEmployees exception:', err);
    return [];
  }
}

/**
 * Add a new employee under a seller
 * @param {string} sellerId
 * @param {Object} employeeData
 */
export async function addSellerEmployee(sellerId, employeeData) {
  if (!sellerId) throw new Error('Seller ID is required');
  if (!employeeData.name) throw new Error('Employee name is required');

  const defaultPermissions = {
    can_pos_bill: true,
    can_manage_orders: true,
    can_manage_inventory: false,
    can_manage_products: false,
    can_view_reports: false,
  };

  const payload = {
    seller_id: sellerId,
    name: employeeData.name.trim(),
    email: employeeData.email ? employeeData.email.trim().toLowerCase() : null,
    mobile: employeeData.mobile ? employeeData.mobile.trim() : null,
    designation: employeeData.designation || 'cashier',
    pin_code: employeeData.pin_code ? employeeData.pin_code.trim() : null,
    permissions: employeeData.permissions || defaultPermissions,
    is_active: employeeData.is_active !== false,
  };

  const { data, error } = await supabase
    .from('seller_employees')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('[employeeService] addSellerEmployee error:', error);
    throw error;
  }
  return data;
}

/**
 * Update an existing employee
 * @param {string} employeeId
 * @param {Object} updates
 */
export async function updateSellerEmployee(employeeId, updates) {
  if (!employeeId) throw new Error('Employee ID is required');

  const cleanUpdates = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.trim().toLowerCase();
  if (cleanUpdates.name) cleanUpdates.name = cleanUpdates.name.trim();

  const { data, error } = await supabase
    .from('seller_employees')
    .update(cleanUpdates)
    .eq('id', employeeId)
    .select()
    .single();

  if (error) {
    console.error('[employeeService] updateSellerEmployee error:', error);
    throw error;
  }
  return data;
}

/**
 * Delete an employee
 * @param {string} employeeId
 */
export async function deleteSellerEmployee(employeeId) {
  if (!employeeId) return false;
  const { error } = await supabase
    .from('seller_employees')
    .delete()
    .eq('id', employeeId);

  if (error) {
    console.error('[employeeService] deleteSellerEmployee error:', error);
    throw error;
  }
  return true;
}

/**
 * Resolve whether the currently logged-in user is a seller employee.
 * Checks by user_id first, then email or mobile fallback to auto-link.
 * @param {Object} user - Supabase auth user object
 * @returns {Promise<Object|null>}
 */
export async function resolveEmployeeSession(user) {
  if (!user) return null;

  try {
    // 1. Direct lookup by user_id
    let { data: emp, error } = await supabase
      .from('seller_employees')
      .select('*, profiles!seller_id(id, full_name, mobile, address_line_1, upi_id)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    // 2. If not found by user_id, try matching by email
    if (!emp && user.email) {
      const { data: matchedEmp } = await supabase
        .from('seller_employees')
        .select('*, profiles!seller_id(id, full_name, mobile, address_line_1, upi_id)')
        .eq('email', user.email.trim().toLowerCase())
        .eq('is_active', true)
        .maybeSingle();

      if (matchedEmp) {
        emp = matchedEmp;
        // Auto-link the user_id for future quick lookups
        await supabase
          .from('seller_employees')
          .update({ user_id: user.id, updated_at: new Date().toISOString() })
          .eq('id', matchedEmp.id);
      }
    }

    if (emp) {
      // Store in local storage for fast session access
      await setActiveEmployeeSession(emp);
      return emp;
    }

    return null;
  } catch (err) {
    console.warn('[employeeService] resolveEmployeeSession notice:', err);
    return null;
  }
}

/**
 * Quick Counter PIN login / verification for POS register
 * @param {string} sellerId
 * @param {string} pin
 * @returns {Promise<Object|null>}
 */
export async function verifyCashierPin(sellerId, pin) {
  if (!sellerId || !pin) return null;

  try {
    const { data, error } = await supabase
      .from('seller_employees')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('pin_code', pin.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    await setActiveEmployeeSession(data);
    return data;
  } catch (err) {
    console.warn('[employeeService] verifyCashierPin error:', err);
    return null;
  }
}

/**
 * Persist active employee context in AsyncStorage/localStorage
 * @param {Object} employee
 */
export async function setActiveEmployeeSession(employee) {
  try {
    const json = JSON.stringify(employee);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_EMPLOYEE_KEY, json);
    }
    await AsyncStorage.setItem(ACTIVE_EMPLOYEE_KEY, json);
  } catch (_) {}
}

/**
 * Retrieve active employee context
 * @returns {Promise<Object|null>}
 */
export async function getActiveEmployeeSession() {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const webVal = localStorage.getItem(ACTIVE_EMPLOYEE_KEY);
      if (webVal) return JSON.parse(webVal);
    }
    const val = await AsyncStorage.getItem(ACTIVE_EMPLOYEE_KEY);
    return val ? JSON.parse(val) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Clear employee session (on logout or cashier switch)
 */
export async function clearActiveEmployeeSession() {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(ACTIVE_EMPLOYEE_KEY);
    }
    await AsyncStorage.removeItem(ACTIVE_EMPLOYEE_KEY);
  } catch (_) {}
}
