import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { FontAwesome as Icon } from '@expo/vector-icons';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { getActiveEmployeeSession, resolveEmployeeSession } from '../services/employeeService';

// Import the screens that will be part of the tabs
import ProductScreen from '../screens/ProductScreen';
import InventoryScreen from '../screens/InventoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CatalogScreen from '../screens/CatalogScreen';
import OrderListScreen from '../screens/OrderListScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import OrderEditScreen from '../screens/OrderEditScreen';
import CustomerDamageScreen from '../screens/CustomerDamageScreen';
import CustomerMapScreen from '../screens/CustomerMapScreen';
import SellersMapScreen from '../screens/SellersMapScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import UpiQrScreen from '../screens/UpiQrScreen';
import OrderConfirmationScreen from '../screens/OrderConfirmationScreen';
import CartScreen from '../screens/CartScreen';
import CatalogManagementScreen from '../screens/CatalogManagementScreen';
import SellerSalesReportScreen from '../screens/SellerSalesReportScreen';

const Tab = createBottomTabNavigator();
const OrdersStack = createStackNavigator();
const CartStack = createStackNavigator();
const CatalogStack = createStackNavigator();

function OrdersStackNavigator({ route }) {
  return (
    <OrdersStack.Navigator screenOptions={{ headerShown: false }}>
      <OrdersStack.Screen
        name="OrderList"
        component={OrderListScreen}
        initialParams={route?.params}
      />
      <OrdersStack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        initialParams={route?.params}
      />
      <OrdersStack.Screen
        name="OrderEdit"
        component={OrderEditScreen}
        initialParams={route?.params}
      />
      <OrdersStack.Screen
        name="SellerSalesReport"
        component={SellerSalesReportScreen}
        initialParams={route?.params}
      />
    </OrdersStack.Navigator>
  );
}

function CartStackNavigator({ route }) {
  return (
    <CartStack.Navigator screenOptions={{ headerShown: false }}>
      <CartStack.Screen
        name="Cart"
        component={CartScreen}
        initialParams={route?.params}
      />
      <CartStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        initialParams={route?.params}
      />
      <CartStack.Screen
        name="UpiQr"
        component={UpiQrScreen}
        initialParams={route?.params}
      />
      <CartStack.Screen
        name="OrderConfirmation"
        component={OrderConfirmationScreen}
        initialParams={route?.params}
      />
      <CartStack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        initialParams={route?.params}
      />
    </CartStack.Navigator>
  );
}

