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
} from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText, Circle, Line } from 'react-native-svg';
import Icon from 'react-native-vector-icons/FontAwesome';
import UniversalDateTimePicker from './UniversalDateTimePicker';
import { getSellerOrdersForReport } from '../services/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLOR_PALETTE = [
  '#4F46E5', // Indigo
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#8B5CF6', // Purple
  '#EF4444', // Red
  '#14B8A6', // Teal
  '#64748B', // Slate (Others)
];

const PRESET_RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
];

/**
 * Helper to describe an SVG Donut Slice arc
 */
function describeDonutSlice(cx, cy, r, R, startAngle, endAngle) {
  const x1 = cx + R * Math.cos(startAngle);
  const y1 = cy + R * Math.sin(startAngle);
  const x2 = cx + R * Math.cos(endAngle);
  const y2 = cy + R * Math.sin(endAngle);
  const x3 = cx + r * Math.cos(endAngle);
  const y3 = cy + r * Math.sin(endAngle);
  const x4 = cx + r * Math.cos(startAngle);
  const y4 = cy + r * Math.sin(startAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArcFlag} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/**
 * Helper to describe an SVG Pie Slice wedge (inner radius = 0)
 */
function describePieSlice(cx, cy, R, startAngle, endAngle) {
  const x1 = cx + R * Math.cos(startAngle);
  const y1 = cy + R * Math.sin(startAngle);
  const x2 = cx + R * Math.cos(endAngle);
  const y2 = cy + R * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArcFlag} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function formatHourLabel(h) {
  const hour = Number(h);
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

const SellerSalesReport = ({ sellerId, sellerName, onClose }) => {
  const [selectedPreset, setSelectedPreset] = useState('today');
  const [chartType, setChartType] = useState('donut'); // 'donut' | 'pie'
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

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHourDetails, setSelectedHourDetails] = useState(null);
  const [selectedProductDetails, setSelectedProductDetails] = useState(null);

  // Apply preset dates
  const handleSelectPreset = (presetId) => {
    setSelectedPreset(presetId);
    const now = new Date();
    let s = new Date(now);
    let e = new Date(now);

    if (presetId === 'today') {
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
    } else if (presetId === 'yesterday') {
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      e.setDate(e.getDate() - 1);
      e.setHours(23, 59, 59, 999);
    } else if (presetId === '7days') {
      s.setDate(s.getDate() - 6);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
    } else if (presetId === 'thisMonth') {
      s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
    }

    if (presetId !== 'custom') {
      setStartDate(s);
      setEndDate(e);
    }
  };

  // Fetch report orders whenever sellerId, startDate, or endDate changes
  const loadReportData = useCallback(async () => {
    if (!sellerId) return;
    setLoading(true);
    try {
      const data = await getSellerOrdersForReport(sellerId, { startDate, endDate });
      setOrders(data || []);
    } catch (err) {
      console.warn('Error loading sales report data:', err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [sellerId, startDate, endDate]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  // Exclude cancelled orders from gross sales calculation
  const validOrders = useMemo(() => {
    return orders.filter((o) => (o.status || '').toLowerCase() !== 'cancelled');
  }, [orders]);

  // Overall KPI metrics
  const { totalRevenue, totalUnits, totalOrders, avgOrderValue } = useMemo(() => {
    let rev = 0;
    let units = 0;
    validOrders.forEach((o) => {
      rev += Number(o.total_amount || 0);
      (o.order_items || []).forEach((item) => {
        units += Number(item.quantity || 1);
      });
    });
    const count = validOrders.length;
    const aov = count > 0 ? rev / count : 0;
    return {
      totalRevenue: rev,
      totalUnits: units,
      totalOrders: count,
      avgOrderValue: aov,
    };
  }, [validOrders]);

  // Hourly Breakdown (0 - 23 hours)
  const { hourlyData, peakHourInfo, maxHourlyRevenue } = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: formatHourLabel(i),
      revenue: 0,
      ordersCount: 0,
      units: 0,
    }));

    validOrders.forEach((o) => {
      const d = new Date(o.created_at);
      if (!isNaN(d.getTime())) {
        const h = d.getHours();
        if (bins[h]) {
          bins[h].revenue += Number(o.total_amount || 0);
          bins[h].ordersCount += 1;
          (o.order_items || []).forEach((it) => {
            bins[h].units += Number(it.quantity || 1);
          });
        }
      }
    });

    let peak = null;
    let maxRev = 0;
    bins.forEach((b) => {
      if (b.revenue > maxRev) {
        maxRev = b.revenue;
        peak = b;
      }
    });

    return {
      hourlyData: bins,
      peakHourInfo: peak && peak.revenue > 0 ? peak : null,
      maxHourlyRevenue: maxRev,
    };
  }, [validOrders]);

  // Product Contribution Breakdown
  const { productList, donutSlices } = useMemo(() => {
    const productMap = {};

    validOrders.forEach((o) => {
      (o.order_items || []).forEach((item) => {
        const prod = item.product_variant_combinations?.products;
        const prodName = prod?.product_name || 'Standard Product';
        const variantStr = item.product_variant_combinations?.combination_string || '';
        const key = `${prodName}___${variantStr}`;
        const itemPrice = Number(item.price || item.product_variant_combinations?.price || 0);
        const itemQty = Number(item.quantity || 1);
        const itemTotal = itemPrice * itemQty;

        if (!productMap[key]) {
          productMap[key] = {
            id: key,
            name: prodName,
            variant: variantStr,
            units: 0,
            revenue: 0,
          };
        }
        productMap[key].units += itemQty;
        productMap[key].revenue += itemTotal;
      });
    });

    const list = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);

    // Prepare top products for Donut Chart (Top 5 + Others)
    const topLimit = 5;
    const slices = [];
    let othersRev = 0;
    let othersUnits = 0;

    list.forEach((p, idx) => {
      if (idx < topLimit) {
        slices.push({
          ...p,
          color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
        });
      } else {
        othersRev += p.revenue;
        othersUnits += p.units;
      }
    });

    if (othersRev > 0) {
      slices.push({
        id: 'others',
        name: 'Other Products',
        variant: '',
        units: othersUnits,
        revenue: othersRev,
        color: COLOR_PALETTE[COLOR_PALETTE.length - 1],
      });
    }

    // Compute start and end angles for Donut slices
    let currentAngle = -Math.PI / 2; // Start from top 12 o'clock
    const totalProdRev = list.reduce((sum, p) => sum + p.revenue, 0) || totalRevenue || 1;

    const computedSlices = slices.map((s) => {
      const share = s.revenue / totalProdRev;
      const angle = share * 2 * Math.PI;
      const sliceStart = currentAngle;
      const sliceEnd = currentAngle + angle;
      currentAngle += angle;
      return {
        ...s,
        share: Math.round(share * 1000) / 10,
        startAngle: sliceStart,
        endAngle: sliceEnd,
      };
    });

    return {
      productList: list,
      donutSlices: computedSlices,
    };
  }, [validOrders, totalRevenue]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Title & Header Toolbar */}
      <View style={styles.topToolbar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.screenHeading}>Sales & Hourly Report</Text>
          <Text style={styles.screenSubheading}>
            {sellerName ? `${sellerName} Store Analytics` : 'Track hourly peak rush & product performance'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={loadReportData}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Icon name="refresh" size={14} color="#007AFF" />
          <Text style={styles.refreshBtnText}>{loading ? 'Syncing...' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {/* Date Range Preset Selector */}
      <View style={styles.presetScrollWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          {PRESET_RANGES.map((p) => {
            const isSelected = selectedPreset === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.presetChip, isSelected && styles.presetChipActive]}
                onPress={() => handleSelectPreset(p.id)}
                activeOpacity={0.75}
              >
                <Text style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Custom Date Pickers */}
      <View style={styles.datePickerContainer}>
        <TouchableOpacity
          style={styles.datePickerBtn}
          onPress={() => setStartDatePickerVisible(true)}
          activeOpacity={0.75}
        >
          <Icon name="calendar" size={13} color="#007AFF" style={{ marginRight: 6 }} />
          <View>
            <Text style={styles.datePickerLabel}>From Date</Text>
            <Text style={styles.datePickerValue}>
              {startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.dateArrowBox}>
          <Icon name="arrow-right" size={12} color="#94A3B8" />
        </View>

        <TouchableOpacity
          style={styles.datePickerBtn}
          onPress={() => setEndDatePickerVisible(true)}
          activeOpacity={0.75}
        >
          <Icon name="calendar" size={13} color="#007AFF" style={{ marginRight: 6 }} />
          <View>
            <Text style={styles.datePickerLabel}>To Date</Text>
            <Text style={styles.datePickerValue}>
              {endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* KPI Cards Grid */}
      <View style={styles.kpiGrid}>
        <View style={[styles.kpiCard, { borderLeftColor: '#4F46E5' }]}>
          <View style={styles.kpiIconBadgeIndigo}>
            <Icon name="inr" size={14} color="#4F46E5" />
          </View>
          <Text style={styles.kpiLabel}>Total Revenue</Text>
          <Text style={styles.kpiValue}>₹{totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Text>
        </View>

        <View style={[styles.kpiCard, { borderLeftColor: '#10B981' }]}>
          <View style={styles.kpiIconBadgeGreen}>
            <Icon name="shopping-bag" size={13} color="#10B981" />
          </View>
          <Text style={styles.kpiLabel}>Orders Placed</Text>
          <Text style={styles.kpiValue}>{totalOrders}</Text>
        </View>

        <View style={[styles.kpiCard, { borderLeftColor: '#F59E0B' }]}>
          <View style={styles.kpiIconBadgeAmber}>
            <Icon name="cubes" size={13} color="#F59E0B" />
          </View>
          <Text style={styles.kpiLabel}>Units Sold</Text>
          <Text style={styles.kpiValue}>{totalUnits}</Text>
        </View>

        <View style={[styles.kpiCard, { borderLeftColor: '#06B6D4' }]}>
          <View style={styles.kpiIconBadgeCyan}>
            <Icon name="line-chart" size={13} color="#06B6D4" />
          </View>
          <Text style={styles.kpiLabel}>Avg Order Value</Text>
          <Text style={styles.kpiValue}>₹{Math.round(avgOrderValue).toLocaleString('en-IN')}</Text>
        </View>
      </View>

      {/* Loading state indicator */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Compiling hourly sales & product data...</Text>
        </View>
      ) : validOrders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Icon name="bar-chart" size={40} color="#CBD5E1" style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>No Sales in This Date Range</Text>
          <Text style={styles.emptySubtitle}>
            There are no recorded orders between {startDate.toLocaleDateString()} and {endDate.toLocaleDateString()}. Try selecting a wider date range or "Today".
          </Text>
        </View>
      ) : (
        <>
          {/* ======================================================== */}
          {/* SECTION 1: HOURLY SALES RUSH CHART (BAR/COLUMN CHART)    */}
          {/* ======================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="clock-o" size={16} color="#007AFF" style={{ marginRight: 6 }} />
                  <Text style={styles.cardTitle}>Hourly Sales Distribution</Text>
                </View>
                <Text style={styles.cardSubtitle}>Hour-by-hour sales spikes & peak rush periods</Text>
              </View>
              {peakHourInfo && (
                <View style={styles.peakBadge}>
                  <Text style={styles.peakBadgeText}>
                    🔥 Peak: {peakHourInfo.label} (₹{Math.round(peakHourInfo.revenue)})
                  </Text>
                </View>
              )}
            </View>

            {/* Interactive SVG Bar Chart */}
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.chartScroll}>
              {(() => {
                const chartHeight = 170;
                const barWidth = 26;
                const barGap = 12;
                const topPadding = 24;
                const bottomPadding = 30;
                const innerHeight = chartHeight - topPadding - bottomPadding;
                const totalChartWidth = Math.max(SCREEN_WIDTH - 60, 24 * (barWidth + barGap) + 30);

                return (
                  <Svg width={totalChartWidth} height={chartHeight}>
                    {/* Horizontal Baseline */}
                    <Line
                      x1={10}
                      y1={chartHeight - bottomPadding}
                      x2={totalChartWidth - 10}
                      y2={chartHeight - bottomPadding}
                      stroke="#E2E8F0"
                      strokeWidth={1}
                    />

                    {hourlyData.map((item, idx) => {
                      const x = 16 + idx * (barWidth + barGap);
                      const isPeak = peakHourInfo && peakHourInfo.hour === item.hour;
                      const hasSales = item.revenue > 0;
                      const barH = maxHourlyRevenue > 0
                        ? Math.max(hasSales ? 6 : 2, (item.revenue / maxHourlyRevenue) * innerHeight)
                        : 2;
                      const y = chartHeight - bottomPadding - barH;
                      const isSelected = selectedHourDetails?.hour === item.hour;

                      return (
                        <G key={`bar-${item.hour}`}>
                          {/* Bar Background Track */}
                          <Rect
                            x={x}
                            y={topPadding}
                            width={barWidth}
                            height={innerHeight}
                            fill={isSelected ? '#EEF2FF' : '#F8FAFC'}
                            rx={4}
                            onPress={() => setSelectedHourDetails(item)}
                          />

                          {/* Data Bar */}
                          <Rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barH}
                            fill={isPeak ? '#F59E0B' : hasSales ? '#4F46E5' : '#E2E8F0'}
                            rx={4}
                            onPress={() => setSelectedHourDetails(item)}
                          />

                          {/* Top Amount Label for High Bars */}
                          {hasSales && (
                            <SvgText
                              x={x + barWidth / 2}
                              y={y - 6}
                              fontSize={9}
                              fontWeight="700"
                              fill={isPeak ? '#D97706' : '#4338CA'}
                              textAnchor="middle"
                            >
                              ₹{Math.round(item.revenue)}
                            </SvgText>
                          )}

                          {/* Hour Label */}
                          <SvgText
                            x={x + barWidth / 2}
                            y={chartHeight - 10}
                            fontSize={10}
                            fontWeight={hasSales ? '700' : '400'}
                            fill={hasSales ? '#0F172A' : '#94A3B8'}
                            textAnchor="middle"
                          >
                            {idx % 2 === 0 ? formatHourLabel(item.hour) : ''}
                          </SvgText>
                        </G>
                      );
                    })}
                  </Svg>
                );
              })()}
            </ScrollView>

            {/* Selected Hour Insight Card */}
            {selectedHourDetails && (
              <View style={styles.selectedDetailBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="info-circle" size={13} color="#4F46E5" style={{ marginRight: 6 }} />
                    <Text style={styles.selectedDetailTitle}>
                      Hour: {selectedHourDetails.label} - {formatHourLabel(selectedHourDetails.hour + 1)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedHourDetails(null)}>
                    <Icon name="times-circle" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <View style={styles.selectedDetailRow}>
                  <Text style={styles.selectedDetailStat}>
                    Revenue: <Text style={{ fontWeight: '800', color: '#0F172A' }}>₹{selectedHourDetails.revenue.toFixed(2)}</Text>
                  </Text>
                  <Text style={styles.selectedDetailStat}>
                    Orders: <Text style={{ fontWeight: '800', color: '#0F172A' }}>{selectedHourDetails.ordersCount}</Text>
                  </Text>
                  <Text style={styles.selectedDetailStat}>
                    Units: <Text style={{ fontWeight: '800', color: '#0F172A' }}>{selectedHourDetails.units}</Text>
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* ======================================================== */}
          {/* SECTION 2: PRODUCT SALES SHARE (DONUT / PIE CHART)       */}
          {/* ======================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name={chartType === 'donut' ? 'circle-o' : 'pie-chart'} size={16} color="#10B981" style={{ marginRight: 6 }} />
                  <Text style={styles.cardTitle}>Product Sales Contribution</Text>
                </View>
                <Text style={styles.cardSubtitle}>
                  {chartType === 'donut' ? 'Donut view with center summary' : 'Pie view with angular distribution'}
                </Text>
              </View>

              {/* Chart Mode Toggle: Donut vs Pie */}
              <View style={styles.chartToggleContainer}>
                <TouchableOpacity
                  style={[styles.chartToggleBtn, chartType === 'donut' && styles.chartToggleBtnActive]}
                  onPress={() => setChartType('donut')}
                  activeOpacity={0.8}
                >
                  <Icon
                    name="dot-circle-o"
                    size={11}
                    color={chartType === 'donut' ? '#FFFFFF' : '#64748B'}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.chartToggleBtnText, chartType === 'donut' && styles.chartToggleBtnTextActive]}>
                    Donut
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.chartToggleBtn, chartType === 'pie' && styles.chartToggleBtnActive]}
                  onPress={() => setChartType('pie')}
                  activeOpacity={0.8}
                >
                  <Icon
                    name="pie-chart"
                    size={11}
                    color={chartType === 'pie' ? '#FFFFFF' : '#64748B'}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.chartToggleBtnText, chartType === 'pie' && styles.chartToggleBtnTextActive]}>
                    Pie
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Donut / Pie Chart SVG */}
            <View style={styles.donutCenterWrapper}>
              <Svg width={220} height={220} viewBox="0 0 220 220">
                <G transform="translate(110, 110)">
                  {donutSlices.length === 1 && donutSlices[0].share >= 99 ? (
                    // Single product edge-case
                    chartType === 'donut' ? (
                      <Circle
                        cx={0}
                        cy={0}
                        r={65}
                        stroke={donutSlices[0].color}
                        strokeWidth={32}
                        fill="none"
                      />
                    ) : (
                      <Circle
                        cx={0}
                        cy={0}
                        r={82}
                        fill={donutSlices[0].color}
                      />
                    )
                  ) : (
                    donutSlices.map((slice) => {
                      if (slice.startAngle === slice.endAngle) return null;
                      const isSelected = selectedProductDetails?.id === slice.id;
                      const outerRadius = isSelected ? 86 : 82;
                      const innerRadius = isSelected ? 48 : 50;
                      const path = chartType === 'donut'
                        ? describeDonutSlice(0, 0, innerRadius, outerRadius, slice.startAngle, slice.endAngle)
                        : describePieSlice(0, 0, outerRadius, slice.startAngle, slice.endAngle);

                      return (
                        <Path
                          key={`slice-${slice.id}`}
                          d={path}
                          fill={slice.color}
                          stroke={isSelected ? '#0F172A' : '#FFFFFF'}
                          strokeWidth={isSelected ? 3 : 2}
                          onPress={() => setSelectedProductDetails(isSelected ? null : slice)}
                        />
                      );
                    })
                  )}

                  {/* Inner Cutout Center Label (Displayed in Donut View) */}
                  {chartType === 'donut' && (
                    <>
                      <Circle cx={0} cy={0} r={46} fill="#FFFFFF" />
                      <SvgText
                        x={0}
                        y={-8}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight="700"
                        fill="#64748B"
                      >
                        {selectedProductDetails ? 'SELECTED' : 'TOTAL SALES'}
                      </SvgText>
                      <SvgText
                        x={0}
                        y={10}
                        textAnchor="middle"
                        fontSize={selectedProductDetails ? 13 : 14}
                        fontWeight="800"
                        fill="#0F172A"
                      >
                        ₹{Math.round(selectedProductDetails ? selectedProductDetails.revenue : totalRevenue).toLocaleString('en-IN')}
                      </SvgText>
                      {selectedProductDetails && (
                        <SvgText
                          x={0}
                          y={23}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight="700"
                          fill="#4F46E5"
                        >
                          {selectedProductDetails.share}% share
                        </SvgText>
                      )}
                    </>
                  )}
                </G>
              </Svg>
            </View>

            {/* Selected Product Details Card */}
            {selectedProductDetails && (
              <View style={[styles.selectedProductCard, { borderLeftColor: selectedProductDetails.color || '#4F46E5' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.selectedProdCardName} numberOfLines={1}>
                      {selectedProductDetails.name} {selectedProductDetails.variant ? `(${selectedProductDetails.variant})` : ''}
                    </Text>
                    <Text style={styles.selectedProdCardShare}>
                      {selectedProductDetails.share}% contribution to period revenue
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedProductDetails(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Icon name="times-circle" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                <View style={styles.selectedProdStatsRow}>
                  <View style={styles.selectedProdStatCol}>
                    <Text style={styles.selectedProdStatLabel}>REVENUE</Text>
                    <Text style={styles.selectedProdStatVal}>
                      ₹{selectedProductDetails.revenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.selectedProdStatCol}>
                    <Text style={styles.selectedProdStatLabel}>UNITS SOLD</Text>
                    <Text style={styles.selectedProdStatVal}>{selectedProductDetails.units}</Text>
                  </View>
                  <View style={styles.selectedProdStatCol}>
                    <Text style={styles.selectedProdStatLabel}>AVG / UNIT</Text>
                    <Text style={styles.selectedProdStatVal}>
                      ₹{selectedProductDetails.units > 0
                        ? Math.round(selectedProductDetails.revenue / selectedProductDetails.units).toLocaleString('en-IN')
                        : '0'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Donut / Pie Color Legend */}
            <View style={styles.legendContainer}>
              {donutSlices.map((item) => {
                const isSelected = selectedProductDetails?.id === item.id;
                return (
                  <TouchableOpacity
                    key={`legend-${item.id}`}
                    style={[styles.legendItem, isSelected && styles.legendItemActive]}
                    onPress={() => setSelectedProductDetails(isSelected ? null : item)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.legendColorDot, { backgroundColor: item.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.legendProdName, isSelected && { color: '#007AFF' }]} numberOfLines={1}>
                        {item.name} {item.variant ? `(${item.variant})` : ''}
                      </Text>
                      <Text style={styles.legendProdSub}>
                        {item.units} sold • ₹{Math.round(item.revenue).toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <View style={[styles.legendShareBadge, isSelected && styles.legendShareBadgeActive]}>
                      <Text style={[styles.legendShareText, isSelected && styles.legendShareTextActive]}>
                        {item.share}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ======================================================== */}
          {/* SECTION 3: TOP PRODUCTS RANKING TABLE                     */}
          {/* ======================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="trophy" size={16} color="#F59E0B" style={{ marginRight: 6 }} />
                  <Text style={styles.cardTitle}>Product Sales Ranking</Text>
                </View>
                <Text style={styles.cardSubtitle}>Complete breakdown of items sold in this period</Text>
              </View>
            </View>

            {productList.map((prod, idx) => {
              const maxProdRev = productList[0]?.revenue || 1;
              const barPercent = Math.min(100, Math.round((prod.revenue / maxProdRev) * 100));

              return (
                <View key={`rank-${prod.id}`} style={styles.rankItemRow}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={styles.rankProdName} numberOfLines={1}>
                        {prod.name} {prod.variant ? `• ${prod.variant}` : ''}
                      </Text>
                      <Text style={styles.rankProdRev}>
                        ₹{prod.revenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </Text>
                    </View>

                    {/* Progress Bar representing relative contribution */}
                    <View style={styles.rankProgressTrack}>
                      <View
                        style={[
                          styles.rankProgressBar,
                          {
                            width: `${barPercent}%`,
                            backgroundColor: idx === 0 ? '#10B981' : idx === 1 ? '#4F46E5' : '#F59E0B',
                          },
                        ]}
                      />
                    </View>

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={styles.rankUnitsText}>{prod.units} units sold</Text>
                      <Text style={styles.rankPercentText}>
                        {totalRevenue > 0 ? ((prod.revenue / totalRevenue) * 100).toFixed(1) : '0'}% of total sales
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Start Date Picker Modal */}
      <UniversalDateTimePicker
        isVisible={isStartDatePickerVisible}
        mode="date"
        date={startDate}
        onConfirm={(d) => {
          setStartDatePickerVisible(false);
          const newStart = new Date(d);
          newStart.setHours(0, 0, 0, 0);
          setStartDate(newStart);
          setSelectedPreset('custom');
        }}
        onCancel={() => setStartDatePickerVisible(false)}
      />

      {/* End Date Picker Modal */}
      <UniversalDateTimePicker
        isVisible={isEndDatePickerVisible}
        mode="date"
        date={endDate}
        onConfirm={(d) => {
          setEndDatePickerVisible(false);
          const newEnd = new Date(d);
          newEnd.setHours(23, 59, 59, 999);
          setEndDate(newEnd);
          setSelectedPreset('custom');
        }}
        onCancel={() => setEndDatePickerVisible(false)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  topToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  screenHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  screenSubheading: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
    marginLeft: 5,
  },
  presetScrollWrapper: {
    marginBottom: 10,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  presetChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  datePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  datePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  dateArrowBox: {
    paddingHorizontal: 8,
  },
  datePickerLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  datePickerValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiIconBadgeIndigo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiIconBadgeGreen: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiIconBadgeAmber: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiIconBadgeCyan: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ECFEFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  peakBadge: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  peakBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  chartScroll: {
    marginVertical: 4,
  },
  selectedDetailBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginTop: 10,
  },
  selectedDetailTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
  },
  selectedDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  selectedDetailStat: {
    fontSize: 11,
    color: '#64748B',
  },
  chartToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chartToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chartToggleBtnActive: {
    backgroundColor: '#10B981',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  chartToggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  chartToggleBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  selectedProductCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    padding: 12,
    marginVertical: 10,
  },
  selectedProdCardName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  selectedProdCardShare: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  selectedProdStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  selectedProdStatCol: {
    flex: 1,
  },
  selectedProdStatLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  selectedProdStatVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  legendItemActive: {
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    paddingHorizontal: 6,
  },
  legendShareBadgeActive: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  legendShareTextActive: {
    color: '#15803D',
    fontWeight: '800',
  },
  donutCenterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  legendContainer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  legendColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  legendProdName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  legendProdSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  legendShareBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  legendShareText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  rankItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  rankProdName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  rankProdRev: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  rankProgressTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 2,
  },
  rankProgressBar: {
    height: '100%',
    borderRadius: 3,
  },
  rankUnitsText: {
    fontSize: 11,
    color: '#64748B',
  },
  rankPercentText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  loadingBox: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#64748B',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default SellerSalesReport;
