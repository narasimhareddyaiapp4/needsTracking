import { supabase } from '../services/supabase';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Button,
  Alert,
  ScrollView,
} from 'react-native';
import debounce from 'lodash.debounce';
import InventoryHistory from '../components/InventoryHistory';
import { barcodeService } from '../services/barcodeService';
import { FontAwesome as Icon } from '@expo/vector-icons';
import BarcodeScannerModal from '../components/BarcodeScannerModal';

const InventoryScreen = ({ route }) => {
  const { session, userId } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [quantityChange, setQuantityChange] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('adjust'); // 'adjust', 'restock', 'barcodes'

  // Barcode Scanning State
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scannerModalMode, setScannerModalMode] = useState(null); // 'lookup' | 'mapping' | null

  // Barcode Management State for Selected Item
  const [itemBarcodes, setItemBarcodes] = useState([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  const [newBarcode, setNewBarcode] = useState('');
  const [newPackagingUnit, setNewPackagingUnit] = useState('piece');
  const [newMultiplier, setNewMultiplier] = useState('1');
  const [newSerialNumber, setNewSerialNumber] = useState('');
  const [newPurity, setNewPurity] = useState('');
  const [newNetWeight, setNewNetWeight] = useState('');
  const [newRoomNo, setNewRoomNo] = useState('');

  useEffect(() => {
    if (userId) {
      fetchInventory();
    }
  }, [userId]);

  const fetchInventory = async (query = '') => {
    if (!userId) {
      setInventory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let supabaseQuery = supabase
      .from('product_variant_combinations')
      .select(`
        id,
        product_id,
        combination_string,
        quantity,
        sku,
        price,
        products!inner(id, product_name, user_id, amount)
      `)
      .eq('products.user_id', userId);

    if (query) {
      supabaseQuery = supabaseQuery.ilike('products.product_name', `%${query}%`);
    }

    const { data, error } = await supabaseQuery;

    if (error) {
      console.error('Error fetching inventory:', error.message);
      Alert.alert('Error', 'Failed to fetch inventory.');
    } else {
      setInventory(data || []);
    }
    setLoading(false);
  };

  const debouncedFetchInventory = useCallback(debounce(fetchInventory, 300), [userId]);

  useEffect(() => {
    debouncedFetchInventory(searchQuery);
  }, [searchQuery, debouncedFetchInventory]);

  // Load existing barcodes whenever an item is selected
  const loadItemBarcodes = async (productId, variantId) => {
    if (!productId && !variantId) {
      setItemBarcodes([]);
      return;
    }
    setLoadingBarcodes(true);
    const res = await barcodeService.getBarcodesForProduct(productId, variantId);
    if (res.success) {
      setItemBarcodes(res.barcodes);
    } else {
      setItemBarcodes([]);
    }
    setLoadingBarcodes(false);
  };

  const handleSelectItem = (item) => {
    setSelectedItem(item);
    setSelectedItemId(item.id);
    const prodId = item?.product_id || item?.products?.id;
    loadItemBarcodes(prodId, item.id);
  };

  // Perform barcode scan lookup
  const handleBarcodeScan = async (codeToScan = scannedBarcode) => {
    const code = (codeToScan || '').trim();
    if (!code) {
      Alert.alert('Scan Input', 'Please enter or scan a barcode.');
      return;
    }

    setScanning(true);
    const res = await barcodeService.scanBarcode(code);
    setScanning(false);

    if (res.success && res.item) {
      const scanned = res.item;
      setScanResult(scanned);

      // Match item in current inventory list
      const matched = inventory.find((inv) => inv.id === scanned.variantId);
      if (matched) {
        handleSelectItem(matched);
      } else {
        // Fallback item structure
        const fallbackItem = {
          id: scanned.variantId || scanned.productId,
          product_id: scanned.productId,
          combination_string: scanned.combinationString || 'Default',
          quantity: scanned.currentStock,
          products: {
            id: scanned.productId,
            product_name: scanned.productName,
          },
        };
        handleSelectItem(fallbackItem);
      }
    } else {
      Alert.alert(
        'Barcode Not Found',
        `Barcode "${code}" is not registered in the system.\n\nWould you like to map it to the selected product?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Map Barcode',
            onPress: () => {
              if (selectedItem) {
                setActiveTab('barcodes');
                setNewBarcode(code);
              } else {
                Alert.alert('Select Product', 'Please select an inventory item from the left list to map this barcode.');
              }
            },
          },
        ]
      );
    }
  };

  // Quick adjust stock directly from scanned barcode with multiplier support
  const handleBarcodeQuickAction = async (actionType) => {
    if (!scanResult || !scanResult.barcode) return;
    setLoading(true);

    const action = actionType === 'in' ? 'restock' : 'sale';
    const res = await barcodeService.adjustInventory({
      barcode: scanResult.barcode,
      action,
      quantity: 1,
      notes: `Scanner quick ${actionType === 'in' ? 'Stock In' : 'Stock Out'}`,
    });

    if (res && res.success) {
      Alert.alert(
        'Stock Updated',
        `${actionType === 'in' ? '+ Added' : '- Deducted'} ${res.units_delta} base units.\nNew Stock: ${res.new_stock}`
      );
      fetchInventory(searchQuery);
      // Refresh scan result stock
      setScanResult((prev) => (prev ? { ...prev, currentStock: res.new_stock } : null));
    } else {
      Alert.alert('Error', res?.message || 'Failed to update stock via scanner.');
    }
    setLoading(false);
  };

  // Add new barcode to selected item
  const handleAddBarcode = async () => {
    if (!selectedItem) {
      Alert.alert('Error', 'Please select a product item first.');
      return;
    }
    if (!newBarcode.trim()) {
      Alert.alert('Required', 'Please enter or scan a barcode.');
      return;
    }

    const prodId = selectedItem.product_id || selectedItem.products?.id;
    if (!prodId) {
      Alert.alert('Error', 'Missing Product ID.');
      return;
    }

    // Build optional metadata for Jewelry or Hotel
    const metadata = {};
    if (newPurity.trim()) metadata.purity = newPurity.trim();
    if (newNetWeight.trim()) metadata.net_weight_gm = parseFloat(newNetWeight);
    if (newRoomNo.trim()) metadata.room_no = newRoomNo.trim();

    setLoading(true);
    const res = await barcodeService.assignBarcode({
      productId: prodId,
      variantId: selectedItem.id,
      barcode: newBarcode.trim(),
      packagingUnit: newPackagingUnit,
      multiplier: parseInt(newMultiplier, 10) || 1,
      serialNumber: newSerialNumber.trim() || null,
      metadata,
    });

    if (res.success) {
      Alert.alert('Success', `Barcode "${newBarcode}" registered successfully!`);
      setNewBarcode('');
      setNewSerialNumber('');
      setNewPurity('');
      setNewNetWeight('');
      setNewRoomNo('');
      loadItemBarcodes(prodId, selectedItem.id);
    } else {
      Alert.alert('Error', res.error || 'Failed to save barcode.');
    }
    setLoading(false);
  };

  // Delete barcode mapping
  const handleDeleteBarcode = async (barcodeId, code) => {
    Alert.alert('Delete Barcode', `Are you sure you want to remove barcode "${code}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          const res = await barcodeService.deleteBarcode(barcodeId);
          if (res.success) {
            const prodId = selectedItem.product_id || selectedItem.products?.id;
            loadItemBarcodes(prodId, selectedItem.id);
          } else {
            Alert.alert('Error', res.error || 'Failed to delete barcode.');
          }
          setLoading(false);
        },
      },
    ]);
  };

  const handleAdjustQuantity = async () => {
    if (!selectedItem || !quantityChange || isNaN(parseInt(quantityChange, 10))) {
      Alert.alert('Invalid Input', 'Please select an item and enter a valid quantity.');
      return;
    }

    setLoading(true);
    const parsedQuantityChange = parseInt(quantityChange, 10);
    const newQuantity = selectedItem.quantity + parsedQuantityChange;

    const { error: updateError } = await supabase
      .from('product_variant_combinations')
      .update({ quantity: newQuantity })
      .eq('id', selectedItem.id);

    if (updateError) {
      console.error('Error updating quantity:', updateError.message);
      Alert.alert('Error', 'Failed to update quantity.');
    } else {
      await supabase.from('inventory_history').insert({
        product_variant_combination_id: selectedItem.id,
        change_type: parsedQuantityChange > 0 ? 'restock' : 'manual_adjustment',
        quantity_change: parsedQuantityChange,
        new_quantity: newQuantity,
        notes: 'Manual adjustment from app',
      });

      Alert.alert('Success', 'Inventory updated successfully!');
      setQuantityChange('');
      fetchInventory(searchQuery);
    }
    setLoading(false);
  };

  const restockProduct = async (product_variant_combination_id, quantity) => {
    if (!quantity || isNaN(parseInt(quantity, 10))) {
      Alert.alert('Invalid Input', 'Please enter a valid quantity.');
      return;
    }
    setLoading(true);
    const parsedQuantity = parseInt(quantity, 10);
    const { error } = await supabase
      .from('product_variant_combinations')
      .update({ quantity: parsedQuantity })
      .eq('id', product_variant_combination_id);

    if (error) {
      Alert.alert('Error', `Failed to restock product: ${error.message}`);
    } else {
      await supabase.from('inventory_history').insert({
        product_variant_combination_id: product_variant_combination_id,
        change_type: 'restock',
        quantity_change: parsedQuantity,
        new_quantity: parsedQuantity,
        notes: 'Restocked from app',
      });

      Alert.alert('Success', 'Product restocked successfully!');
      setQuantityChange('');
      fetchInventory(searchQuery);
    }
    setLoading(false);
  };

  if (loading && inventory.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Inventory & Barcodes</Text>
      </View>

      {/* Barcode Scanner Input Bar */}
      <View style={styles.scannerBar}>
        <TextInput
          style={styles.scannerInput}
          placeholder="Scan barcode or type code..."
          value={scannedBarcode}
          onChangeText={setScannedBarcode}
          onSubmitEditing={() => handleBarcodeScan()}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => handleBarcodeScan()}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.scanButtonText}>🔍 Lookup</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cameraScanButton}
          onPress={() => setScannerModalMode('lookup')}
          accessibilityLabel="Open Mobile Camera Scanner"
        >
          <Icon name="camera" size={14} color="#fff" style={{ marginRight: 4 }} />
          <Text style={styles.cameraScanButtonText}>Camera</Text>
        </TouchableOpacity>
      </View>

      {/* Scanned Result Banner */}
      {scanResult && (
        <View style={styles.scanResultCard}>
          <View style={styles.scanResultHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanResultTitle}>
                {scanResult.productName} ({scanResult.combinationString})
              </Text>
              <Text style={styles.scanResultSub}>
                Barcode: <Text style={{ fontWeight: 'bold' }}>{scanResult.barcode}</Text> | Unit: {scanResult.packagingUnit} (x{scanResult.multiplier})
              </Text>
              {scanResult.serialNumber && (
                <Text style={styles.scanBadgeText}>Serial: {scanResult.serialNumber} | Status: {scanResult.itemStatus}</Text>
              )}
              {scanResult.metadata?.purity && (
                <Text style={styles.scanBadgeText}>Purity: {scanResult.metadata.purity} | Net Wt: {scanResult.metadata.net_weight_gm}g</Text>
              )}
              {scanResult.metadata?.room_no && (
                <Text style={styles.scanBadgeText}>Room: {scanResult.metadata.room_no}</Text>
              )}
            </View>
            <View style={styles.scanStockBadge}>
              <Text style={styles.scanStockLabel}>Stock</Text>
              <Text style={styles.scanStockValue}>{scanResult.currentStock}</Text>
            </View>
          </View>

          <View style={styles.quickActionRow}>
            <TouchableOpacity
              style={[styles.quickActionButton, { backgroundColor: '#28a745' }]}
              onPress={() => handleBarcodeQuickAction('in')}
            >
              <Text style={styles.quickActionText}>+ Stock In ({scanResult.multiplier} units)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickActionButton, { backgroundColor: '#dc3545' }]}
              onPress={() => handleBarcodeQuickAction('out')}
            >
              <Text style={styles.quickActionText}>- Stock Out ({scanResult.multiplier} units)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickActionButton, { backgroundColor: '#6c757d' }]}
              onPress={() => setScanResult(null)}
            >
              <Text style={styles.quickActionText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Filter / Search Bar */}
      <View style={styles.filtersContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter inventory list by product name..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Main Content: Split Pane */}
      <View style={styles.mainContent}>
        {/* Left Pane: Items List */}
        <View style={styles.leftPane}>
          {loading && <ActivityIndicator style={styles.listLoader} size="small" color="#007AFF" />}
          <FlatList
            data={inventory}
            keyExtractor={(item) => item.id.toString()}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.itemContainer,
                  selectedItem?.id === item.id && styles.selectedItemContainer,
                ]}
                onPress={() => handleSelectItem(item)}
              >
                <Text style={styles.itemName}>
                  {item.products ? item.products.product_name : 'Product'} - {item.combination_string}
                </Text>
                <View style={styles.itemMetaRow}>
                  <Text style={styles.itemQuantity}>Stock: {item.quantity}</Text>
                  {item.sku ? <Text style={styles.itemSku}>SKU: {item.sku}</Text> : null}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No inventory items found.</Text>}
          />
        </View>

        {/* Right Pane: Selected Item Tabs & History */}
        <View style={styles.rightPane}>
          {selectedItem ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Tab Navigation */}
              <View style={styles.tabContainer}>
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'adjust' && styles.activeTabButton]}
                  onPress={() => setActiveTab('adjust')}
                >
                  <Text style={[styles.tabButtonText, activeTab === 'adjust' && styles.activeTabButtonText]}>Adjust</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'restock' && styles.activeTabButton]}
                  onPress={() => setActiveTab('restock')}
                >
                  <Text style={[styles.tabButtonText, activeTab === 'restock' && styles.activeTabButtonText]}>Restock</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'barcodes' && styles.activeTabButton]}
                  onPress={() => setActiveTab('barcodes')}
                >
                  <Text style={[styles.tabButtonText, activeTab === 'barcodes' && styles.activeTabButtonText]}>
                    🏷️ Barcodes ({itemBarcodes.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Tab 1: Adjust Quantity */}
              {activeTab === 'adjust' && (
                <View style={styles.detailsContainer}>
                  <Text style={styles.modalTitle}>
                    Adjust Quantity for {selectedItem.products?.product_name} - {selectedItem.combination_string}
                  </Text>
                  <Text style={styles.currentStockNotice}>Current Stock: {selectedItem.quantity}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Quantity Change (e.g. +10 or -5)"
                    keyboardType="numeric"
                    value={quantityChange}
                    onChangeText={setQuantityChange}
                  />
                  <Button title="Adjust Inventory" onPress={handleAdjustQuantity} />
                </View>
              )}

              {/* Tab 2: Restock */}
              {activeTab === 'restock' && (
                <View style={styles.detailsContainer}>
                  <Text style={styles.modalTitle}>
                    Restock {selectedItem.products?.product_name} - {selectedItem.combination_string}
                  </Text>
                  <Text style={styles.currentStockNotice}>Current Stock: {selectedItem.quantity}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="New Total Restock Quantity"
                    keyboardType="numeric"
                    value={quantityChange}
                    onChangeText={setQuantityChange}
                  />
                  <Button title="Restock" onPress={() => restockProduct(selectedItem.id, quantityChange)} />
                </View>
              )}

              {/* Tab 3: Multiple Barcodes Manager */}
              {activeTab === 'barcodes' && (
                <View style={styles.detailsContainer}>
                  <Text style={styles.modalTitle}>Manage Multiple Barcodes</Text>
                  <Text style={styles.barcodeSubheader}>
                    Registered barcodes for: {selectedItem.products?.product_name} ({selectedItem.combination_string})
                  </Text>

                  {/* List of existing barcodes */}
                  {loadingBarcodes ? (
                    <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 10 }} />
                  ) : itemBarcodes.length === 0 ? (
                    <Text style={styles.noBarcodesText}>No barcodes mapped yet. Add one below.</Text>
                  ) : (
                    itemBarcodes.map((bc) => (
                      <View key={bc.id} style={styles.barcodeItemRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.barcodeText}>{bc.barcode}</Text>
                          <Text style={styles.barcodeUnitInfo}>
                            Unit: <Text style={{ fontWeight: 'bold' }}>{bc.packaging_unit}</Text> | Multiplier: <Text style={{ fontWeight: 'bold' }}>x{bc.multiplier}</Text>
                            {bc.serial_number ? ` | Serial: ${bc.serial_number}` : ''}
                          </Text>
                          {bc.metadata?.purity ? (
                            <Text style={styles.barcodeMetadataText}>Purity: {bc.metadata.purity} | Wt: {bc.metadata.net_weight_gm}g</Text>
                          ) : null}
                          {bc.metadata?.room_no ? (
                            <Text style={styles.barcodeMetadataText}>Room: {bc.metadata.room_no}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={styles.deleteBarcodeBtn}
                          onPress={() => handleDeleteBarcode(bc.id, bc.barcode)}
                        >
                          <Text style={styles.deleteBarcodeText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}

                  {/* Add New Barcode Form */}
                  <View style={styles.addBarcodeSection}>
                    <Text style={styles.sectionHeader}>+ Map New Barcode</Text>
                    
                    <View style={styles.barcodeInputWithScanRow}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        placeholder="Barcode (EAN-13, UPC, Code-128)*"
                        value={newBarcode}
                        onChangeText={setNewBarcode}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.fieldScanButton}
                        onPress={() => setScannerModalMode('mapping')}
                        accessibilityLabel="Scan Barcode to Map"
                      >
                        <Icon name="camera" size={13} color="#007AFF" style={{ marginRight: 4 }} />
                        <Text style={styles.fieldScanButtonText}>Scan</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.rowInputs}>
                      <View style={{ flex: 1, marginRight: 5 }}>
                        <Text style={styles.inputLabel}>Packaging Unit</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g. piece, pack_6, case_24, bottle"
                          value={newPackagingUnit}
                          onChangeText={setNewPackagingUnit}
                        />
                      </View>
                      <View style={{ width: 90 }}>
                        <Text style={styles.inputLabel}>Multiplier</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g. 1, 6, 24"
                          keyboardType="numeric"
                          value={newMultiplier}
                          onChangeText={setNewMultiplier}
                        />
                      </View>
                    </View>

                    {/* Optional Jewelry / Hotel Fields */}
                    <Text style={[styles.inputLabel, { marginTop: 5 }]}>Industry Specific (Optional):</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Serial Number (Jewelry Tag / Hotel Asset)"
                      value={newSerialNumber}
                      onChangeText={setNewSerialNumber}
                    />

                    <View style={styles.rowInputs}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginRight: 5 }]}
                        placeholder="Jewelry Purity (e.g. 22K)"
                        value={newPurity}
                        onChangeText={setNewPurity}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Net Wt (gm)"
                        keyboardType="numeric"
                        value={newNetWeight}
                        onChangeText={setNewNetWeight}
                      />
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder="Hotel Room / Folio No (e.g. Room 204)"
                      value={newRoomNo}
                      onChangeText={setNewRoomNo}
                    />

                    <Button title="Save Barcode Mapping" onPress={handleAddBarcode} />
                  </View>
                </View>
              )}

              {/* History */}
              <InventoryHistory product_variant_combination_id={selectedItemId} />
            </ScrollView>
          ) : (
            <View style={styles.placeholder}>
              <Text style={{ fontSize: 16, color: '#666' }}>
                Select an item or scan a barcode to view details & barcodes
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Mobile Barcode Scanner Modal */}
      <BarcodeScannerModal
        visible={Boolean(scannerModalMode)}
        onClose={() => setScannerModalMode(null)}
        onScan={(code) => {
          if (scannerModalMode === 'mapping') {
            setNewBarcode(code);
            setScannerModalMode(null);
          } else {
            setScannedBarcode(code);
            setScannerModalMode(null);
            handleBarcodeScan(code);
          }
        }}
        title={
          scannerModalMode === 'mapping'
            ? 'Scan Barcode to Map'
            : 'Inventory Mobile Scanner'
        }
        subtitle={
          scannerModalMode === 'mapping'
            ? 'Scan product packaging or barcode label to assign'
            : 'Scan barcode to check stock, audit, or adjust inventory'
        }
        defaultContinuous={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  scannerBar: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#1e293b',
    alignItems: 'center',
  },
  scannerInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginRight: 8,
  },
  scanButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cameraScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    marginLeft: 8,
  },
  cameraScanButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  barcodeInputWithScanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  fieldScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
  },
  fieldScanButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
  },
  scanResultCard: {
    backgroundColor: '#eef2ff',
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
    padding: 12,
  },
  scanResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  scanResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e1b4b',
  },
  scanResultSub: {
    fontSize: 13,
    color: '#4338ca',
    marginTop: 2,
  },
  scanBadgeText: {
    fontSize: 12,
    color: '#6b21a8',
    marginTop: 2,
  },
  scanStockBadge: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
  },
  scanStockLabel: {
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '600',
  },
  scanStockValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e1b4b',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickActionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  filtersContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 8,
    backgroundColor: '#fafafa',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPane: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#ddd',
  },
  rightPane: {
    flex: 1.2,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemContainer: {
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  selectedItemContainer: {
    backgroundColor: '#e0f2fe',
    borderLeftWidth: 4,
    borderLeftColor: '#0284c7',
  },
  itemName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  itemQuantity: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
  itemSku: {
    fontSize: 12,
    color: '#6b7280',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
    color: '#888',
  },
  detailsContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#111827',
  },
  currentStockNotice: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 6,
    width: '100%',
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  rowInputs: {
    flexDirection: 'row',
  },
  inputLabel: {
    fontSize: 12,
    color: '#4b5563',
    marginBottom: 4,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    overflow: 'hidden',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  activeTabButton: {
    backgroundColor: '#0284c7',
  },
  tabButtonText: {
    fontWeight: '600',
    color: '#475569',
    fontSize: 13,
  },
  activeTabButtonText: {
    color: '#fff',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  listLoader: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 1,
  },
  barcodeSubheader: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  noBarcodesText: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  barcodeItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    marginBottom: 8,
  },
  barcodeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  barcodeUnitInfo: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  barcodeMetadataText: {
    fontSize: 11,
    color: '#7c3aed',
    marginTop: 2,
  },
  deleteBarcodeBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  deleteBarcodeText: {
    color: '#dc2626',
    fontWeight: 'bold',
    fontSize: 14,
  },
  addBarcodeSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 10,
  },
});

export default InventoryScreen;