import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';

const VariantManager = ({ variants = [], onVariantsChange, product, baseAmount = '', baseMrp = '', unit = '' }) => {
  const currentVariants = Array.isArray(variants) ? variants : (product?.product_variants || []);

  const handleAddVariant = () => {
    const newVariant = {
      name: '',
      variant_options: [{ value: '', price: baseAmount || '', mrp: baseMrp || '', quantity: '100' }],
    };
    onVariantsChange([...currentVariants, newVariant]);
  };

  const handleDeleteVariant = (vIndex) => {
    const updated = currentVariants.filter((_, i) => i !== vIndex);
    onVariantsChange(updated);
  };

  const handleVariantNameChange = (vIndex, text) => {
    const updated = currentVariants.map((variant, i) => {
      if (i !== vIndex) return variant;
      return { ...variant, name: text };
    });
    onVariantsChange(updated);
  };

  const handleAddOption = (vIndex) => {
    const updated = currentVariants.map((variant, i) => {
      if (i !== vIndex) return variant;
      const opts = variant.variant_options || [];
      return {
        ...variant,
        variant_options: [...opts, { value: '', price: baseAmount || '', mrp: baseMrp || '', quantity: '100' }],
      };
    });
    onVariantsChange(updated);
  };

  const handleOptionFieldChange = (vIndex, oIndex, field, text) => {
    const updated = currentVariants.map((variant, i) => {
      if (i !== vIndex) return variant;
      const opts = (variant.variant_options || []).map((opt, oi) => {
        if (oi !== oIndex) return opt;
        return { ...opt, [field]: text };
      });
      return { ...variant, variant_options: opts };
    });
    onVariantsChange(updated);
  };

  const handleDeleteOption = (vIndex, oIndex) => {
    const updated = currentVariants.map((variant, i) => {
      if (i !== vIndex) return variant;
      const opts = (variant.variant_options || []).filter((_, oi) => oi !== oIndex);
      return { ...variant, variant_options: opts };
    });
    onVariantsChange(updated);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Product Variants, Options & Prices</Text>
          <Text style={styles.subtitle}>
            Add variants (e.g. Size, Weight) and set their option names, prices, and stock in one place.
          </Text>
        </View>
      </View>

      {currentVariants.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="tags" size={24} color="#888" style={{ marginBottom: 6 }} />
          <Text style={styles.emptyText}>No variants added yet</Text>
          <Text style={styles.emptySubText}>
            Tap below to add options like Size (Small, Medium) or Weight (500g, 1kg) with individual prices.
          </Text>
        </View>
      ) : (
        currentVariants.map((variant, vIndex) => (
          <View key={vIndex} style={styles.variantCard}>
            <View style={styles.variantCardHeader}>
              <View style={styles.variantNumberBadge}>
                <Text style={styles.variantNumberText}>Variant #{vIndex + 1}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteVariantBtn}
                onPress={() => handleDeleteVariant(vIndex)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="trash" size={16} color="#E53935" />
                <Text style={styles.deleteVariantText}>Delete Variant</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Variant Name (e.g., Size, Weight, Color)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Size, Weight, Flavor, Pack Size"
              placeholderTextColor="#999"
              value={variant.name}
              onChangeText={(text) => handleVariantNameChange(vIndex, text)}
            />

            <View style={styles.optionsSection}>
              <Text style={styles.optionsSectionTitle}>
                Options & Pricing for {variant.name ? `"${variant.name}"` : `Variant #${vIndex + 1}`}
              </Text>

              {(variant.variant_options || []).map((option, oIndex) => (
                <View key={oIndex} style={styles.optionCard}>
                  <View style={styles.optionHeaderRow}>
                    <Icon name="tag" size={14} color="#007AFF" style={styles.optionIcon} />
                    <TextInput
                      style={styles.optionNameInput}
                      placeholder={`Option ${oIndex + 1} (e.g. ${oIndex === 0 ? 'Small, 500g, Red' : 'Medium, 1kg, Blue'})`}
                      placeholderTextColor="#aaa"
                      value={option.value}
                      onChangeText={(text) => handleOptionFieldChange(vIndex, oIndex, 'value', text)}
                    />
                    <TouchableOpacity
                      style={styles.deleteOptionBtn}
                      onPress={() => handleDeleteOption(vIndex, oIndex)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Icon name="trash-o" size={18} color="#dc3545" />
                    </TouchableOpacity>
                  </View>

                  {/* Calculate offer details for option */}
                  {(() => {
                    const optPrice = parseFloat(option.price) || 0;
                    const optMrp = parseFloat(option.mrp) || 0;
                    const hasOptOffer = optMrp > optPrice && optPrice > 0;
                    const optDiscount = hasOptOffer ? Math.round(((optMrp - optPrice) / optMrp) * 100) : 0;
                    const optSavings = hasOptOffer ? Math.round((optMrp - optPrice) * 100) / 100 : 0;

                    return (
                      <>
                        <View style={styles.optionPricingRow}>
                          <View style={styles.optionPricingField}>
                            <Text style={styles.optionFieldLabel}>Price (₹)</Text>
                            <TextInput
                              style={styles.optionPriceInput}
                              placeholder={baseAmount ? baseAmount.toString() : "0.00"}
                              placeholderTextColor="#aaa"
                              value={option.price !== undefined && option.price !== null ? option.price.toString() : ''}
                              onChangeText={(text) => handleOptionFieldChange(vIndex, oIndex, 'price', text)}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.optionPricingField}>
                            <Text style={styles.optionFieldLabel}>MRP (₹)</Text>
                            <TextInput
                              style={styles.optionPriceInput}
                              placeholder={baseMrp ? baseMrp.toString() : "Optional"}
                              placeholderTextColor="#aaa"
                              value={option.mrp !== undefined && option.mrp !== null ? option.mrp.toString() : ''}
                              onChangeText={(text) => handleOptionFieldChange(vIndex, oIndex, 'mrp', text)}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.optionPricingField}>
                            <Text style={styles.optionFieldLabel}>Stock Qty ({unit || 'units'})</Text>
                            <TextInput
                              style={styles.optionPriceInput}
                              placeholder="100"
                              placeholderTextColor="#aaa"
                              value={option.quantity !== undefined && option.quantity !== null ? option.quantity.toString() : ''}
                              onChangeText={(text) => handleOptionFieldChange(vIndex, oIndex, 'quantity', text)}
                              keyboardType="numeric"
                            />
                          </View>
                        </View>
                        {hasOptOffer && (
                          <View style={styles.optionOfferBadgeRow}>
                            <Text style={styles.optionOfferBadgeText}>
                              🎁 {optDiscount}% OFF (Save ₹{optSavings.toFixed(2)})
                            </Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                </View>
              ))}

              <TouchableOpacity
                style={styles.addOptionBtn}
                onPress={() => handleAddOption(vIndex)}
              >
                <Icon name="plus" size={12} color="#007AFF" style={{ marginRight: 6 }} />
                <Text style={styles.addOptionText}>Add Option Value</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addVariantBtn} onPress={handleAddVariant}>
        <Icon name="plus-circle" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.addVariantBtnText}>Add Another Variant</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 15,
    marginBottom: 10,
  },
  headerRow: {
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212529',
  },
  subtitle: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 2,
  },
  emptyContainer: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
  },
  emptySubText: {
    fontSize: 12,
    color: '#868e96',
    marginTop: 2,
    textAlign: 'center',
  },
  variantCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  variantCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  variantNumberBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  variantNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0d47a1',
  },
  deleteVariantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  deleteVariantText: {
    fontSize: 12,
    color: '#E53935',
    marginLeft: 4,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#ced4da',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#212529',
    marginBottom: 10,
  },
  optionsSection: {
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
  },
  optionsSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 8,
  },
  optionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  optionIcon: {
    marginRight: 8,
  },
  optionNameInput: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#ced4da',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    color: '#212529',
  },
  deleteOptionBtn: {
    padding: 4,
    marginLeft: 6,
  },
  optionPricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 22,
  },
  optionPricingField: {
    flex: 1,
    marginRight: 8,
  },
  optionFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6c757d',
    marginBottom: 2,
  },
  optionPriceInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ced4da',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: '#212529',
  },
  addOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: '#e7f3ff',
    marginTop: 2,
  },
  addOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  addVariantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    borderRadius: 6,
    marginTop: 4,
    marginBottom: 6,
  },
  addVariantBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  optionOfferBadgeRow: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    marginTop: 6,
    marginLeft: 22,
  },
  optionOfferBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
});

export default VariantManager;