function CatalogStackNavigator({ route }) {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen
        name="Catalog"
        component={CatalogScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="Cart"
        component={CartScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="UpiQr"
        component={UpiQrScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="OrderConfirmation"
        component={OrderConfirmationScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="CatalogManagement"
        component={CatalogManagementScreen}
        initialParams={route?.params}
      />
      <CatalogStack.Screen
        name="CategoryManagement"
        component={CatalogManagementScreen}
        initialParams={route?.params}
      />
    </CatalogStack.Navigator>
  );
}

function ProductTabNavigator({ route }) {
  const { session } = route.params || {};
  const { role: contextRole, cartItemCount } = useCart();
  const { colors, isDark } = useTheme();
  const user = session?.user || session;
  const userId = user?.id;
  const userMetadata = user?.user_metadata || session?.user_metadata;

  // Track employee info with fallback to async session resolution
  const [employeeInfo, setEmployeeInfo] = useState({
    isEmployee: route.params?.role === 'seller_employee' || route.params?.isEmployee === true,
    sellerId: route.params?.sellerId || null,
    employeeId: route.params?.employeeId || null,
    employeeName: route.params?.employeeName || null,
    employeeDesignation: route.params?.employeeDesignation || null,
    permissions: route.params?.permissions || null,
  });

  useEffect(() => {
    let isMounted = true;
    const checkEmployee = async () => {
      try {
        let emp = await getActiveEmployeeSession();
        if (!emp && user) {
          emp = await resolveEmployeeSession(user);
        }
        if (isMounted && emp) {
          setEmployeeInfo({
            isEmployee: true,
            sellerId: emp.seller_id,
            employeeId: emp.id,
            employeeName: emp.name,
            employeeDesignation: emp.designation,
            permissions: emp.permissions,
          });
        }
      } catch (err) {
        console.warn('Error checking employee session in ProductTabNavigator:', err);
      }
    };
    checkEmployee();
    return () => { isMounted = false; };
  }, [user]);

  // Determine role: If staff employee, NEVER allow contextRole or userMetadata to override 'seller_employee'!
  const isEmployee = employeeInfo.isEmployee || route.params?.role === 'seller_employee' || route.params?.isEmployee === true;
  const role = isEmployee
    ? 'seller_employee'
    : (route.params?.role || contextRole || userMetadata?.role || 'seller');
  const customerId = userMetadata?.customerId || route.params?.customerId;
  const isBuyer = role === 'customer' || role === 'buyer';
  const effectiveSellerId = employeeInfo.sellerId || route.params?.sellerId || (isEmployee ? null : userId);
  const permissions = employeeInfo.permissions || route.params?.permissions || {};
  const employeeId = employeeInfo.employeeId || route.params?.employeeId;
  const employeeName = employeeInfo.employeeName || route.params?.employeeName;
  const employeeDesignation = employeeInfo.employeeDesignation || route.params?.employeeDesignation;

  const defaultTab = isBuyer
    ? 'CatalogTab'
    : isEmployee
    ? permissions.can_pos_bill !== false
      ? 'CatalogTab'
      : permissions.can_manage_orders !== false
      ? 'OrdersTab'
      : 'InventoryTab'
    : 'ProductsTab';

  return (
    <Tab.Navigator
      initialRouteName={defaultTab}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'ProductsTab') {
            iconName = 'shopping-bag';
          } else if (route.name === 'ProfileTab') {
            iconName = focused ? 'user-circle' : 'user-circle-o';
          } else if (route.name === 'CatalogTab') {
            iconName = 'book';
          } else if (route.name === 'OrdersTab') {
            iconName = 'list-alt';
          } else if (route.name === 'ReportsTab') {
            iconName = 'bar-chart';
          } else if (route.name === 'DamageTab') {
            iconName = 'exclamation-triangle';
          } else if (route.name === 'MapTab') {
            iconName = 'map-marker';
          } else if (route.name === 'InventoryTab') {
            iconName = 'cubes';
          } else if (route.name === 'CartTab') {
            iconName = 'shopping-cart';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      {isBuyer ? (
        // ===== BUYER TABS =====
        <>
          <Tab.Screen
            name="CatalogTab"
            component={CatalogStackNavigator}
            options={{ title: 'Catalog' }}
            initialParams={{ session }}
          />
          <Tab.Screen
            name="CartTab"
            component={CartStackNavigator}
            options={{
              title: 'Cart',
              tabBarBadge: cartItemCount > 0 ? cartItemCount : undefined,
              tabBarBadgeStyle: { backgroundColor: '#10B981', color: '#FFFFFF', fontSize: 10 },
            }}
            initialParams={{ session, userId, customerId }}
          />
          <Tab.Screen
            name="OrdersTab"
            component={OrdersStackNavigator}
            options={{ title: 'My Orders' }}
            initialParams={{ session, userId, customerId }}
          />
          <Tab.Screen
            name="MapTab"
            component={SellersMapScreen}
            options={{ title: 'Stores' }}
            initialParams={{ session, userId, customerId }}
          />
          <Tab.Screen
            name="ProfileTab"
            component={ProfileScreen}
            options={{ title: 'Profile' }}
            initialParams={{ session, userId, customerId }}
          />
        </>
      ) : (
        // ===== SELLER & SELLER EMPLOYEE TABS =====
        <>
          {(!isEmployee || permissions.can_pos_bill !== false) && (
            <Tab.Screen
              name="CatalogTab"
              component={CatalogStackNavigator}
              options={{
                title: isEmployee ? 'POS Billing' : 'Catalog',
                tabBarBadge: cartItemCount > 0 ? cartItemCount : undefined,
                tabBarBadgeStyle: { backgroundColor: '#10B981', color: '#FFFFFF', fontSize: 10 },
              }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {(!isEmployee || permissions.can_manage_products === true) && (
            <Tab.Screen
              name="ProductsTab"
              component={ProductScreen}
              options={{ title: 'Products' }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {(!isEmployee || permissions.can_manage_orders !== false) && (
            <Tab.Screen
              name="OrdersTab"
              component={OrdersStackNavigator}
              options={{ title: 'Orders' }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {(!isEmployee || permissions.can_view_reports === true) && (
            <Tab.Screen
              name="ReportsTab"
              component={SellerSalesReportScreen}
              options={{ title: 'Reports' }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {(!isEmployee || permissions.can_manage_inventory === true) && (
            <Tab.Screen
              name="InventoryTab"
              component={InventoryScreen}
              options={{ title: 'Inventory' }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {(!isEmployee || permissions.can_manage_inventory === true) && (
            <Tab.Screen
              name="DamageTab"
              component={CustomerDamageScreen}
              options={{ title: 'Damage' }}
              initialParams={{
                session,
                userId: effectiveSellerId || userId,
                sellerId: effectiveSellerId || userId,
                customerId,
                employeeId,
                employeeName,
                employeeDesignation,
                isEmployee,
                permissions,
              }}
            />
          )}

          {!isEmployee && (
            <Tab.Screen
              name="MapTab"
              component={CustomerMapScreen}
              options={{ title: 'Map' }}
              initialParams={{ session, userId, customerId }}
            />
          )}

          <Tab.Screen
            name="ProfileTab"
            component={ProfileScreen}
            options={{ title: isEmployee ? 'Staff Profile' : 'Profile' }}
            initialParams={{
              session,
              userId,
              sellerId: effectiveSellerId || userId,
              customerId,
              employeeId,
              employeeName,
              employeeDesignation,
              isEmployee,
              permissions,
              role,
            }}
          />
        </>
      )}
    </Tab.Navigator>
  );
}

export default ProductTabNavigator;