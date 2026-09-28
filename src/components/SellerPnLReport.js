import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Dimensions,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import UniversalDateTimePicker from './UniversalDateTimePicker';
import {
  getSellerPnLReport,
  createSellerExpense,
  updateSellerExpense,
  deleteSellerExpense,
  calculateEmployeeSalary,
  EXPENSE_CATEGORIES,
} from '../services/expenseService';
import { getSellerEmployees } from '../services/employeeService';
import { supabase } from '../services/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PRESET_RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
];

export default function SellerPnLReport({ sellerId, sellerName, onClose }) {
  const [activeSellerId, setActiveSellerId] = useState(sellerId || null);
  const [selectedPreset, setSelectedPreset] = useState('today');

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });

  const [isStartDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [isEndDatePickerVisible, setEndDatePickerVisible] = useState(false);

  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);

  // Add/Edit Expense Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('groceries');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Salary specific fields
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [daysWorked, setDaysWorked] = useState('30');
  const [totalMonthDays, setTotalMonthDays] = useState('30');

  // Active view tab: 'overview' | 'ledger' | 'expenses'
  const [viewTab, setViewTab] = useState('overview');

  // Auto-resolve sellerId from auth if not passed directly
  useEffect(() => {
    if (sellerId) {
      setActiveSellerId(sellerId);
    } else {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setActiveSellerId(user.id);
        }
      })();
    }
  }, [sellerId]);

  // Load employees for salary dropdown
  useEffect(() => {
    if (activeSellerId) {
      getSellerEmployees(activeSellerId).then((data) => setEmployees(data || []));
    }
  }, [activeSellerId]);

  // Handle Preset Changes
  const applyPreset = (presetId) => {
    setSelectedPreset(presetId);
    const now = new Date();

    if (presetId === 'today') {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      setStartDate(s);
      setEndDate(e);
    } else if (presetId === 'yesterday') {
      const s = new Date(now);
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(e.getDate() - 1);
      e.setHours(23, 59, 59, 999);
      setStartDate(s);
      setEndDate(e);
    } else if (presetId === '7days') {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      setStartDate(s);
      setEndDate(e);
    } else if (presetId === 'thisMonth') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      setStartDate(s);
      setEndDate(e);
    }
  };

  // Fetch Report Data
  const loadReport = useCallback(async () => {
    if (!activeSellerId) return;
    setLoading(true);
    try {
      const data = await getSellerPnLReport(activeSellerId, { startDate, endDate });
      setReportData(data);
    } catch (err) {
      console.warn('Error loading P&L report:', err);
    } finally {
      setLoading(false);
    }
  }, [activeSellerId, startDate, endDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Auto-calculate salary when monthly salary or days change
  useEffect(() => {
    if (selectedCategory === 'salary' && monthlySalary && daysWorked) {
      const calculated = calculateEmployeeSalary(monthlySalary, daysWorked, totalMonthDays);
      setExpenseAmount(calculated ? calculated.toString() : '');
    }
  }, [selectedCategory, monthlySalary, daysWorked, totalMonthDays]);

  // Handle Employee Selection
  const handleEmployeeChange = (empId) => {
    setSelectedEmployeeId(empId);
    const emp = employees.find((e) => e.id === empId);
    if (emp) {
      const defaultSal = emp.monthly_salary ? emp.monthly_salary.toString() : '';
      setMonthlySalary(defaultSal);
      setExpenseTitle(`${emp.name} - Salary (${daysWorked} days)`);
      if (defaultSal && daysWorked) {
        const amt = calculateEmployeeSalary(defaultSal, daysWorked, totalMonthDays);
        setExpenseAmount(amt.toString());
      }
    }
  };

  // Open Modal for adding an expense
  const openAddExpenseModal = (catId = 'groceries') => {
    setEditingExpenseId(null);
    setSelectedCategory(catId);
    setExpenseDate(new Date().toISOString().split('T')[0]);
    setExpenseNotes('');
    setPaymentMethod('cash');
    setMonthlySalary('');
    setDaysWorked('30');
    setTotalMonthDays('30');
    setSelectedEmployeeId('');

    if (catId === 'groceries') {
      setExpenseTitle('Daily Groceries & Raw Materials');
      setExpenseAmount('');
    } else if (catId === 'parcel_packaging') {
      setExpenseTitle('Parcel Boxes, Bags & Tape');
      setExpenseAmount('');
    } else if (catId === 'rent') {
      setExpenseTitle('Store Rent');
      setExpenseAmount('');
    } else if (catId === 'salary') {
      setExpenseTitle('Employee Salary');
      setExpenseAmount('');
    } else {
      setExpenseTitle('');
      setExpenseAmount('');
    }

    setModalVisible(true);
  };

  // Open Modal for editing an existing expense
  const openEditExpenseModal = (expense) => {
    setEditingExpenseId(expense.id);
    setSelectedCategory(expense.category || 'other');
    setExpenseTitle(expense.title || '');
    setExpenseAmount(expense.amount !== undefined && expense.amount !== null ? expense.amount.toString() : '');
    setExpenseDate(expense.expense_date || new Date().toISOString().split('T')[0]);
    setPaymentMethod(expense.payment_method || 'cash');
    setExpenseNotes(expense.notes || '');
    setSelectedEmployeeId(expense.employee_id || '');
    setMonthlySalary(expense.monthly_rate !== undefined && expense.monthly_rate !== null ? expense.monthly_rate.toString() : '');
    setDaysWorked(expense.days_worked !== undefined && expense.days_worked !== null ? expense.days_worked.toString() : '30');
    setTotalMonthDays(expense.total_month_days ? expense.total_month_days.toString() : '30');
    setModalVisible(true);
  };

  // Submit Expense (Create or Update)
  const handleSaveExpense = async () => {
    if (!expenseTitle.trim()) {
      alert('Please enter an expense title');
      return;
    }
    const parsedAmt = Number(expenseAmount);
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      alert('Please enter a valid expense amount greater than 0');
      return;
    }

    setSavingExpense(true);
    try {
      const payload = {
        seller_id: activeSellerId,
        category: selectedCategory,
        title: expenseTitle.trim(),
        amount: parsedAmt,
        expense_date: expenseDate,
        expense_type: selectedCategory === 'rent' ? 'monthly_recurring' : selectedCategory === 'salary' ? 'salary' : 'daily',
        employee_id: selectedEmployeeId || null,
        days_worked: selectedCategory === 'salary' ? Number(daysWorked) : null,
        monthly_rate: selectedCategory === 'salary' || selectedCategory === 'rent' ? Number(monthlySalary || expenseAmount) : null,
        total_month_days: selectedCategory === 'salary' ? Number(totalMonthDays) : 30,
        payment_method: paymentMethod,
        notes: expenseNotes,
      };

      if (editingExpenseId) {
        await updateSellerExpense(editingExpenseId, payload);
      } else {
        await createSellerExpense(payload);
      }

      setModalVisible(false);
      await loadReport();
    } catch (err) {
      alert(err.message || 'Failed to record expense');
    } finally {
      setSavingExpense(false);
    }
  };

  // Delete Expense
  const handleDeleteExpense = (expense) => {
    const doDelete = async () => {
      try {
        await deleteSellerExpense(expense.id);
        await loadReport();
      } catch (err) {
        alert(err.message || 'Failed to delete expense');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete expense "${expense.title}" (₹${expense.amount})?`)) {
        doDelete();
      }
    } else {
      Alert.alert('Delete Expense', `Delete "${expense.title}" (₹${expense.amount})?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const summary = reportData?.summary || {
    totalRevenue: 0,
    totalOrders: 0,
    dineInRevenue: 0,
    parcelDeliveryRevenue: 0,
    totalExpenses: 0,
    netPnL: 0,
    profitMargin: 0,
    isProfit: true,
  };

  const categories = reportData?.categoryBreakdown || {};

  return (
    <View style={styles.container}>
      {/* Top Filter Bar */}
      <View style={styles.filterCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsContainer}>
          {PRESET_RANGES.map((preset) => (
            <TouchableOpacity
              key={preset.id}
              style={[styles.presetBtn, selectedPreset === preset.id && styles.presetBtnActive]}
              onPress={() => applyPreset(preset.id)}
            >
              <Text style={[styles.presetBtnText, selectedPreset === preset.id && styles.presetBtnTextActive]}>
                {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Custom Range Picker */}
        {selectedPreset === 'custom' && (
          <View style={styles.datePickersRow}>
            <TouchableOpacity style={styles.dateInput} onPress={() => setStartDatePickerVisible(true)}>
              <Icon name="calendar" size={12} color="#64748B" />
              <Text style={styles.dateInputText}>{startDate.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <Text style={styles.dateSeparator}>to</Text>
            <TouchableOpacity style={styles.dateInput} onPress={() => setEndDatePickerVisible(true)}>
              <Icon name="calendar" size={12} color="#64748B" />
              <Text style={styles.dateInputText}>{endDate.toLocaleDateString()}</Text>
            </TouchableOpacity>
          </View>
        )}

        <UniversalDateTimePicker
          isVisible={isStartDatePickerVisible}
          mode="date"
          value={startDate}
          onConfirm={(d) => {
            setStartDate(d);
            setStartDatePickerVisible(false);
          }}
          onCancel={() => setStartDatePickerVisible(false)}
        />
        <UniversalDateTimePicker
          isVisible={isEndDatePickerVisible}
          mode="date"
          value={endDate}
          onConfirm={(d) => {
            setEndDate(d);
            setEndDatePickerVisible(false);
          }}
          onCancel={() => setEndDatePickerVisible(false)}
        />
      </View>

      {/* Action Bar: View Tabs & Add Expense Button */}
      <View style={styles.actionBar}>
        <View style={styles.tabButtonGroup}>
          <TouchableOpacity
            style={[styles.tabBtn, viewTab === 'overview' && styles.tabBtnActive]}
            onPress={() => setViewTab('overview')}
          >
            <Text style={[styles.tabBtnText, viewTab === 'overview' && styles.tabBtnTextActive]}>Overview</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, viewTab === 'ledger' && styles.tabBtnActive]}
            onPress={() => setViewTab('ledger')}
          >
            <Text style={[styles.tabBtnText, viewTab === 'ledger' && styles.tabBtnTextActive]}>Daily Ledger</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, viewTab === 'expenses' && styles.tabBtnActive]}
            onPress={() => setViewTab('expenses')}
          >
            <Text style={[styles.tabBtnText, viewTab === 'expenses' && styles.tabBtnTextActive]}>
              Expenses ({reportData?.recentExpenses?.length || 0})
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.addExpenseBtn} onPress={() => openAddExpenseModal('groceries')}>
          <Icon name="plus" size={12} color="#FFFFFF" />
          <Text style={styles.addExpenseBtnText}>Add Expense</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Calculating Revenue, Expenses & Net Profit...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollArea} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Main Profit & Loss Hero Banner */}
          <View style={[styles.pnlHeroCard, summary.isProfit ? styles.pnlHeroCardProfit : styles.pnlHeroCardLoss]}>
            <View style={styles.pnlHeroHeader}>
              <View>
                <Text style={styles.pnlHeroSubtitle}>NET PROFIT / LOSS</Text>
                <Text style={[styles.pnlHeroAmount, summary.isProfit ? styles.textProfit : styles.textLoss]}>
                  {summary.netPnL >= 0 ? `+ ₹${summary.netPnL.toFixed(2)}` : `- ₹${Math.abs(summary.netPnL).toFixed(2)}`}
                </Text>
              </View>
              <View style={[styles.marginBadge, summary.isProfit ? styles.marginBadgeProfit : styles.marginBadgeLoss]}>
                <Icon name={summary.isProfit ? 'arrow-up' : 'arrow-down'} size={12} color={summary.isProfit ? '#059669' : '#DC2626'} />
                <Text style={[styles.marginBadgeText, summary.isProfit ? styles.textProfitDark : styles.textLossDark]}>
                  {summary.profitMargin}% Margin
                </Text>
              </View>
            </View>

            <View style={styles.pnlStatsRow}>
              <View style={styles.pnlStatItem}>
                <Text style={styles.pnlStatLabel}>💰 Total Sales</Text>
                <Text style={styles.pnlStatValue}>₹{summary.totalRevenue.toFixed(2)}</Text>
                <Text style={styles.pnlStatSub}>{summary.totalOrders} Orders</Text>
              </View>

              <View style={styles.pnlStatDivider} />

              <View style={styles.pnlStatItem}>
                <Text style={styles.pnlStatLabel}>💸 Total Expenses</Text>
                <Text style={[styles.pnlStatValue, { color: '#DC2626' }]}>₹{summary.totalExpenses.toFixed(2)}</Text>
                <Text style={styles.pnlStatSub}>All Overhead</Text>
              </View>

              <View style={styles.pnlStatDivider} />

              <View style={styles.pnlStatItem}>
                <Text style={styles.pnlStatLabel}>📦 Parcels Cost</Text>
                <Text style={styles.pnlStatValue}>₹{(categories.parcel_packaging || 0).toFixed(2)}</Text>
                <Text style={styles.pnlStatSub}>Packaging</Text>
              </View>
            </View>
          </View>

          {/* Quick Category Buttons for Quick Logging */}
          <View style={styles.quickAddRow}>
            <TouchableOpacity style={[styles.quickAddChip, { borderColor: '#10B981' }]} onPress={() => openAddExpenseModal('groceries')}>
              <Text style={styles.quickAddChipIcon}>🥬</Text>
              <Text style={styles.quickAddChipText}>+ Groceries</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.quickAddChip, { borderColor: '#F59E0B' }]} onPress={() => openAddExpenseModal('parcel_packaging')}>
              <Text style={styles.quickAddChipIcon}>📦</Text>
              <Text style={styles.quickAddChipText}>+ Parcel Box</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.quickAddChip, { borderColor: '#6366F1' }]} onPress={() => openAddExpenseModal('salary')}>
              <Text style={styles.quickAddChipIcon}>👨‍🍳</Text>
              <Text style={styles.quickAddChipText}>+ Salary / Days</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.quickAddChip, { borderColor: '#EC4899' }]} onPress={() => openAddExpenseModal('rent')}>
              <Text style={styles.quickAddChipIcon}>🏢</Text>
              <Text style={styles.quickAddChipText}>+ Store Rent</Text>
            </TouchableOpacity>
          </View>

          {/* TAB 1: OVERVIEW */}
          {viewTab === 'overview' && (
            <>
              {/* Expense Category Breakdown Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Expense Distribution Breakdown</Text>
                  <Text style={styles.cardSubtitle}>Total: ₹{summary.totalExpenses.toFixed(2)}</Text>
                </View>

                {EXPENSE_CATEGORIES.map((cat) => {
                  const catAmount = categories[cat.id] || 0;
                  const percent = summary.totalExpenses > 0 ? ((catAmount / summary.totalExpenses) * 100).toFixed(1) : 0;

                  return (
                    <View key={cat.id} style={styles.catRow}>
                      <View style={styles.catInfo}>
                        <View style={[styles.catIconWrap, { backgroundColor: `${cat.color}15` }]}>
                          <Icon name={cat.icon} size={14} color={cat.color} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <View style={styles.catTitleRow}>
                            <Text style={styles.catName}>{cat.label}</Text>
                            <Text style={styles.catAmount}>₹{catAmount.toFixed(2)}</Text>
                          </View>
                          <View style={styles.progressBarBg}>
                            <View style={[styles.progressBarFill, { width: `${Math.min(percent, 100)}%`, backgroundColor: cat.color }]} />
                          </View>
                          <Text style={styles.catPercentText}>{percent}% of total expenses</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Order Revenue Split */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Revenue Channels</Text>
                <View style={styles.channelRow}>
                  <View style={styles.channelItem}>
                    <Text style={styles.channelIcon}>🍽️</Text>
                    <Text style={styles.channelName}>Dine-in / Counter</Text>
                    <Text style={styles.channelVal}>₹{summary.dineInRevenue.toFixed(2)}</Text>
                  </View>
                  <View style={styles.channelItem}>
                    <Text style={styles.channelIcon}>📦</Text>
                    <Text style={styles.channelName}>Parcel & Delivery</Text>
                    <Text style={styles.channelVal}>₹{summary.parcelDeliveryRevenue.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* TAB 2: DAILY LEDGER */}
          {viewTab === 'ledger' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Daily Profit & Loss Ledger</Text>
              <Text style={styles.cardSubtitle}>Compare daily sales against daily expenses</Text>

              {(!reportData?.dailyLedger || reportData.dailyLedger.length === 0) ? (
                <Text style={styles.emptyText}>No transactions recorded for this period.</Text>
              ) : (
                <View style={styles.ledgerTable}>
                  <View style={styles.ledgerHeaderRow}>
                    <Text style={[styles.ledgerCol, { flex: 1.2 }]}>Date</Text>
                    <Text style={[styles.ledgerCol, { flex: 1, textAlign: 'right' }]}>Sales</Text>
                    <Text style={[styles.ledgerCol, { flex: 1, textAlign: 'right' }]}>Expenses</Text>
                    <Text style={[styles.ledgerCol, { flex: 1.2, textAlign: 'right' }]}>Net P&L</Text>
                  </View>

                  {reportData.dailyLedger.map((row) => (
                    <View key={row.date} style={styles.ledgerDataRow}>
                      <View style={{ flex: 1.2 }}>
                        <Text style={styles.ledgerDateText}>{new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}</Text>
                        <Text style={styles.ledgerSubText}>{row.ordersCount} orders</Text>
                      </View>
                      <Text style={[styles.ledgerCol, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>
                        ₹{row.revenue.toFixed(0)}
                      </Text>
                      <Text style={[styles.ledgerCol, { flex: 1, textAlign: 'right', color: '#DC2626' }]}>
                        ₹{row.expenses.toFixed(0)}
                      </Text>
                      <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
                        <View style={[styles.pnlChip, row.isProfit ? styles.pnlChipProfit : styles.pnlChipLoss]}>
                          <Text style={[styles.pnlChipText, row.isProfit ? styles.textProfitDark : styles.textLossDark]}>
                            {row.netPnL >= 0 ? `+₹${row.netPnL.toFixed(0)}` : `-₹${Math.abs(row.netPnL).toFixed(0)}`}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* TAB 3: EXPENSE ENTRIES */}
          {viewTab === 'expenses' && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Logged Expenses</Text>
                <TouchableOpacity style={styles.inlineAddBtn} onPress={() => openAddExpenseModal('groceries')}>
                  <Icon name="plus" size={10} color="#10B981" />
                  <Text style={styles.inlineAddBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {(!reportData?.recentExpenses || reportData.recentExpenses.length === 0) ? (
                <View style={styles.emptyContainer}>
                  <Text style={{ fontSize: 32 }}>📝</Text>
                  <Text style={styles.emptyTitle}>No expenses logged yet</Text>
                  <Text style={styles.emptySub}>Record grocery purchases, employee salaries with days, or store rent.</Text>
                  <TouchableOpacity style={styles.addFirstBtn} onPress={() => openAddExpenseModal('groceries')}>
                    <Text style={styles.addFirstBtnText}>+ Log First Expense</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                reportData.recentExpenses.map((exp) => {
                  const catObj = EXPENSE_CATEGORIES.find((c) => c.id === exp.category) || {
                    color: '#64748B',
                    icon: 'tag',
                    label: exp.category,
                  };

                  return (
                    <View key={exp.id} style={styles.expenseItem}>
                      <View style={[styles.expenseIconBox, { backgroundColor: `${catObj.color}15` }]}>
                        <Icon name={catObj.icon} size={15} color={catObj.color} />
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.expenseItemTitle}>{exp.title}</Text>
                        <View style={styles.expenseMetaRow}>
                          <Text style={styles.expenseMetaText}>
                            {new Date(exp.expense_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </Text>
                          <Text style={styles.expenseMetaDot}>•</Text>
                          <Text style={[styles.expenseMetaBadge, { color: catObj.color }]}>{catObj.label}</Text>
                          {exp.payment_method && (
                            <>
                              <Text style={styles.expenseMetaDot}>•</Text>
                              <Text style={styles.expenseMetaText}>{exp.payment_method.toUpperCase()}</Text>
                            </>
                          )}
                        </View>
                        {exp.days_worked ? (
                          <Text style={styles.salaryDetailText}>
                            👤 {exp.seller_employees?.name || 'Staff'}: {exp.days_worked} days worked
                            {exp.monthly_rate ? ` (@ ₹${exp.monthly_rate}/mo)` : ''}
                          </Text>
                        ) : null}
                      </View>

                      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                        <Text style={styles.expenseItemAmount}>-₹{Number(exp.amount).toFixed(2)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <TouchableOpacity style={styles.editExpenseBtn} onPress={() => openEditExpenseModal(exp)}>
                            <Icon name="pencil" size={13} color="#0284C7" />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.deleteExpenseBtn} onPress={() => handleDeleteExpense(exp)}>
                            <Icon name="trash" size={13} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ADD / EDIT EXPENSE MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingExpenseId ? '✏️ Edit Store Expense' : 'Record Store Expense'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="times" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: '80vh' }}>
              {/* Category Selector Chips */}
              <Text style={styles.inputLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catChipsContainer}>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.modalCatChip, selectedCategory === cat.id && { backgroundColor: cat.color, borderColor: cat.color }]}
                    onPress={() => {
                      setSelectedCategory(cat.id);
                      if (cat.id === 'groceries') setExpenseTitle('Daily Groceries & Raw Materials');
                      else if (cat.id === 'parcel_packaging') setExpenseTitle('Parcel Packaging & Boxes');
                      else if (cat.id === 'rent') setExpenseTitle('Store Rent');
                      else if (cat.id === 'salary') setExpenseTitle('Employee Salary');
                    }}
                  >
                    <Icon name={cat.icon} size={12} color={selectedCategory === cat.id ? '#FFFFFF' : cat.color} />
                    <Text style={[styles.modalCatChipText, selectedCategory === cat.id && { color: '#FFFFFF' }]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* SPECIAL: SALARY ATTENDANCE CALCULATOR */}
              {selectedCategory === 'salary' && (
                <View style={styles.salaryCard}>
                  <Text style={styles.salaryCardHeader}>👨‍🍳 Employee Salary Calculator</Text>

                  {employees.length > 0 ? (
                    <>
                      <Text style={styles.inputSubLabel}>Select Staff Member</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                        {employees.map((emp) => (
                          <TouchableOpacity
                            key={emp.id}
                            style={[styles.empChip, selectedEmployeeId === emp.id && styles.empChipActive]}
                            onPress={() => handleEmployeeChange(emp.id)}
                          >
                            <Text style={[styles.empChipText, selectedEmployeeId === emp.id && styles.empChipTextActive]}>
                              {emp.name} ({emp.designation})
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : null}

                  <View style={styles.salaryInputsRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.inputSubLabel}>Monthly Salary (₹)</Text>
                      <TextInput
                        style={styles.salaryInput}
                        keyboardType="numeric"
                        placeholder="15000"
                        value={monthlySalary}
                        onChangeText={setMonthlySalary}
                      />
                    </View>

                    <View style={{ flex: 1, marginHorizontal: 4 }}>
                      <Text style={styles.inputSubLabel}>Days Worked</Text>
                      <TextInput
                        style={styles.salaryInput}
                        keyboardType="numeric"
                        placeholder="26"
                        value={daysWorked}
                        onChangeText={setDaysWorked}
                      />
                    </View>

                    <View style={{ flex: 0.8, marginLeft: 4 }}>
                      <Text style={styles.inputSubLabel}>Total Days</Text>
                      <TextInput
                        style={styles.salaryInput}
                        keyboardType="numeric"
                        placeholder="30"
                        value={totalMonthDays}
                        onChangeText={setTotalMonthDays}
                      />
                    </View>
                  </View>

                  {monthlySalary && daysWorked ? (
                    <View style={styles.calcPreviewRow}>
                      <Text style={styles.calcPreviewText}>
                        Formula: (₹{monthlySalary} / {totalMonthDays || 30}) × {daysWorked} days
                      </Text>
                      <Text style={styles.calcPreviewTotal}>
                        = ₹{calculateEmployeeSalary(monthlySalary, daysWorked, totalMonthDays).toFixed(2)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* Title Input */}
              <Text style={styles.inputLabel}>Expense Title / Description *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Daily Vegetables & Milk"
                value={expenseTitle}
                onChangeText={setExpenseTitle}
              />

              {/* Amount Input */}
              <Text style={styles.inputLabel}>Total Amount (₹) *</Text>
              <TextInput
                style={[styles.input, { fontSize: 18, fontWeight: '700', color: '#DC2626' }]}
                keyboardType="numeric"
                placeholder="0.00"
                value={expenseAmount}
                onChangeText={setExpenseAmount}
              />

              {/* Date & Payment Method Row */}
              <View style={styles.formRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Expense Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={expenseDate}
                    onChangeText={setExpenseDate}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Payment Method</Text>
                  <View style={styles.paymentMethodRow}>
                    {['cash', 'upi', 'bank_transfer'].map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.payMethodChip, paymentMethod === m && styles.payMethodChipActive]}
                        onPress={() => setPaymentMethod(m)}
                      >
                        <Text style={[styles.payMethodText, paymentMethod === m && styles.payMethodTextActive]}>
                          {m === 'bank_transfer' ? 'Bank' : m.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* Notes Input */}
              <Text style={styles.inputLabel}>Notes / Vendor Info (Optional)</Text>
              <TextInput
                style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                multiline
                placeholder="Bill number, vendor name, or additional details..."
                value={expenseNotes}
                onChangeText={setExpenseNotes}
              />

              {/* Submit Buttons */}
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setModalVisible(false)}
                  disabled={savingExpense}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveExpense}
                  disabled={savingExpense}
                >
                  {savingExpense ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>{editingExpenseId ? 'Update Expense' : 'Save Expense'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  filterCard: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  presetsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  presetBtnActive: {
    backgroundColor: '#0F172A',
  },
  presetBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  presetBtnTextActive: {
    color: '#FFFFFF',
  },
  datePickersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateInputText: {
    fontSize: 12,
    color: '#0F172A',
    marginLeft: 6,
    fontWeight: '600',
  },
  dateSeparator: {
    marginHorizontal: 8,
    color: '#94A3B8',
    fontSize: 12,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tabButtonGroup: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
  },
  tabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  tabBtnTextActive: {
    color: '#0F172A',
  },
  addExpenseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addExpenseBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 13,
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 14,
  },
  pnlHeroCard: {
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
  },
  pnlHeroCardProfit: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  pnlHeroCardLoss: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  pnlHeroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  pnlHeroSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#64748B',
  },
  pnlHeroAmount: {
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  textProfit: {
    color: '#059669',
  },
  textLoss: {
    color: '#DC2626',
  },
  textProfitDark: {
    color: '#065F46',
  },
  textLossDark: {
    color: '#991B1B',
  },
  marginBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  marginBadgeProfit: {
    backgroundColor: '#DCFCE7',
  },
  marginBadgeLoss: {
    backgroundColor: '#FEE2E2',
  },
  marginBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 4,
  },
  pnlStatsRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pnlStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  pnlStatDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E2E8F0',
  },
  pnlStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 2,
  },
  pnlStatValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  pnlStatSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },
  quickAddRow: {
    flexDirection: 'row',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 8,
  },
  quickAddChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quickAddChipIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  quickAddChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  catRow: {
    marginBottom: 14,
  },
  catInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  catIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  catTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  catName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  catAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
  catPercentText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  channelRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  channelItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  channelIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  channelName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  channelVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  ledgerTable: {
    marginTop: 10,
  },
  ledgerHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  ledgerCol: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  ledgerDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  ledgerDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  ledgerSubText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  pnlChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pnlChipProfit: {
    backgroundColor: '#DCFCE7',
  },
  pnlChipLoss: {
    backgroundColor: '#FEE2E2',
  },
  pnlChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 10,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 260,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94A3B8',
    paddingVertical: 20,
    fontSize: 13,
  },
  addFirstBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    marginTop: 16,
  },
  addFirstBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  inlineAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
  },
  inlineAddBtnText: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 4,
  },
  expenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  expenseIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expenseItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  expenseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  expenseMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  expenseMetaDot: {
    marginHorizontal: 4,
    color: '#CBD5E1',
    fontSize: 11,
  },
  expenseMetaBadge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  salaryDetailText: {
    fontSize: 11,
    color: '#4F46E5',
    fontWeight: '600',
    marginTop: 2,
  },
  expenseItemAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#DC2626',
  },
  editExpenseBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteExpenseBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 10,
  },
  inputSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  catChipsContainer: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  modalCatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#F8FAFC',
  },
  modalCatChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginLeft: 5,
  },
  salaryCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginVertical: 8,
  },
  salaryCardHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3730A3',
    marginBottom: 8,
  },
  empChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginRight: 6,
  },
  empChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  empChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4338CA',
  },
  empChipTextActive: {
    color: '#FFFFFF',
  },
  salaryInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  salaryInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B4B',
  },
  calcPreviewRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#C7D2FE',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calcPreviewText: {
    fontSize: 11,
    color: '#4338CA',
    fontWeight: '500',
  },
  calcPreviewTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E1B4B',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  paymentMethodRow: {
    flexDirection: 'row',
    gap: 4,
  },
  payMethodChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  payMethodChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  payMethodText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  payMethodTextActive: {
    color: '#FFFFFF',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  saveBtn: {
    flex: 1.5,
    backgroundColor: '#10B981',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
