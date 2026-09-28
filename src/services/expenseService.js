import { supabase, getSellerOrdersForReport } from './supabase';

export const EXPENSE_CATEGORIES = [
  { id: 'groceries', label: 'Groceries / Raw Materials', icon: 'shopping-basket', color: '#10B981', desc: 'Daily vegetables, milk, meat, spices & procurement' },
  { id: 'parcel_packaging', label: 'Parcel & Packaging', icon: 'dropbox', color: '#F59E0B', desc: 'Delivery boxes, containers, carry bags, tape' },
  { id: 'salary', label: 'Employee Salary', icon: 'users', color: '#6366F1', desc: 'Staff payroll calculated with days worked' },
  { id: 'rent', label: 'Store Rent', icon: 'building', color: '#EC4899', desc: 'Monthly or daily store lease / shop rent' },
  { id: 'utilities', label: 'Utilities (Electricity/Water)', icon: 'bolt', color: '#06B6D4', desc: 'Power, water, Wi-Fi, LPG cylinder' },
  { id: 'delivery_logistics', label: 'Delivery & Fuel', icon: 'motorcycle', color: '#8B5CF6', desc: 'Rider payout, petrol & delivery transport' },
  { id: 'maintenance', label: 'Repairs & Cleaning', icon: 'wrench', color: '#64748B', desc: 'Equipment service, pest control, repairs' },
  { id: 'other', label: 'Miscellaneous / Other', icon: 'tag', color: '#94A3B8', desc: 'General store miscellaneous costs' },
];

/**
 * Calculates prorated salary based on monthly salary and days worked
 * @param {number} monthlySalary 
 * @param {number} daysWorked 
 * @param {number} totalMonthDays - defaults to 30
 * @returns {number}
 */
export function calculateEmployeeSalary(monthlySalary, daysWorked, totalMonthDays = 30) {
  const salary = Number(monthlySalary) || 0;
  const days = Number(daysWorked) || 0;
  const baseDays = Number(totalMonthDays) || 30;
  if (salary <= 0 || days <= 0 || baseDays <= 0) return 0;
  return Number(((salary / baseDays) * days).toFixed(2));
}

/**
 * Fetch expenses for a seller in a given date range
 */
