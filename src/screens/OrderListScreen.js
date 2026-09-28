import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Linking,
  Platform,
  Modal,
  Image,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { getOrders, deleteOrder, updateOrderPaymentStatus, supabase, getActiveQrCode } from '../services/supabase';
import { printReceipt, extractOrderNumbers, announceOrderPrint } from '../services/printerService';
import { getGuestOrderIds } from '../services/localStorageService';
import { getActiveEmployeeSession } from '../services/employeeService';
import Icon from 'react-native-vector-icons/FontAwesome';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import UniversalDateTimePicker from '../components/UniversalDateTimePicker';
import { showAlert } from '../utils/alertUtils';
import { downloadQrCodeImage } from '../utils/qrDownloadUtils';
import StoreNavigationFooter from '../components/StoreNavigationFooter';
import SellerSalesReport from '../components/SellerSalesReport';
import SellerPnLReport from '../components/SellerPnLReport';
import { useCart } from '../context/CartContext';
import {
  generateQrDataUrl,
  buildUpiPaymentUri,
  buildAndroidIntentUri,
  normalizeUpiId,
  isGenericQrName,
  resolveUploadedQrDetails,
  formatUpiTransactionNote,
} from '../services/qrScanService';

const OrderListScreen = ({ navigation, route }) => {
  const { sellerId, sellerName, customerId } = route?.params || {};
  const { role: contextRole } = useCart();
  const [activeMainTab, setActiveMainTab] = useState(
    route?.params?.initialTab === 'pnl'
      ? 'pnl'
      : route?.params?.initialTab === 'report'
      ? 'report'
      : 'orders'
  );
  const [orders, setOrders] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(contextRole || null);
  const [sectionedOrders, setSectionedOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBarcodeScannerEnabled, setIsBarcodeScannerEnabled] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  // Synchronized refs to prevent infinite re-render / fetch loops
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const userRoleRef = useRef(userRole);
  userRoleRef.current = userRole;

  const isFetchingRef = useRef(false);
  const fetchOrdersRef = useRef(null);

  const [selectedQrOrder, setSelectedQrOrder] = useState(null);
  const [modalSellerUpiId, setModalSellerUpiId] = useState('');
  const [modalDynamicQrUri, setModalDynamicQrUri] = useState('');
  const [modalDynamicQrDataUrl, setModalDynamicQrDataUrl] = useState(null);
  const [loadingModalQr, setLoadingModalQr] = useState(false);
  const [isDownloadingModalQr, setIsDownloadingModalQr] = useState(false);
  const [copiedModalUpi, setCopiedModalUpi] = useState(false);

  // Quick Direct Sale (Counter / Direct UPI) State
  const [quickSaleModalVisible, setQuickSaleModalVisible] = useState(false);
  const [quickSaleAmount, setQuickSaleAmount] = useState('');
  const [quickSaleMethod, setQuickSaleMethod] = useState('upi'); // 'upi' | 'cash' | 'card'
  const [quickSaleUpiRef, setQuickSaleUpiRef] = useState('');
  const [quickSaleNote, setQuickSaleNote] = useState('');
  const [quickSaleCustomerMobile, setQuickSaleCustomerMobile] = useState('');
  const [quickSaleType, setQuickSaleType] = useState('takeaway'); // 'takeaway' | 'dine_in'
  const [isRecordingQuickSale, setIsRecordingQuickSale] = useState(false);

  const openQuickSaleModal = useCallback(() => {
    setQuickSaleAmount('');
    setQuickSaleMethod('upi');
    setQuickSaleUpiRef('');
    setQuickSaleNote('');
    setQuickSaleCustomerMobile('');
    setQuickSaleType('takeaway');
    setQuickSaleModalVisible(true);
  }, []);

  const handleQuickAddAmount = (addValue) => {
    setQuickSaleAmount((prev) => {
      const current = Number(prev) || 0;
      return String(current + addValue);
    });
  };

  const handleRecordQuickSale = async () => {
    const parsedAmt = Number(quickSaleAmount);
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      showAlert('Invalid Amount', 'Please enter a valid sale amount greater than 0.');
      return;
    }

    setIsRecordingQuickSale(true);
    try {
      const activeUser = currentUserRef.current;
      const targetStoreId = effectiveSellerId || sellerId || activeUser?.id;
      if (!targetStoreId) {
        throw new Error('Unable to identify store. Please ensure you are logged in as a seller or staff.');
      }

      const generatedPayCode = `POS-${Math.floor(100000 + Math.random() * 900000)}`;
      const paymentRef = quickSaleUpiRef?.trim()
        ? quickSaleUpiRef.trim()
        : quickSaleMethod === 'upi'
        ? `UPI-${Math.floor(100000 + Math.random() * 900000)}`
        : generatedPayCode;

      const orderUserId = activeUser?.id || targetStoreId;
      const billedBy = isEmployee ? (employeeSession?.name || 'Staff') : 'Store Owner';
      const saleDescription = quickSaleNote?.trim()
        ? quickSaleNote.trim()
        : quickSaleMethod === 'upi'
        ? 'Direct Counter UPI Sale'
        : 'Direct Counter Cash Sale';

      const orderPayload = {
        user_id: orderUserId,
        seller_id: targetStoreId,
        total_amount: parsedAmt,
        status: 'delivered',
        payment_method: quickSaleMethod,
        payment_status: 'paid',
        payment_reference: paymentRef,
        order_type: 'pos',
        table_no: quickSaleType === 'dine_in' ? 'Table' : 'Counter',
        shipping_address: {
          name: 'Counter Customer',
          mobile: quickSaleCustomerMobile?.trim() || '',
          address: 'In-store Direct Sale',
          notes: saleDescription,
          billed_by: billedBy,
          is_quick_sale: true,
        },
      };

      let res = await supabase.from('orders').insert(orderPayload).select().single();
      let order = res.data;
      let orderError = res.error;

      if (orderError && (orderError.code === 'PGRST204' || (orderError.message && orderError.message.includes('column')))) {
        const fallback = {
          user_id: orderUserId,
          seller_id: targetStoreId,
          total_amount: parsedAmt,
          status: 'delivered',
          payment_method: quickSaleMethod,
          payment_reference: paymentRef,
          order_type: 'shop-order',
          table_no: 'Counter',
          shipping_address: {
            name: 'Counter Customer',
            mobile: quickSaleCustomerMobile?.trim() || '',
            address: 'In-store Direct Sale',
            notes: saleDescription,
          },
        };
        if (orderError.message && orderError.message.includes('payment_reference')) {
          delete fallback.payment_reference;
        }
        const retry = await supabase.from('orders').insert(fallback).select().single();
        order = retry.data;
        orderError = retry.error;
      }

      if (orderError) {
        console.error('Error inserting quick sale:', orderError);
        throw orderError;
      }

      setQuickSaleModalVisible(false);
      showAlert(
        'Sale Recorded! 🎉',
        `₹${parsedAmt.toFixed(2)} recorded via ${quickSaleMethod.toUpperCase()}.\nOrder Ref: #${paymentRef}`
      );

      if (fetchOrdersRef.current) {
        fetchOrdersRef.current(true);
      }
    } catch (err) {
      console.error('Record quick sale error:', err);
      showAlert('Error', err.message || 'Failed to record direct sale.');
    } finally {
      setIsRecordingQuickSale(false);
    }
  };

  const handleOpenOrderQrModal = async (targetOrder) => {
    setSelectedQrOrder(targetOrder);
    setLoadingModalQr(true);
    setModalDynamicQrDataUrl(null);
    setCopiedModalUpi(false);

    const targetTotal = Number(targetOrder.total_amount || 0);
    const { orderNumber } = extractOrderNumbers(targetOrder);
    const targetSellerId =
      targetOrder.seller_id ||
      targetOrder.order_items?.[0]?.product_variant_combinations?.products?.user_id ||
      sellerId;
    let resolvedUpi = '';
    let qrPayeeName = '';

    if (targetOrder.seller_upi_id && !isGenericQrName(targetOrder.seller_upi_id)) {
      resolvedUpi = normalizeUpiId(targetOrder.seller_upi_id);
    } else if (targetOrder.upi_id && !isGenericQrName(targetOrder.upi_id)) {
      resolvedUpi = normalizeUpiId(targetOrder.upi_id);
    }

    if (!resolvedUpi && targetSellerId) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('upi_id, full_name')
          .eq('id', targetSellerId)
          .maybeSingle();
        if (prof?.upi_id && !isGenericQrName(prof.upi_id)) {
          resolvedUpi = normalizeUpiId(prof.upi_id);
        }
      } catch (_) {}
    }

    // Query user_qr_codes for seller (strictly extracts details from uploaded QR code)
    if (targetSellerId) {
      try {
        const qrData = await getActiveQrCode(targetSellerId);
        if (qrData) {
          const qrDetails = await resolveUploadedQrDetails(qrData);
          if (qrDetails?.upiId) {
            resolvedUpi = qrDetails.upiId;
          }
          if (qrDetails?.payeeName) {
            qrPayeeName = qrDetails.payeeName;
          }
        }
      } catch (_) {}
    }

    setModalSellerUpiId(resolvedUpi);

    const paymentRefCode =
      extractOrderNumbers(selectedQrOrder).paymentReference ||
      selectedQrOrder?.payment_reference ||
      (typeof selectedQrOrder?.shipping_address === 'object' ? selectedQrOrder?.shipping_address?.payment_reference : null);

    const note = formatUpiTransactionNote({
      order: selectedQrOrder,
      orderNumber,
      paymentReference: paymentRefCode,
      uniqueCode: paymentRefCode,
    });

    const uri = buildUpiPaymentUri({
      upiId: resolvedUpi || 'merchant@upi',
      payeeName: qrPayeeName || '',
      amount: targetTotal > 0 ? targetTotal : undefined,
      note,
      tr: paymentRefCode,
    });

    setModalDynamicQrUri(uri);

    try {
      const dataUrl = await generateQrDataUrl(uri, { width: 350, margin: 2 });
      setModalDynamicQrDataUrl(dataUrl);
    } catch (_) {}

    setLoadingModalQr(false);
  };

  const handleDownloadModalQr = async () => {
    if (!selectedQrOrder) return;
    const { orderNumber } = extractOrderNumbers(selectedQrOrder);
    const targetTotal = Number(selectedQrOrder.total_amount || 0);
    const qrSrc =
      modalDynamicQrDataUrl ||
      `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(modalDynamicQrUri)}`;
    setIsDownloadingModalQr(true);
    try {
      const fileName = `Order-${orderNumber}-Payment-QR-Rs${Math.round(targetTotal)}`;
      await downloadQrCodeImage(qrSrc, fileName);
    } catch (err) {
      showAlert('Download Error', 'Could not save QR code: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDownloadingModalQr(false);
    }
  };

  const handleCopyModalUpi = async () => {
    if (!modalSellerUpiId) return;
    try {
      await Clipboard.setStringAsync(modalSellerUpiId);
      setCopiedModalUpi(true);
      setTimeout(() => setCopiedModalUpi(false), 2000);
      showAlert('Copied', `UPI ID ${modalSellerUpiId} copied to clipboard.`);
    } catch (_) {}
  };

  const handleOpenModalUpiApp = async (appId = 'any') => {
    if (!modalDynamicQrUri || !selectedQrOrder) return;
    try {
      if (Platform.OS === 'android') {
        const intentUri = buildAndroidIntentUri(modalDynamicQrUri, appId);
        const can = await Linking.canOpenURL(intentUri);
        if (can) {
          await Linking.openURL(intentUri);
          return;
        }
      }
      const can = await Linking.canOpenURL(modalDynamicQrUri);
      if (can) {
        await Linking.openURL(modalDynamicQrUri);
      } else {
        showAlert(
          'Pay via UPI',
          `Pay to:\n${modalSellerUpiId || 'Store'}\nAmount: ₹${Number(selectedQrOrder.total_amount || 0).toFixed(2)}`
        );
      }
    } catch (_) {}
  };

  const routeIsEmployee = route?.params?.isEmployee || route?.params?.role === 'seller_employee';
  const routePermissions = route?.params?.permissions;
  const [employeeSession, setEmployeeSession] = useState(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const emp = await getActiveEmployeeSession();
        if (isMounted && emp) setEmployeeSession(emp);
      } catch (_) {}
    })();
    return () => { isMounted = false; };
  }, []);

  const isEmployee = Boolean(routeIsEmployee || employeeSession);
  const permissions = (routePermissions && typeof routePermissions === 'object')
    ? routePermissions
    : (employeeSession?.permissions || {});
  const effectiveSellerId = sellerId || employeeSession?.seller_id;

  useEffect(() => {
    if (contextRole) {
      setUserRole(contextRole);
      userRoleRef.current = contextRole;
    }
  }, [contextRole]);

  const canManageOrders = userRole === 'seller' || userRole === 'admin' || userRole === 'superadmin' || (isEmployee && permissions.can_manage_orders !== false);

  const checkBarcodeScannerSetting = useCallback(async (currUser) => {
    try {
      const activeUser = currUser || currentUserRef.current;
      const storeId = effectiveSellerId || sellerId || (canManageOrders ? activeUser?.id : null);
      if (!storeId) {
        setIsBarcodeScannerEnabled(false);
        return;
      }

      const { data: storeProf, error } = await supabase
        .from('profiles')
        .select('enable_order_barcode_scanner')
        .eq('id', storeId)
        .maybeSingle();

      if (!error && storeProf && storeProf.enable_order_barcode_scanner !== undefined) {
        setIsBarcodeScannerEnabled(Boolean(storeProf.enable_order_barcode_scanner));
        return;
      }

      if (activeUser?.id === storeId && activeUser?.user_metadata?.enable_order_barcode_scanner !== undefined) {
        setIsBarcodeScannerEnabled(Boolean(activeUser.user_metadata.enable_order_barcode_scanner));
      }
    } catch (err) {
      console.warn('Error checking store barcode scanner preference:', err);
    }
  }, [effectiveSellerId, sellerId, canManageOrders]);

  const fetchOrders = useCallback(async (isSilent = false) => {
    // Avoid concurrent duplicate requests
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    // Only show full loading spinner on initial cold fetch when no orders are loaded yet
    if (!isSilent && ordersRef.current.length === 0) {
      setLoading(true);
    } else if (isSilent) {
      setIsSyncing(true);
    }

    try {
      // 1. Instant check from local session cache (0 network delay)
      let user = null;
      const { data: { session } = {} } = await supabase.auth.getSession();
      if (session?.user) {
        user = session.user;
      } else {
        const { data: { user: authUser } = {} } = await supabase.auth.getUser();
        user = authUser;
      }

      if (user?.id !== currentUserRef.current?.id) {
        setCurrentUser(user || null);
        currentUserRef.current = user || null;
      }

      let fetchedOrders = [];

      if (!user) {
        // Fallback for unauthenticated guest checkouts (e.g. dine-in QR orders)
        const guestIds = await getGuestOrderIds();
        if (guestIds && guestIds.length > 0) {
          const selectQuery = `
            *,
            order_items (
              id,
              quantity,
              price,
              product_variant_combination_id,
              product_variant_combinations (
                id,
                combination_string,
                price,
                products (
                  id,
                  product_name,
                  user_id,
                  customer_id,
                  product_media (media_url, media_type)
                )
              )
            )
          `;
          const { data: guestOrders, error: guestErr } = await supabase
            .from('orders')
            .select(selectQuery)
            .in('id', guestIds)
            .order('created_at', { ascending: false });

          if (!guestErr && Array.isArray(guestOrders)) {
            fetchedOrders = guestOrders;
          }
        }

        if (fetchedOrders.length === 0) {
          setOrders([]);
          return;
        }
      } else {
        // Authenticated user
        let effectiveRole = isEmployee ? 'seller_employee' : (contextRole || userRoleRef.current);
        if (!effectiveRole) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
          effectiveRole = prof?.role || user.user_metadata?.role || (route?.params?.role === 'seller' ? 'seller' : 'buyer');
          if (userRoleRef.current !== effectiveRole) {
            setUserRole(effectiveRole);
            userRoleRef.current = effectiveRole;
          }
        }

        const isSeller = effectiveRole === 'seller';
        const isAdmin = effectiveRole === 'admin' || effectiveRole === 'superadmin';

        if (isEmployee) {
          // Store staff / cashier views employer store's orders
          const targetStoreId = effectiveSellerId || route?.params?.sellerId || user.id;
          fetchedOrders = await getOrders(targetStoreId, { role: 'seller', isSeller: true });
        } else if (isSeller) {
          // Seller views all orders received by their store
          fetchedOrders = await getOrders(user.id, { role: 'seller', isSeller: true });
        } else if (isAdmin) {
          // Admin views store orders or all orders
          const targetSeller = route?.params?.sellerId;
          if (targetSeller) {
            fetchedOrders = await getOrders(targetSeller, { role: 'seller', isSeller: true });
          } else {
            fetchedOrders = await getOrders(user.id, { role: 'admin' });
          }
        } else {
          // Buyer views strictly their own orders (never seller's store orders)
          fetchedOrders = await getOrders(user.id, { role: 'buyer', isSeller: false });

          // Also check for any guest orders stored locally on this device and merge
          try {
            const guestIds = await getGuestOrderIds();
            if (guestIds && guestIds.length > 0) {
              const existingIds = new Set((fetchedOrders || []).map((o) => o.id));
              const missingGuestIds = guestIds.filter((id) => !existingIds.has(id));
              if (missingGuestIds.length > 0) {
                const selectQuery = `
                  *,
                  order_items (
                    id,
                    quantity,
                    price,
                    product_variant_combination_id,
                    product_variant_combinations (
                      id,
                      combination_string,
                      price,
                      products (
                        id,
                        product_name,
                        user_id,
                        customer_id,
                        product_media (media_url, media_type)
                      )
                    )
                  )
                `;
                const { data: extraGuestOrders, error: guestErr } = await supabase
                  .from('orders')
                  .select(selectQuery)
                  .in('id', missingGuestIds);
                if (!guestErr && Array.isArray(extraGuestOrders) && extraGuestOrders.length > 0) {
                  fetchedOrders = [...(fetchedOrders || []), ...extraGuestOrders].sort(
                    (a, b) => new Date(b.created_at) - new Date(a.created_at)
                  );
                }
              }
            }
          } catch (_) {}
        }
      }

      if (fetchedOrders && Array.isArray(fetchedOrders)) {
        setOrders(fetchedOrders);
      }
    } catch (err) {
      console.warn('Error in fetchOrders:', err);
      if (ordersRef.current.length === 0) {
        setOrders([]);
      }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
      setIsSyncing(false);
    }
  }, [contextRole, isEmployee, effectiveSellerId, route?.params?.sellerId, route?.params?.role]);

  fetchOrdersRef.current = fetchOrders;

  // Immediately load fresh orders on screen focus & start auto-reload interval
  useFocusEffect(
    useCallback(() => {
      fetchOrders(ordersRef.current.length > 0);
      checkBarcodeScannerSetting();

      // Auto-reload orders every 15 seconds in the background
      const intervalId = setInterval(() => {
        fetchOrders(true);
      }, 15000);

      return () => {
        clearInterval(intervalId);
      };
    }, [fetchOrders, checkBarcodeScannerSetting])
  );

  // Realtime Supabase live update listener on orders table
  useEffect(() => {
    const ordersChannel = supabase
      .channel('orders-realtime-list-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          console.log('[OrderListScreen] Realtime order event received:', payload.eventType);
          fetchOrdersRef.current?.(true);
        }
      )
      .subscribe();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        if (currentUserRef.current?.id !== session.user.id) {
          setCurrentUser(session.user);
          currentUserRef.current = session.user;
        }
        fetchOrdersRef.current?.(true);
      } else {
        setCurrentUser(null);
        currentUserRef.current = null;
        setOrders([]);
      }
    });

    return () => {
      supabase.removeChannel(ordersChannel);
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let filtered = orders;

    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      const cleanQuery = query.replace(/[^a-z0-9]/gi, '').toLowerCase();

      filtered = filtered.filter(order => {
        const { orderNumber, rawOrderNumber, dayOrderNo, paymentReference, barcode } = extractOrderNumbers(order);
        let shippingBarcode = '';
        if (typeof order.shipping_address === 'object') {
          shippingBarcode = order.shipping_address?.barcode || '';
        } else if (typeof order.shipping_address === 'string' && order.shipping_address.includes('barcode')) {
          try {
            const parsed = JSON.parse(order.shipping_address);
            shippingBarcode = parsed?.barcode || '';
          } catch (_) {}
        }
        const barcodeVal = String(order.barcode || barcode || shippingBarcode || '').toLowerCase().trim();

        // 1. Raw exact/contains matching
        const rawOrderNum = String(rawOrderNumber || orderNumber || '').toLowerCase();
        const rawDayOrderNo = String(dayOrderNo || '').toLowerCase();
        const rawId = String(order.id || '').toLowerCase();
        const rawPayRef = String(paymentReference || '').toLowerCase();
        const customerName = String(order.customer_name || '').toLowerCase();
        const tableNo = String(order.table_no || '').toLowerCase();

        const matchRaw =
          (rawOrderNum && rawOrderNum.includes(query)) ||
          (rawDayOrderNo && rawDayOrderNo.includes(query)) ||
          (rawPayRef && rawPayRef.includes(query)) ||
          (rawId && rawId.includes(query)) ||
          (customerName && customerName.includes(query)) ||
          (tableNo && tableNo.includes(query)) ||
          (barcodeVal && (barcodeVal.includes(query) || query.includes(barcodeVal)));

        if (matchRaw) return true;

        // 2. Pure alphanumeric matching (handles user typing '#1', '202609280001', 'ORD1234', camera barcode scanning)
        if (cleanQuery) {
          const cleanOrderNum = rawOrderNum.replace(/[^a-z0-9]/gi, '');
          const cleanDayOrderNo = rawDayOrderNo.replace(/[^a-z0-9]/gi, '');
          const cleanBarcode = barcodeVal.replace(/[^a-z0-9]/gi, '');
          const cleanId = rawId.replace(/[^a-z0-9]/gi, '');
          const cleanPayRef = rawPayRef.replace(/[^a-z0-9]/gi, '');
          const cleanTable = tableNo.replace(/[^a-z0-9]/gi, '');

          const matchClean =
            (cleanOrderNum && cleanOrderNum.includes(cleanQuery)) ||
            (cleanDayOrderNo && (cleanDayOrderNo === cleanQuery || cleanDayOrderNo.includes(cleanQuery))) ||
            (cleanBarcode && (cleanBarcode.includes(cleanQuery) || cleanQuery.includes(cleanBarcode))) ||
            (cleanId && cleanId.includes(cleanQuery)) ||
            (cleanPayRef && cleanPayRef.includes(cleanQuery)) ||
            (cleanTable && cleanTable.includes(cleanQuery));

          if (matchClean) return true;
        }

        return false;
      });
    }

    if (selectedStatus) {
      filtered = filtered.filter(order => {
        const oStatus = (order.status || '').toLowerCase().trim();
        return oStatus === selectedStatus.toLowerCase().trim();
      });
    }

    if (selectedDate) {
      const selDate = new Date(selectedDate);
      const selYear = selDate.getFullYear();
      const selMonth = selDate.getMonth();
      const selDay = selDate.getDate();

      filtered = filtered.filter(order => {
        const dateStr = order.created_at || order.order_date || order.date;
        if (!dateStr) return false;
        const oDate = new Date(dateStr);
        if (isNaN(oDate.getTime())) return false;
        return (
          oDate.getFullYear() === selYear &&
          oDate.getMonth() === selMonth &&
          oDate.getDate() === selDay
        );
      });
    }

    const shopOrders = [];
    const onlineOrders = [];

    filtered.forEach(order => {
      if (order.order_type === 'shop-order') {
        shopOrders.push(order);
      } else {
        onlineOrders.push(order);
      }
    });

    const sections = [];
    if (shopOrders.length > 0) {
      sections.push({ title: 'Shop Orders', data: shopOrders });
    }
    if (onlineOrders.length > 0) {
      sections.push({ title: 'Online Orders', data: onlineOrders });
    }
    
    setSectionedOrders(sections);

  }, [searchQuery, selectedStatus, selectedDate, orders]);

  useEffect(() => {
    const total = sectionedOrders.reduce((sum, section) => {
      return sum + section.data.reduce((sectionSum, order) => sectionSum + Number(order.total_amount || 0), 0);
    }, 0);
    setTotalAmount(total);
  }, [sectionedOrders]);

  const showDatePicker = () => {
    setDatePickerVisibility(true);
  };

  const hideDatePicker = () => {
    setDatePickerVisibility(false);
  };

  const handleConfirmDate = (date) => {
    setSelectedDate(date);
    hideDatePicker();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrders(true);
    setRefreshing(false);
  };

  const handleTogglePaymentStatus = async (orderId, currentPaidStatus, payCode) => {
    if (!canManageOrders) {
      showAlert('Access Denied', 'Only store managers and sellers can verify payments.');
      return;
    }
    const nextStatus = currentPaidStatus ? 'pending' : 'paid';
    const codeDisplay = payCode ? ` (Code: ${payCode})` : '';

    showAlert(
      'Verify Payment',
      `Do you want to mark Order${codeDisplay} payment as "${nextStatus === 'paid' ? 'DONE (PAID)' : 'PENDING'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'paid' ? 'Mark Paid' : 'Mark Pending',
          onPress: async () => {
            // Optimistically update in local state for instant UI response
            setOrders(prev =>
              prev.map(o => {
                if (o.id === orderId) {
                  const updated = { ...o, payment_status: nextStatus };
                  if (nextStatus === 'paid' && (o.status || '').toLowerCase() === 'pending_payment') {
                    updated.status = 'processing';
                  }
                  return updated;
                }
                return o;
              })
            );
            const updated = await updateOrderPaymentStatus(orderId, nextStatus);
            if (!updated) {
              fetchOrders(true);
              showAlert('Error', 'Failed to update payment status.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteOrder = async (orderId) => {
    if (!canManageOrders) {
      showAlert('Access Denied', 'Buyers are not permitted to delete orders.');
      return;
    }
    showAlert(
      'Delete Order',
      'Are you sure you want to delete this order? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await deleteOrder(orderId);
            if (success) {
              showAlert('Success', 'Order deleted successfully.');
              fetchOrders();
            } else {
              showAlert('Error', 'Failed to delete order.');
            }
          },
        },
      ]
    );
  };

  const openMapsDirections = (shippingAddress) => {
    if (!shippingAddress) {
      showAlert('No Address', 'This order has no delivery address.');
      return;
    }
    const parts = [
      shippingAddress.address,
      shippingAddress.city,
      shippingAddress.postalCode,
      shippingAddress.country,
    ].filter(Boolean);
    if (parts.length === 0) {
      showAlert('No Address', 'This order has no delivery address.');
      return;
    }
    const query = encodeURIComponent(parts.join(', '));
    const url = `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    Linking.openURL(url).catch(() => {
      showAlert('Error', 'Could not open maps. Please check if Google Maps is installed.');
    });
  };

  const formatOrderStatus = (status) => {
    if (!status) return 'Pending';
    const s = String(status).toLowerCase().trim();
    if (s === 'pending_payment') return 'Payment Pending';
    if (s === 'out_for_delivery') return 'Out for Delivery';
    return s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getOrderStatusColor = (status) => {
    const s = String(status || '').toLowerCase().trim();
    if (s === 'pending_payment') return '#D97706';
    if (s === 'completed' || s === 'delivered') return '#16A34A';
    if (s === 'cancelled') return '#DC2626';
    if (s === 'processing' || s === 'shipped' || s === 'out_for_delivery') return '#4F46E5';
    return '#007AFF';
  };

  const renderOrderItem = ({ item }) => {
    const { orderNumber, dayOrderNo, paymentReference, barcode } = extractOrderNumbers(item);
    const isPaymentDone = (item.payment_status === 'paid' || item.status === 'completed' || item.status === 'paid');

    return (
      <TouchableOpacity
        style={styles.orderItem}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id, sellerId, sellerName, customerId })}
        activeOpacity={0.88}
      >
        <View style={styles.orderHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderId}>Order No: {orderNumber}</Text>
            {dayOrderNo ? (
              <Text style={styles.dayOrderId}>Day Order No: #{dayOrderNo}</Text>
            ) : null}
            {barcode && barcode !== orderNumber ? (
              <Text style={styles.orderBarcodeText}>Barcode: {barcode}</Text>
            ) : null}
          </View>
          <Text style={[styles.orderStatus, { color: getOrderStatusColor(item.status) }]}>
            Status: {formatOrderStatus(item.status)}
          </Text>
        </View>

        {/* 6-Digit Payment Code & Verification Status Pill */}
        <View style={styles.paymentMetaRow}>
          {paymentReference ? (
            <View style={styles.payCodeBadge}>
              <Icon name="tag" size={12} color="#4F46E5" style={{ marginRight: 5 }} />
              <Text style={styles.payCodeLabel}>6-Digit Pay Code:</Text>
              <Text style={styles.payCodeValue}>{paymentReference}</Text>
            </View>
          ) : null}

          <View style={[styles.paymentStatusBadge, isPaymentDone ? styles.paymentStatusPaid : styles.paymentStatusPending]}>
            <Icon
              name={isPaymentDone ? "check-circle" : "clock-o"}
              size={11}
              color={isPaymentDone ? "#16A34A" : "#D97706"}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.paymentStatusText, isPaymentDone ? styles.textPaid : styles.textPending]}>
              {isPaymentDone ? 'Payment Done' : 'Payment Pending'}
            </Text>
          </View>
        </View>

        <View style={styles.orderPriceRow}>
          <Text style={styles.orderAmount}>Total: ₹{Number(item.total_amount || 0).toFixed(2)}</Text>
          {item.payment_method ? (
            <Text style={styles.paymentMethodText}>
              • {String(item.payment_method).toUpperCase()}
            </Text>
          ) : null}
        </View>

        <Text style={styles.orderDate}>
          Date: {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {item.table_no && <Text style={styles.orderDate}>Table No: {item.table_no}</Text>}
        {item.customer_name ? (
          <Text style={styles.orderCustomer}>
            Customer: {item.customer_name} {item.customer_mobile ? `• ${item.customer_mobile}` : ''}
          </Text>
        ) : null}

        <View style={styles.actionButtons}>
          {/* Quick Payment Verification Toggle for Sellers and Admins */}
          {canManageOrders && (
            <TouchableOpacity
              onPress={() => handleTogglePaymentStatus(item.id, isPaymentDone, paymentReference)}
              style={[
                styles.quickPayActionBtn,
                isPaymentDone ? styles.quickPayBtnDone : styles.quickPayBtnVerify
              ]}
              accessibilityLabel={isPaymentDone ? "Mark payment pending" : "Verify payment done"}
              activeOpacity={0.8}
            >
              <Icon
                name={isPaymentDone ? "undo" : "check"}
                size={12}
                color={isPaymentDone ? "#64748B" : "#16A34A"}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.quickPayActionBtnText, isPaymentDone ? styles.quickPayTextDone : styles.quickPayTextVerify]}>
                {isPaymentDone ? 'Mark Pending' : 'Verify Paid'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Quick Pay QR Button for Buyer or Seller */}
          <TouchableOpacity
            onPress={() => handleOpenOrderQrModal(item)}
            style={styles.orderPayQrBtn}
            accessibilityLabel="Pay or Download QR"
            activeOpacity={0.8}
          >
            <Icon name="qrcode" size={13} color="#007AFF" style={{ marginRight: 4 }} />
            <Text style={styles.orderPayQrBtnText}>Pay QR</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            onPress={() => announceOrderPrint(item)}
            style={{ marginRight: 8 }}
            accessibilityLabel="Announce Order Aloud"
          >
            <Icon name="volume-up" size={20} color="#007AFF" style={styles.actionIcon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => printReceipt(item)}
            style={{ marginRight: 8 }}
            accessibilityLabel="Print Receipt"
          >
            <Icon name="print" size={20} color="#10B981" style={styles.actionIcon} />
          </TouchableOpacity>
          {/* Edit and Delete are strictly restricted to Sellers and Admins */}
          {canManageOrders && (
            <>
              <TouchableOpacity
                onPress={() => navigation.navigate('OrderEdit', { orderId: item.id, sellerId, sellerName, customerId })}
                accessibilityLabel="Edit Order Status"
                style={{ marginRight: 8 }}
              >
                <Icon name="edit" size={20} color="#007AFF" style={styles.actionIcon} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteOrder(item.id)}
                accessibilityLabel="Delete Order"
              >
                <Icon name="trash" size={20} color="#FF3B30" style={styles.actionIcon} />
              </TouchableOpacity>
            </>
          )}
          {item.order_type !== 'shop-order' && item.shipping_address && (
            <TouchableOpacity
              onPress={() => openMapsDirections(item.shipping_address)}
              style={{ marginLeft: 8 }}
              accessibilityLabel="Get Directions"
            >
              <Icon name="map-marker" size={20} color="#FF9500" style={styles.actionIcon} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && orders.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const isGuest = !loading && !currentUser && orders.length === 0;

  return (
    <View
      style={[
        styles.mainContainer,
        Platform.OS === 'web' && { height: '100%', maxHeight: '100vh', minHeight: 0, overflow: 'hidden' },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ marginRight: 12 }}
            onPress={() => {
              navigation.reset({
                index: 0,
                routes: [{ name: 'Welcome' }],
              });
            }}
          >
            <Icon name="home" size={22} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{userRole === 'seller' ? 'Store Orders' : 'Your Orders'}</Text>
          {isSyncing && (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
          )}
        </View>
        <View style={styles.headerActions}>
          {canManageOrders && (
            <TouchableOpacity
              onPress={openQuickSaleModal}
              style={styles.quickSaleHeaderBtn}
              accessibilityLabel="Quick Direct Sale"
            >
              <Icon name="bolt" size={13} color="#FFFFFF" style={{ marginRight: 4 }} />
              <Text style={styles.quickSaleHeaderBtnText}>+ Quick Sale</Text>
            </TouchableOpacity>
          )}
          {canManageOrders && (
            <TouchableOpacity
              onPress={() => setActiveMainTab((prev) => (prev === 'orders' ? 'report' : 'orders'))}
              style={[styles.salesReportHeaderBtn, activeMainTab === 'report' && styles.salesReportHeaderBtnActive]}
              accessibilityLabel="Toggle Sales Report"
            >
              <Icon
                name={activeMainTab === 'report' ? 'list-alt' : 'bar-chart'}
                size={13}
                color={activeMainTab === 'report' ? '#FFFFFF' : '#007AFF'}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.salesReportHeaderBtnText, activeMainTab === 'report' && styles.salesReportHeaderBtnTextActive]}>
                {activeMainTab === 'report' ? 'Orders' : 'Sales Report'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.refreshHeaderBtn}
            disabled={refreshing || isSyncing}
            accessibilityLabel="Refresh Orders"
          >
            {refreshing || isSyncing ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Icon name="refresh" size={19} color="#007AFF" />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Invoice')} style={{ marginRight: 15 }}>
            <Icon name="file-text" size={22} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else if (sellerId) {
                navigation.navigate('Catalog', { sellerId, sellerName, customerId });
              } else {
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Welcome' }],
                });
              }
            }}
          >
            <Icon name="close" size={22} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      {isGuest ? (
        <View style={styles.notLoggedInContainer}>
          <View style={styles.notLoggedInIconBox}>
            <Icon name="shopping-bag" size={48} color="#007AFF" />
          </View>
          <Text style={styles.notLoggedInTitle}>Sign In to View Orders</Text>
          <Text style={styles.notLoggedInSubtitle}>
            Please sign in to your buyer account to view your active and previous orders.
          </Text>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => navigation.navigate('BuyerLogin', { redirectTo: 'OrderList' })}
          >
            <Icon name="sign-in" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.signInButtonText}>Sign In / Sign Up</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Segmented Top Toggle between Orders, P&L Expenses, and Sales Report (for Sellers & Admins) */}
          {canManageOrders && (
            <View style={styles.mainTabSegmentContainer}>
              <TouchableOpacity
                style={[styles.mainTabSegment, activeMainTab === 'orders' && styles.mainTabSegmentActive]}
                onPress={() => setActiveMainTab('orders')}
                activeOpacity={0.8}
              >
                <Icon
                  name="list-alt"
                  size={13}
                  color={activeMainTab === 'orders' ? '#0F172A' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.mainTabSegmentText, activeMainTab === 'orders' && styles.mainTabSegmentTextActive]}>
                  Orders ({orders.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.mainTabSegment, activeMainTab === 'pnl' && styles.mainTabSegmentActive]}
                onPress={() => setActiveMainTab('pnl')}
                activeOpacity={0.8}
              >
                <Icon
                  name="money"
                  size={13}
                  color={activeMainTab === 'pnl' ? '#059669' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.mainTabSegmentText, activeMainTab === 'pnl' && [styles.mainTabSegmentTextActive, { color: '#059669' }]]}>
                  P&L / Expenses
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.mainTabSegment, activeMainTab === 'report' && styles.mainTabSegmentActive]}
                onPress={() => setActiveMainTab('report')}
                activeOpacity={0.8}
              >
                <Icon
                  name="bar-chart"
                  size={13}
                  color={activeMainTab === 'report' ? '#4F46E5' : '#64748B'}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.mainTabSegmentText, activeMainTab === 'report' && [styles.mainTabSegmentTextActive, { color: '#4F46E5' }]]}>
                  Sales Report
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {canManageOrders && activeMainTab === 'pnl' ? (
            <SellerPnLReport
              sellerId={sellerId || currentUser?.id}
              sellerName={sellerName}
            />
          ) : canManageOrders && activeMainTab === 'report' ? (
            <SellerSalesReport
              sellerId={sellerId || currentUser?.id}
              sellerName={sellerName}
            />
          ) : (
            <>
              <View style={styles.searchContainer}>
                <View style={styles.searchInputRow}>
                  <View style={styles.searchInputWrapper}>
                    <Icon name="search" size={14} color="#94A3B8" style={styles.searchIconLeading} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder={isBarcodeScannerEnabled ? "Search Order No, Barcode, Pay Code..." : "Search by Order No, 6-digit Pay Code..."}
                      placeholderTextColor="#94a3b8"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                    />
                    {Boolean(searchQuery) && (
                      <TouchableOpacity
                        style={styles.clearSearchBtn}
                        onPress={() => setSearchQuery('')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="times-circle" size={16} color="#94A3B8" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {isBarcodeScannerEnabled && canManageOrders && (
                    <TouchableOpacity
                      style={styles.barcodeScanBtn}
                      onPress={() => setShowBarcodeScanner(true)}
                      activeOpacity={0.8}
                      accessibilityLabel="Scan receipt barcode"
                    >
                      <Icon name="barcode" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.barcodeScanBtnText}>Scan</Text>
                    </TouchableOpacity>
                  )}
                  {canManageOrders && (
                    <TouchableOpacity
                      style={styles.quickSaleActionBtn}
                      onPress={openQuickSaleModal}
                      activeOpacity={0.8}
                      accessibilityLabel="Quick Direct Sale"
                    >
                      <Icon name="bolt" size={14} color="#FFFFFF" style={{ marginRight: 5 }} />
                      <Text style={styles.quickSaleActionBtnText}>Quick Sale</Text>
                    </TouchableOpacity>
                  )}
                </View>
            <View style={styles.statusFilterContainer}>
              {[
                { id: null, label: 'All' },
                { id: 'pending_payment', label: 'Payment Pending', isPaymentPending: true },
                { id: 'pending', label: 'Pending' },
                { id: 'processing', label: 'Processing' },
                { id: 'shipped', label: 'Shipped' },
                { id: 'delivered', label: 'Delivered' },
                { id: 'completed', label: 'Completed' },
                { id: 'cancelled', label: 'Cancelled' },
              ].map(tab => {
                const isSelected = selectedStatus === tab.id;
                const count = tab.id
                  ? orders.filter(o => (o.status || '').toLowerCase().trim() === tab.id.toLowerCase().trim()).length
                  : orders.length;

                return (
                  <TouchableOpacity
                    key={tab.id || 'all'}
                    style={[
                      styles.statusButton,
                      isSelected && styles.selectedStatusButton,
                      tab.isPaymentPending && !isSelected && count > 0 && styles.statusButtonPaymentPendingAlert,
                    ]}
                    onPress={() => setSelectedStatus(tab.id)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        isSelected && styles.selectedStatusButtonText,
                        tab.isPaymentPending && !isSelected && count > 0 && styles.statusButtonTextPaymentPendingAlert,
                      ]}
                    >
                      {tab.label}
                      {count > 0 ? ` (${count})` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.dateFilterRow}>
              <TouchableOpacity
                style={[styles.datePickerButton, selectedDate && styles.datePickerButtonActive]}
                onPress={showDatePicker}
                activeOpacity={0.7}
              >
                <Icon
                  name="calendar"
                  size={14}
                  color={selectedDate ? '#007AFF' : '#64748B'}
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.datePickerButtonText, selectedDate && styles.datePickerButtonTextActive]}>
                  {selectedDate
                    ? new Date(selectedDate).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'Filter by Date'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.todayButton,
                  selectedDate &&
                    new Date(selectedDate).toDateString() === new Date().toDateString() &&
                    styles.todayButtonActive,
                ]}
                onPress={() => {
                  if (selectedDate && new Date(selectedDate).toDateString() === new Date().toDateString()) {
                    setSelectedDate(null);
                  } else {
                    setSelectedDate(new Date());
                  }
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.todayButtonText,
                    selectedDate &&
                      new Date(selectedDate).toDateString() === new Date().toDateString() &&
                      styles.todayButtonTextActive,
                  ]}
                >
                  Today
                </Text>
              </TouchableOpacity>

              {selectedDate && (
                <TouchableOpacity
                  onPress={() => setSelectedDate(null)}
                  style={styles.clearDateBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Clear Date Filter"
                >
                  <Icon name="times-circle" size={18} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>

            <UniversalDateTimePicker
              isVisible={isDatePickerVisible}
              mode="date"
              date={selectedDate ? new Date(selectedDate) : new Date()}
              onConfirm={handleConfirmDate}
              onCancel={hideDatePicker}
            />
          </View>

          {sectionedOrders.length > 0 && (
            <View style={styles.totalAmountContainer}>
              <Text style={styles.totalAmountText}>Total Orders Value: ₹{totalAmount.toFixed(2)}</Text>
            </View>
          )}

          {sectionedOrders.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name="inbox" size={54} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.noOrdersText}>{userRole === 'seller' ? 'No store orders found.' : 'No orders found.'}</Text>
              <Text style={styles.noOrdersSubtext}>
                {userRole === 'seller'
                  ? "Looks like your store hasn't received any customer orders matching this filter."
                  : "Looks like you haven't placed any orders matching this filter."}
              </Text>
              <TouchableOpacity
                style={styles.browseButton}
                onPress={() => navigation.navigate('Catalog', { sellerId, sellerName, customerId })}
              >
                <Text style={styles.browseButtonText}>Browse Catalog</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SectionList
              sections={sectionedOrders}
              keyExtractor={(item) => item.id}
              renderItem={renderOrderItem}
              renderSectionHeader={({ section: { title } }) => (
                <Text style={styles.sectionHeader}>{title}</Text>
              )}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              style={[
                styles.list,
                Platform.OS === 'web' ? { overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0 } : null,
              ]}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
              contentContainerStyle={[styles.listContent, { flexGrow: 1, paddingBottom: 90 }]}
            />
          )}
            </>
          )}
        </>
      )}

      {/* Dynamic Payment QR Modal to Pay Anytime */}
      <Modal
        visible={Boolean(selectedQrOrder)}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedQrOrder(null)}
      >
        <View style={styles.qrModalOverlay}>
          <View style={styles.qrModalContent}>
            {/* Modal Header */}
            <View style={styles.qrModalHeader}>
              <View style={styles.qrModalIconWrap}>
                <Icon name="qrcode" size={18} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qrModalTitle}>
                  Pay Order #{selectedQrOrder ? extractOrderNumbers(selectedQrOrder).orderNumber : ''}
                </Text>
                <Text style={styles.qrModalSubtitle}>
                  Exact bill pre-filled • Scan to pay anytime
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedQrOrder(null)} style={styles.modalCloseBtn}>
                <Icon name="close" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.qrModalScroll} showsVerticalScrollIndicator={false}>
              {/* QR Image Box */}
              <View style={styles.qrModalImageBox}>
                {loadingModalQr ? (
                  <View style={styles.qrModalLoading}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={styles.qrModalLoadingText}>Generating Dynamic QR...</Text>
                  </View>
                ) : (modalDynamicQrDataUrl || modalDynamicQrUri) ? (
                  <View style={{ alignItems: 'center' }}>
                    <Image
                      source={{
                        uri: modalDynamicQrDataUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(modalDynamicQrUri)}`
                      }}
                      style={styles.qrModalImg}
                      resizeMode="contain"
                    />
                    <View style={styles.qrModalAmountBadge}>
                      <Text style={styles.qrModalAmountText}>
                        Exact Bill: ₹{Number(selectedQrOrder?.total_amount || 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={{ color: '#64748B', marginVertical: 20 }}>QR Code not available</Text>
                )}
              </View>

              {modalSellerUpiId ? (
                <View style={styles.modalUpiRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Icon name="credit-card" size={12} color="#475569" style={{ marginRight: 6 }} />
                    <Text style={styles.modalUpiText} numberOfLines={1}>
                      UPI: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{modalSellerUpiId}</Text>
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.modalCopyBtn, copiedModalUpi && styles.modalCopyBtnSuccess]}
                    onPress={handleCopyModalUpi}
                    activeOpacity={0.7}
                  >
                    <Icon
                      name={copiedModalUpi ? "check" : "copy"}
                      size={11}
                      color={copiedModalUpi ? "#16A34A" : "#007AFF"}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.modalCopyBtnText, copiedModalUpi && styles.modalCopyBtnTextSuccess]}>
                      {copiedModalUpi ? 'Copied' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Highlighted QR Code Download Button */}
              <TouchableOpacity
                style={styles.modalDownloadHighlightBtn}
                onPress={handleDownloadModalQr}
                disabled={isDownloadingModalQr || loadingModalQr}
                activeOpacity={0.84}
                accessibilityLabel="Download Payment QR to Device"
              >
                {isDownloadingModalQr ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
                ) : (
                  <View style={styles.downloadIconBadge}>
                    <Icon name="download" size={16} color="#FFFFFF" />
                  </View>
                )}
                <View style={styles.modalDownloadTextCol}>
                  <Text style={styles.modalDownloadTitle}>Download QR Code to Device</Text>
                  <Text style={styles.modalDownloadSub}>
                    Save QR to gallery so you can pay anytime
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color="#FFFFFF" style={{ opacity: 0.85, marginLeft: 6 }} />
              </TouchableOpacity>

              {/* Mobile 1-Tap Pay */}
              {Platform.OS !== 'web' && (
                <View style={styles.quickPayAppsRow}>
                  <TouchableOpacity
                    style={[styles.quickPayAppBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                    onPress={() => handleOpenModalUpiApp('gpay')}
                    activeOpacity={0.8}
                  >
                    <Icon name="google-wallet" size={13} color="#16A34A" style={{ marginRight: 4 }} />
                    <Text style={[styles.quickPayAppText, { color: '#16A34A' }]}>GPay</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickPayAppBtn, { backgroundColor: '#FAF5FF', borderColor: '#E9D5FF' }]}
                    onPress={() => handleOpenModalUpiApp('phonepe')}
                    activeOpacity={0.8}
                  >
                    <Icon name="mobile-phone" size={16} color="#9333EA" style={{ marginRight: 4 }} />
                    <Text style={[styles.quickPayAppText, { color: '#9333EA' }]}>PhonePe</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickPayAppBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                    onPress={() => handleOpenModalUpiApp('paytm')}
                    activeOpacity={0.8}
                  >
                    <Icon name="shield" size={13} color="#007AFF" style={{ marginRight: 4 }} />
                    <Text style={[styles.quickPayAppText, { color: '#007AFF' }]}>Paytm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickPayAppBtn, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}
                    onPress={() => handleOpenModalUpiApp('any')}
                    activeOpacity={0.8}
                  >
                    <Icon name="qrcode" size={13} color="#475569" style={{ marginRight: 4 }} />
                    <Text style={[styles.quickPayAppText, { color: '#475569' }]}>Any UPI</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* View Full Order Details button */}
              <TouchableOpacity
                style={styles.modalViewDetailsBtn}
                onPress={() => {
                  const targetId = selectedQrOrder?.id;
                  setSelectedQrOrder(null);
                  if (targetId) {
                    navigation.navigate('OrderDetail', { orderId: targetId, sellerId, sellerName, customerId });
                  }
                }}
                activeOpacity={0.8}
              >
                <Icon name="list-alt" size={13} color="#007AFF" style={{ marginRight: 6 }} />
                <Text style={styles.modalViewDetailsBtnText}>View Full Order Details</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Quick Direct Sale Modal */}
      <Modal
        visible={quickSaleModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setQuickSaleModalVisible(false)}
      >
        <View style={styles.quickSaleModalOverlay}>
          <View style={styles.quickSaleModalContent}>
            {/* Header */}
            <View style={styles.quickSaleModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.quickSaleIconBadge}>
                  <Icon name="bolt" size={16} color="#059669" />
                </View>
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.quickSaleModalTitle}>⚡ Quick Counter Sale</Text>
                  <Text style={styles.quickSaleModalSub}>Direct UPI / Cash walk-in entry</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setQuickSaleModalVisible(false)}
                style={styles.quickSaleCloseBtn}
              >
                <Icon name="times" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: '80vh' }}>
              {/* Sale Amount Input */}
              <Text style={styles.quickSaleInputLabel}>Sale Amount (₹) *</Text>
              <View style={styles.quickSaleAmountRow}>
                <Text style={styles.quickSaleCurrencySymbol}>₹</Text>
                <TextInput
                  style={styles.quickSaleAmountInput}
                  placeholder="0.00"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  value={quickSaleAmount}
                  onChangeText={setQuickSaleAmount}
                  autoFocus={Platform.OS === 'web'}
                />
                {Boolean(quickSaleAmount) && (
                  <TouchableOpacity
                    onPress={() => setQuickSaleAmount('')}
                    style={styles.quickSaleClearAmtBtn}
                  >
                    <Icon name="times-circle" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Quick Amount Increment Chips */}
              <View style={styles.quickAmtChipsRow}>
                {[10, 20, 50, 100, 200, 500].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={styles.quickAmtChip}
                    onPress={() => handleQuickAddAmount(val)}
                  >
                    <Text style={styles.quickAmtChipText}>+₹{val}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Payment Method Selector */}
              <Text style={[styles.quickSaleInputLabel, { marginTop: 14 }]}>Payment Method *</Text>
              <View style={styles.quickPayMethodRow}>
                <TouchableOpacity
                  style={[styles.quickPayMethodBtn, quickSaleMethod === 'upi' && styles.quickPayMethodBtnActiveUpi]}
                  onPress={() => setQuickSaleMethod('upi')}
                >
                  <Icon
                    name="qrcode"
                    size={14}
                    color={quickSaleMethod === 'upi' ? '#FFFFFF' : '#059669'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.quickPayMethodBtnText, quickSaleMethod === 'upi' && styles.quickPayMethodBtnTextActive]}>
                    UPI / GPay / QR
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickPayMethodBtn, quickSaleMethod === 'cash' && styles.quickPayMethodBtnActiveCash]}
                  onPress={() => setQuickSaleMethod('cash')}
                >
                  <Icon
                    name="money"
                    size={14}
                    color={quickSaleMethod === 'cash' ? '#FFFFFF' : '#0284C7'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.quickPayMethodBtnText, quickSaleMethod === 'cash' && styles.quickPayMethodBtnTextActive]}>
                    Cash
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickPayMethodBtn, quickSaleMethod === 'card' && styles.quickPayMethodBtnActiveCard]}
                  onPress={() => setQuickSaleMethod('card')}
                >
                  <Icon
                    name="credit-card"
                    size={14}
                    color={quickSaleMethod === 'card' ? '#FFFFFF' : '#64748B'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.quickPayMethodBtnText, quickSaleMethod === 'card' && styles.quickPayMethodBtnTextActive]}>
                    Card / Other
                  </Text>
                </TouchableOpacity>
              </View>

              {/* UPI UTR / Reference (Optional) */}
              {quickSaleMethod === 'upi' && (
                <>
                  <Text style={[styles.quickSaleInputLabel, { marginTop: 12 }]}>
                    UPI Transaction ID / UTR / Note (Optional)
                  </Text>
                  <TextInput
                    style={styles.quickSaleTextInput}
                    placeholder="e.g. 4291823901 or GPay Note"
                    placeholderTextColor="#94A3B8"
                    value={quickSaleUpiRef}
                    onChangeText={setQuickSaleUpiRef}
                  />
                </>
              )}

              {/* Order / Sale Type */}
              <Text style={[styles.quickSaleInputLabel, { marginTop: 12 }]}>Sale Type</Text>
              <View style={styles.quickTypeRow}>
                <TouchableOpacity
                  style={[styles.quickTypeBtn, quickSaleType === 'takeaway' && styles.quickTypeBtnActive]}
                  onPress={() => setQuickSaleType('takeaway')}
                >
                  <Text style={[styles.quickTypeText, quickSaleType === 'takeaway' && styles.quickTypeTextActive]}>
                    🛍️ Parcel / Takeaway
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickTypeBtn, quickSaleType === 'dine_in' && styles.quickTypeBtnActive]}
                  onPress={() => setQuickSaleType('dine_in')}
                >
                  <Text style={[styles.quickTypeText, quickSaleType === 'dine_in' && styles.quickTypeTextActive]}>
                    🍽️ Dine-in / Table
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Optional Customer Mobile */}
              <Text style={[styles.quickSaleInputLabel, { marginTop: 12 }]}>
                Customer Mobile (Optional)
              </Text>
              <TextInput
                style={styles.quickSaleTextInput}
                placeholder="10-digit mobile number"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                maxLength={10}
                value={quickSaleCustomerMobile}
                onChangeText={setQuickSaleCustomerMobile}
              />

              {/* Optional Note / Remarks */}
              <Text style={[styles.quickSaleInputLabel, { marginTop: 12 }]}>
                Remarks / Description (Optional)
              </Text>
              <TextInput
                style={styles.quickSaleTextInput}
                placeholder="e.g. Direct Counter UPI Sale"
                placeholderTextColor="#94A3B8"
                value={quickSaleNote}
                onChangeText={setQuickSaleNote}
              />

              {/* Actions */}
              <View style={styles.quickSaleModalActions}>
                <TouchableOpacity
                  style={styles.quickSaleCancelBtn}
                  onPress={() => setQuickSaleModalVisible(false)}
                  disabled={isRecordingQuickSale}
                >
                  <Text style={styles.quickSaleCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.quickSaleConfirmBtn,
                    (!quickSaleAmount || Number(quickSaleAmount) <= 0 || isRecordingQuickSale) && { opacity: 0.6 }
                  ]}
                  onPress={handleRecordQuickSale}
                  disabled={!quickSaleAmount || Number(quickSaleAmount) <= 0 || isRecordingQuickSale}
                >
                  {isRecordingQuickSale ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Icon name="check" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.quickSaleConfirmText}>
                        Record Sale {quickSaleAmount && Number(quickSaleAmount) > 0 ? `(₹${Number(quickSaleAmount).toFixed(2)})` : ''}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Mobile Camera Barcode Scanner for Store Orders */}
      {isBarcodeScannerEnabled && (
        <BarcodeScannerModal
          visible={showBarcodeScanner}
          onClose={() => setShowBarcodeScanner(false)}
          onScan={(scannedCode) => {
            if (!scannedCode) return;
            const clean = String(scannedCode).trim();
            setShowBarcodeScanner(false);
            setSearchQuery(clean);
          }}
          title="Scan Order Barcode"
          subtitle="Point camera at receipt barcode or package code to find order"
          defaultContinuous={false}
        />
      )}

      {/* Bottom Navigation Footer (Store, Cart, Orders) */}
      <StoreNavigationFooter
        activeTab="orders"
        navigation={navigation}
        route={route}
        sellerId={sellerId}
        sellerName={sellerName}
        customerId={customerId}
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
  mainTabSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 3,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 9,
    gap: 4,
  },
  mainTabSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 7,
  },
  mainTabSegmentActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  mainTabSegmentText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  mainTabSegmentTextActive: {
    fontWeight: '700',
    color: '#0F172A',
  },
  list: {
    flex: 1,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchContainer: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexShrink: 0,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
  },
  searchIconLeading: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 40,
  },
  clearSearchBtn: {
    padding: 4,
    marginLeft: 4,
  },
  barcodeScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    borderRadius: 8,
    marginLeft: 8,
    height: 42,
  },
  barcodeScanBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  quickSaleHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    marginRight: 8,
  },
  quickSaleHeaderBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  salesReportHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    marginRight: 8,
  },
  salesReportHeaderBtnActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  salesReportHeaderBtnText: {
    color: '#007AFF',
    fontWeight: '700',
    fontSize: 11,
  },
  salesReportHeaderBtnTextActive: {
    color: '#FFFFFF',
  },
  quickSaleActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 11,
    borderRadius: 8,
    marginLeft: 8,
    height: 42,
  },
  quickSaleActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  quickSaleModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  quickSaleModalContent: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '92%',
  },
  quickSaleModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  quickSaleIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSaleModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  quickSaleModalSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  quickSaleCloseBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  quickSaleInputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  quickSaleAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  quickSaleCurrencySymbol: {
    fontSize: 24,
    fontWeight: '800',
    color: '#059669',
    marginRight: 6,
  },
  quickSaleAmountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    paddingVertical: 6,
  },
  quickSaleClearAmtBtn: {
    padding: 6,
  },
  quickAmtChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  quickAmtChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  quickAmtChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  quickPayMethodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickPayMethodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  quickPayMethodBtnActiveUpi: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  quickPayMethodBtnActiveCash: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  quickPayMethodBtnActiveCard: {
    backgroundColor: '#475569',
    borderColor: '#475569',
  },
  quickPayMethodBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  quickPayMethodBtnTextActive: {
    color: '#FFFFFF',
  },
  quickSaleTextInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
  },
  quickTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  quickTypeBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  quickTypeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  quickTypeTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  quickSaleModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  quickSaleCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  quickSaleCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  quickSaleConfirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 8,
  },
  quickSaleConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusFilterContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statusButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    margin: 3,
    backgroundColor: '#F8FAFC',
  },
  selectedStatusButton: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  statusButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  selectedStatusButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusButtonPaymentPendingAlert: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  statusButtonTextPaymentPendingAlert: {
    color: '#D97706',
    fontWeight: '700',
  },
  dateFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  datePickerButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePickerButtonActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  datePickerButtonText: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '500',
  },
  datePickerButtonTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  todayButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  todayButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  clearDateBtn: {
    padding: 10,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalAmountContainer: {
    padding: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
    flexShrink: 0,
  },
  totalAmountText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E40AF',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  orderItem: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginVertical: 6,
    marginHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  orderId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  dayOrderId: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 2,
  },
  orderBarcodeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  orderStatus: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  paymentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  payCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  payCodeLabel: {
    fontSize: 11,
    color: '#4338CA',
    fontWeight: '600',
    marginRight: 4,
  },
  payCodeValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#312E81',
    letterSpacing: 0.5,
  },
  paymentStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  paymentStatusPaid: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  paymentStatusPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  paymentStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textPaid: {
    color: '#15803D',
  },
  textPending: {
    color: '#B45309',
  },
  orderPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 2,
  },
  orderAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  paymentMethodText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginLeft: 6,
  },
  orderDate: {
    fontSize: 12,
    color: '#64748B',
  },
  orderCustomer: {
    fontSize: 12,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  quickPayActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  quickPayBtnVerify: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  quickPayBtnDone: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  quickPayActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quickPayTextVerify: {
    color: '#15803D',
  },
  quickPayTextDone: {
    color: '#64748B',
  },
  refreshHeaderBtn: {
    padding: 6,
    marginRight: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 32,
    minHeight: 32,
  },
  actionIcon: {
    marginLeft: 18,
  },
  notLoggedInContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  notLoggedInIconBox: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  notLoggedInTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  notLoggedInSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  signInButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 40,
  },
  noOrdersText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  noOrdersSubtext: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  orderPayQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  orderPayQrBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  qrModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  qrModalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  qrModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  qrModalIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  qrModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  qrModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  qrModalScroll: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  qrModalImageBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 12,
    width: '100%',
    marginBottom: 12,
  },
  qrModalLoading: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrModalLoadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#64748B',
  },
  qrModalImg: {
    width: 200,
    height: 200,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  qrModalAmountBadge: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  qrModalAmountText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  modalUpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: '100%',
    marginBottom: 12,
  },
  modalUpiText: {
    fontSize: 12,
    color: '#475569',
  },
  modalCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginLeft: 8,
  },
  modalCopyBtnSuccess: {
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
  },
  modalCopyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  modalCopyBtnTextSuccess: {
    color: '#16A34A',
  },
  modalDownloadHighlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669', // Emerald highlight
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#047857',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 4,
  },
  downloadIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  modalDownloadTextCol: {
    flex: 1,
  },
  modalDownloadTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  modalDownloadSub: {
    fontSize: 11,
    color: '#D1FAE5',
    marginTop: 2,
    fontWeight: '500',
  },
  quickPayAppsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
    marginBottom: 12,
  },
  quickPayAppBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickPayAppText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalViewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    width: '100%',
    marginTop: 4,
  },
  modalViewDetailsBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
  },
});

export default OrderListScreen;