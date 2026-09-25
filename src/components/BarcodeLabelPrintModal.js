import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import {
  printBarcodeLabel,
  generateCode128Svg,
  getPrinterConfig,
  safeFormatPrice,
} from '../services/printerService';

/**
 * Universal Modal for Customizing and Printing Product Barcode Labels
 *
 * Supports single & multi-copy batch label printing to:
 * 1. Web Bluetooth thermal receipt / sticker printers (ESC/POS 1D Code-128)
 * 2. Web browser popup print (SVG vector thermal layout)
 * 3. Native Expo-Print / AirPrint / PDF
 */
const BarcodeLabelPrintModal = ({
  visible,
  onClose,
  item = {},
  barcodeData = {},
}) => {
  const [copies, setCopies] = useState('1');
  const [includeStoreName, setIncludeStoreName] = useState(true);
  const [includePrice, setIncludePrice] = useState(true);
  const [includeVariant, setIncludeVariant] = useState(true);
  const [paperWidth, setPaperWidth] = useState('58mm'); // '58mm' | '80mm'
  const [storeName, setStoreName] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('Rs.');
  const [printing, setPrinting] = useState(false);

  // Extract relevant product & barcode values
  const productName =
    item?.products?.product_name ||
    item?.product_name ||
    item?.name ||
    'Product';

  const variantName =
    item?.combination_string && item.combination_string.toLowerCase() !== 'default'
      ? item.combination_string
      : (barcodeData?.packaging_unit && barcodeData.packaging_unit !== 'piece' ? barcodeData.packaging_unit : '');

  const price =
    item?.price !== undefined && item?.price !== null
      ? item.price
      : (item?.products?.amount || 0);

  const barcode = String(barcodeData?.barcode || barcodeData?.code || item?.sku || '').trim();
  const packagingUnit = barcodeData?.packaging_unit || 'piece';
  const multiplier = barcodeData?.multiplier || 1;
  const serialNumber = barcodeData?.serial_number || null;
  const sku = item?.sku || null;
  const stockQuantity = item?.quantity ?? null;

  // Load printer configuration
  useEffect(() => {
    if (visible) {
      getPrinterConfig().then((cfg) => {
        if (cfg) {
          setStoreName(cfg.storeName || "LocalWala's");
          setCurrencySymbol(cfg.currencySymbol || 'Rs.');
          setPaperWidth(cfg.paperWidth || '58mm');
        }
      });
      // Default copies to 1
      setCopies('1');
    }
  }, [visible]);

  if (!visible) return null;

  const handleCopiesChange = (delta) => {
    const current = parseInt(copies, 10) || 1;
    const next = Math.max(1, Math.min(100, current + delta));
    setCopies(String(next));
  };

  const handleSetStockCopies = () => {
    if (stockQuantity && stockQuantity > 0) {
      setCopies(String(Math.min(100, stockQuantity)));
    }
  };

  const barcodeSvgString = barcode
    ? generateCode128Svg(barcode, {
        height: paperWidth === '80mm' ? 44 : 36,
        barWidth: paperWidth === '80mm' ? 1.4 : 1.2,
      })
    : '';

  const handlePrint = async () => {
    if (!barcode) {
      Alert.alert('Missing Barcode', 'Please select or enter a valid barcode before printing.');
      return;
    }

    const numCopies = Math.max(1, Math.min(100, parseInt(copies, 10) || 1));
    setPrinting(true);

    try {
      const res = await printBarcodeLabel(
        {
          storeName,
          productName,
          variantName,
          sku,
          price: Number(price),
          currencySymbol,
          barcode,
          packagingUnit,
          multiplier,
          serialNumber,
          metadata: barcodeData?.metadata || {},
          copies: numCopies,
          includeStoreName,
          includePrice,
          includeVariant,
        },
        { paperWidth }
      );

      setPrinting(false);
      if (res?.success) {
        Alert.alert(
          'Print Sent',
          `Successfully sent ${numCopies} barcode label${numCopies > 1 ? 's' : ''} to printer!`
        );
        onClose();
      }
    } catch (err) {
      setPrinting(false);
      console.error('[BarcodeLabelPrintModal] Print error:', err);
      Alert.alert('Print Error', err.message || 'Failed to print barcode labels. Please check printer connection.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Icon name="print" size={18} color="#007AFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Print Barcode Labels</Text>
                <Text style={styles.headerSubtitle}>Price sticker & thermal label tags</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={printing}>
              <Icon name="times" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Live Sticker Preview */}
            <Text style={styles.sectionLabel}>STICKER PREVIEW</Text>
            <View style={[styles.stickerCard, paperWidth === '80mm' && styles.stickerCard80mm]}>
              {includeStoreName && storeName ? (
                <Text style={styles.previewStoreName}>{storeName}</Text>
              ) : null}
              <Text style={styles.previewProductName} numberOfLines={2}>
                {productName}
              </Text>
              {includeVariant && variantName ? (
                <Text style={styles.previewVariantName}>({variantName})</Text>
              ) : null}
              {includePrice ? (
                <Text style={styles.previewPrice}>
                  {currencySymbol} {safeFormatPrice(price, currencySymbol)}
                </Text>
              ) : null}

              {/* Barcode SVG Rendering */}
              <View style={styles.barcodeSvgContainer}>
                {barcodeSvgString ? (
                  Platform.OS === 'web' ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: barcodeSvgString }}
                      style={{ display: 'flex', justifyContent: 'center', width: '100%', overflow: 'hidden' }}
                    />
                  ) : (
                    <SvgXml xml={barcodeSvgString} width="100%" height={46} />
                  )
                ) : (
                  <Text style={styles.noBarcodeText}>No Barcode Available</Text>
                )}
              </View>

              {/* Metadata tags */}
              <View style={styles.previewMetaRow}>
                {sku ? <Text style={styles.previewMetaItem}>SKU: {sku}</Text> : null}
                {packagingUnit && packagingUnit !== 'piece' ? (
                  <Text style={styles.previewMetaItem}>
                    Unit: {packagingUnit} {multiplier > 1 ? `(x${multiplier})` : ''}
                  </Text>
                ) : null}
                {serialNumber ? (
                  <Text style={styles.previewMetaItem}>SN: {serialNumber}</Text>
                ) : null}
              </View>
            </View>

            {/* Copies Selector */}
            <Text style={styles.sectionLabel}>NUMBER OF COPIES</Text>
            <View style={styles.copiesRow}>
              <TouchableOpacity
                style={styles.copyStepBtn}
                onPress={() => handleCopiesChange(-1)}
                disabled={printing}
              >
                <Icon name="minus" size={14} color="#007AFF" />
              </TouchableOpacity>
              <TextInput
                style={styles.copiesInput}
                keyboardType="numeric"
                value={copies}
                onChangeText={(val) => setCopies(val.replace(/\D/g, ''))}
                maxLength={3}
                editable={!printing}
              />
              <TouchableOpacity
                style={styles.copyStepBtn}
                onPress={() => handleCopiesChange(1)}
                disabled={printing}
              >
                <Icon name="plus" size={14} color="#007AFF" />
              </TouchableOpacity>

              {/* Quick count chips */}
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, copies === '1' && styles.chipActive]}
                  onPress={() => setCopies('1')}
                  disabled={printing}
                >
                  <Text style={[styles.chipText, copies === '1' && styles.chipTextActive]}>1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, copies === '5' && styles.chipActive]}
                  onPress={() => setCopies('5')}
                  disabled={printing}
                >
                  <Text style={[styles.chipText, copies === '5' && styles.chipTextActive]}>5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, copies === '10' && styles.chipActive]}
                  onPress={() => setCopies('10')}
                  disabled={printing}
                >
                  <Text style={[styles.chipText, copies === '10' && styles.chipTextActive]}>10</Text>
                </TouchableOpacity>
                {stockQuantity && stockQuantity > 0 ? (
                  <TouchableOpacity
                    style={[styles.chip, copies === String(stockQuantity) && styles.chipActive]}
                    onPress={handleSetStockCopies}
                    disabled={printing}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        copies === String(stockQuantity) && styles.chipTextActive,
                      ]}
                    >
                      Stock ({stockQuantity})
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Label Customization Toggles */}
            <Text style={styles.sectionLabel}>LABEL OPTIONS</Text>
            <View style={styles.togglesCard}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Include Store Name</Text>
                <Switch
                  value={includeStoreName}
                  onValueChange={setIncludeStoreName}
                  trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                  thumbColor={includeStoreName ? '#007AFF' : '#F1F5F9'}
                  disabled={printing}
                />
              </View>
              <View style={styles.toggleDivider} />
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Include Price ({currencySymbol})</Text>
                <Switch
                  value={includePrice}
                  onValueChange={setIncludePrice}
                  trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                  thumbColor={includePrice ? '#007AFF' : '#F1F5F9'}
                  disabled={printing}
                />
              </View>
              <View style={styles.toggleDivider} />
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Include Variant / Packaging</Text>
                <Switch
                  value={includeVariant}
                  onValueChange={setIncludeVariant}
                  trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                  thumbColor={includeVariant ? '#007AFF' : '#F1F5F9'}
                  disabled={printing}
                />
              </View>
            </View>

            {/* Paper Size Selector */}
            <Text style={styles.sectionLabel}>LABEL ROLL SIZE</Text>
            <View style={styles.paperSizeRow}>
              <TouchableOpacity
                style={[styles.sizeOption, paperWidth === '58mm' && styles.sizeOptionActive]}
                onPress={() => setPaperWidth('58mm')}
                disabled={printing}
              >
                <Text
                  style={[
                    styles.sizeOptionText,
                    paperWidth === '58mm' && styles.sizeOptionTextActive,
                  ]}
                >
                  58mm (Standard Roll / Sticker)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sizeOption, paperWidth === '80mm' && styles.sizeOptionActive]}
                onPress={() => setPaperWidth('80mm')}
                disabled={printing}
              >
                <Text
                  style={[
                    styles.sizeOptionText,
                    paperWidth === '80mm' && styles.sizeOptionTextActive,
                  ]}
                >
                  80mm / 2"x1" Tag
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={printing}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.printBtn, printing && styles.printBtnDisabled]}
              onPress={handlePrint}
              disabled={printing}
            >
              {printing ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
              ) : (
                <Icon name="print" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              )}
              <Text style={styles.printBtnText}>
                {printing ? 'Printing...' : `Print ${copies || '1'} Label${parseInt(copies, 10) > 1 ? 's' : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    padding: 8,
  },
  scrollArea: {
    marginVertical: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
  },
  stickerCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: 12,
    alignItems: 'center',
    marginVertical: 4,
  },
  stickerCard80mm: {
    borderColor: '#94A3B8',
    padding: 16,
  },
  previewStoreName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  previewProductName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 2,
  },
  previewVariantName: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
    marginBottom: 4,
  },
  previewPrice: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    marginVertical: 2,
  },
  barcodeSvgContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  noBarcodeText: {
    fontSize: 12,
    color: '#EF4444',
    fontStyle: 'italic',
    padding: 8,
  },
  previewMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 4,
  },
  previewMetaItem: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#475569',
    marginHorizontal: 4,
  },
  copiesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  copyStepBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  copiesInput: {
    width: 54,
    height: 38,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginHorizontal: 8,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  togglesCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  toggleDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  paperSizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
  },
  sizeOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  sizeOptionActive: {
    borderColor: '#007AFF',
    backgroundColor: '#EFF6FF',
  },
  sizeOptionText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  sizeOptionTextActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginTop: 6,
    gap: 10,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  printBtnDisabled: {
    backgroundColor: '#93C5FD',
  },
  printBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default BarcodeLabelPrintModal;