export async function getSellerExpenses(sellerId, { startDate, endDate, category } = {}) {
  if (!sellerId) return [];

  try {
    let query = supabase
      .from('seller_expenses')
      .select('*, seller_employees(id, name, designation, monthly_salary)')
      .eq('seller_id', sellerId)
      .order('expense_date', { ascending: false });

    if (startDate) {
      const s = typeof startDate === 'string' ? startDate.split('T')[0] : new Date(startDate).toISOString().split('T')[0];
      query = query.gte('expense_date', s);
    }
    if (endDate) {
      const e = typeof endDate === 'string' ? endDate.split('T')[0] : new Date(endDate).toISOString().split('T')[0];
      query = query.lte('expense_date', e);
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[expenseService] getSellerExpenses notice:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[expenseService] getSellerExpenses exception:', err);
    return [];
  }
}

/**
 * Create a new expense record
 */
export async function createSellerExpense(expenseData) {
  if (!expenseData.seller_id) throw new Error('Seller ID is required');
  if (!expenseData.title) throw new Error('Expense title is required');
  if (expenseData.amount === undefined || expenseData.amount === null || Number(expenseData.amount) < 0) {
    throw new Error('Valid expense amount is required');
  }

  const payload = {
    seller_id: expenseData.seller_id,
    category: expenseData.category || 'other',
    title: expenseData.title.trim(),
    amount: Number(expenseData.amount),
    expense_date: expenseData.expense_date || new Date().toISOString().split('T')[0],
    expense_type: expenseData.expense_type || 'daily',
    employee_id: expenseData.employee_id || null,
    days_worked: expenseData.days_worked !== undefined && expenseData.days_worked !== null ? Number(expenseData.days_worked) : null,
    monthly_rate: expenseData.monthly_rate !== undefined && expenseData.monthly_rate !== null ? Number(expenseData.monthly_rate) : null,
    total_month_days: expenseData.total_month_days ? Number(expenseData.total_month_days) : 30,
    payment_method: expenseData.payment_method || 'cash',
    notes: expenseData.notes ? expenseData.notes.trim() : null,
  };

  const { data, error } = await supabase
    .from('seller_expenses')
    .insert([payload])
    .select('*, seller_employees(id, name, designation)')
    .single();

  if (error) {
    console.error('[expenseService] createSellerExpense error:', error);
    throw error;
  }
  return data;
}

/**
 * Update an existing expense record
 */
export async function updateSellerExpense(expenseId, updates) {
  if (!expenseId) throw new Error('Expense ID is required');

  const cleanUpdates = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (cleanUpdates.title) cleanUpdates.title = cleanUpdates.title.trim();
  if (cleanUpdates.amount !== undefined) cleanUpdates.amount = Number(cleanUpdates.amount);

  const { data, error } = await supabase
    .from('seller_expenses')
    .update(cleanUpdates)
    .eq('id', expenseId)
    .select('*, seller_employees(id, name, designation)')
    .single();

  if (error) {
    console.error('[expenseService] updateSellerExpense error:', error);
    throw error;
  }
  return data;
}

/**
 * Delete an expense record
 */
export async function deleteSellerExpense(expenseId) {
  if (!expenseId) return false;
  const { error } = await supabase
    .from('seller_expenses')
    .delete()
    .eq('id', expenseId);

  if (error) {
    console.error('[expenseService] deleteSellerExpense error:', error);
    throw error;
  }
  return true;
}

/**
 * Comprehensive Profit & Loss (P&L) Report Generator
 * Combines completed orders sales revenue and all logged expenses.
 */
export async function getSellerPnLReport(sellerId, { startDate, endDate } = {}) {
  if (!sellerId) return null;

  const startD = startDate ? new Date(startDate) : new Date();
  const endD = endDate ? new Date(endDate) : new Date();
  const startStr = startD.toISOString().split('T')[0];
  const endStr = endD.toISOString().split('T')[0];

  try {
    // 1. Fetch Orders for the period
    const orders = await getSellerOrdersForReport(sellerId, { startDate: startD, endDate: endD });
    const completedOrders = orders.filter(
      (o) => !['cancelled', 'rejected'].includes((o.status || '').toLowerCase())
    );

    // 2. Fetch Expenses for the period
    const expenses = await getSellerExpenses(sellerId, { startDate: startStr, endDate: endStr });

    // 3. Aggregate Revenue
    let totalRevenue = 0;
    let dineInRevenue = 0;
    let parcelDeliveryRevenue = 0;

    completedOrders.forEach((o) => {
      const amt = Number(o.total_amount || 0);
      totalRevenue += amt;
      const type = (o.order_type || '').toLowerCase();
      if (type.includes('dine') || Boolean(o.table_no)) {
        dineInRevenue += amt;
      } else {
        parcelDeliveryRevenue += amt;
      }
    });

    // 4. Aggregate Expenses by Category
    const categoryTotals = {
      groceries: 0,
      parcel_packaging: 0,
      salary: 0,
      rent: 0,
      utilities: 0,
      delivery_logistics: 0,
      maintenance: 0,
      other: 0,
    };

    let totalExpenses = 0;
    expenses.forEach((e) => {
      const amt = Number(e.amount || 0);
      totalExpenses += amt;
      if (categoryTotals[e.category] !== undefined) {
        categoryTotals[e.category] += amt;
      } else {
        categoryTotals.other += amt;
      }
    });

    // 5. Daily Ledger (Day-by-Day comparison)
    const dailyMap = {};
    const curr = new Date(startD);
    curr.setHours(0, 0, 0, 0);
    const endBoundary = new Date(endD);
    endBoundary.setHours(23, 59, 59, 999);

    while (curr <= endBoundary) {
      const dKey = curr.toISOString().split('T')[0];
      dailyMap[dKey] = {
        date: dKey,
        revenue: 0,
        ordersCount: 0,
        expenses: 0,
        netPnL: 0,
        isProfit: true,
      };
      curr.setDate(curr.getDate() + 1);
    }

    completedOrders.forEach((o) => {
      const dKey = new Date(o.created_at).toISOString().split('T')[0];
      if (dailyMap[dKey]) {
        dailyMap[dKey].revenue += Number(o.total_amount || 0);
        dailyMap[dKey].ordersCount += 1;
      }
    });

    expenses.forEach((e) => {
      const dKey = e.expense_date;
      if (dailyMap[dKey]) {
        dailyMap[dKey].expenses += Number(e.amount || 0);
      }
    });

    const dailyLedger = Object.values(dailyMap)
      .map((row) => {
        const net = Number((row.revenue - row.expenses).toFixed(2));
        return {
          ...row,
          revenue: Number(row.revenue.toFixed(2)),
          expenses: Number(row.expenses.toFixed(2)),
          netPnL: net,
          isProfit: net >= 0,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // 6. Net P&L Summary
    const netPnL = Number((totalRevenue - totalExpenses).toFixed(2));
    const profitMargin = totalRevenue > 0 ? Number(((netPnL / totalRevenue) * 100).toFixed(1)) : 0;
    const isProfit = netPnL >= 0;

    return {
      period: {
        startDate: startStr,
        endDate: endStr,
      },
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalOrders: completedOrders.length,
        dineInRevenue: Number(dineInRevenue.toFixed(2)),
        parcelDeliveryRevenue: Number(parcelDeliveryRevenue.toFixed(2)),
        totalExpenses: Number(totalExpenses.toFixed(2)),
        netPnL,
        profitMargin,
        isProfit,
      },
      categoryBreakdown: {
        groceries: Number(categoryTotals.groceries.toFixed(2)),
        parcel_packaging: Number(categoryTotals.parcel_packaging.toFixed(2)),
        salary: Number(categoryTotals.salary.toFixed(2)),
        rent: Number(categoryTotals.rent.toFixed(2)),
        utilities: Number(categoryTotals.utilities.toFixed(2)),
        delivery_logistics: Number(categoryTotals.delivery_logistics.toFixed(2)),
        maintenance: Number(categoryTotals.maintenance.toFixed(2)),
        other: Number(categoryTotals.other.toFixed(2)),
      },
      dailyLedger,
      recentExpenses: expenses,
    };
  } catch (err) {
    console.error('[expenseService] getSellerPnLReport error:', err);
    throw err;
  }
}
