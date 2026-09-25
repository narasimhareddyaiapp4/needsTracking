import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  FlatList,
  Modal,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import UniversalDateTimePicker from './UniversalDateTimePicker';
import * as ImagePicker from 'expo-image-picker';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  supabase,
  createProduct,
  saveProductMedia,
  createProductVariant,
  createVariantOption,
  deleteProductVariants,
  createProductVariantCombination,
  getCategories,
  getSubcategories,
  DEFAULT_MASTER_CATEGORIES,
} from '../services/supabase';
import { Video } from 'expo-av';
import VariantManager from './VariantManager';
import { showAlert } from '../utils/alertUtils';
import FullScreenImageViewer from './FullScreenImageViewer';

const MAX_VIDEO_SIZE_MB = 50; // Define max video size

export const PRODUCT_CATEGORIES = DEFAULT_MASTER_CATEGORIES.map(c => ({
  label: c.name,
  value: c.code,
}));


const generateVariantCombinations = (variants, basePrice = 0, baseMrp = null) => {
  const activeVariants = (variants || [])
    .map(v => {
      const name = (v.name || '').trim();
      const validOptions = (v.variant_options || [])
        .map(o => ({
          ...o,
          value: (typeof o === 'string' ? o : o?.value || '').trim(),
          price: typeof o === 'object' && o?.price !== undefined && o?.price !== '' && o?.price !== null
            ? (parseFloat(o.price) || 0)
            : undefined,
          mrp: typeof o === 'object' && o?.mrp !== undefined && o?.mrp !== '' && o?.mrp !== null
            ? (parseFloat(o.mrp) || null)
            : undefined,
          quantity: typeof o === 'object' && o?.quantity !== undefined && o?.quantity !== '' && o?.quantity !== null
            ? (parseInt(o.quantity, 10) || 100)
            : undefined,
        }))
        .filter(o => o.value.length > 0);
      return { ...v, name, variant_options: validOptions };
    })
    .filter(v => v.name.length > 0 && v.variant_options.length > 0);

  const parsedBaseMrp = baseMrp ? parseFloat(baseMrp) || null : null;

  if (activeVariants.length === 0) {
    return [{ combination_string: 'Default', sku: '', price: basePrice, mrp: parsedBaseMrp, quantity: 100 }];
  }

  let combinations = [];

  const generate = (index, currentParts, currentSku, lastPrice, lastMrp, lastQuantity) => {
    if (index === activeVariants.length) {
      combinations.push({
        combination_string: currentParts.join(', '),
        sku: currentSku,
        price: lastPrice !== undefined && lastPrice !== null ? (parseFloat(lastPrice) || 0) : basePrice,
        mrp: lastMrp !== undefined && lastMrp !== null ? (parseFloat(lastMrp) || null) : parsedBaseMrp,
        quantity: lastQuantity !== undefined && lastQuantity !== null ? (parseInt(lastQuantity, 10) || 100) : 100,
      });
      return;
    }

    const variant = activeVariants[index];
    for (const option of variant.variant_options) {
      const optPrice = (option.price !== undefined && option.price !== '' && option.price !== null) ? option.price : lastPrice;
      const optMrp = (option.mrp !== undefined && option.mrp !== '' && option.mrp !== null) ? option.mrp : lastMrp;
      const optQty = (option.quantity !== undefined && option.quantity !== '' && option.quantity !== null) ? option.quantity : lastQuantity;
      generate(
        index + 1,
        [...currentParts, `${variant.name}:${option.value}`],
        currentSku ? `${currentSku}-${option.value}` : option.value,
        optPrice,
        optMrp,
        optQty
      );
    }
  };

  generate(0, [], '', undefined, undefined, undefined);
  return combinations;
};

const syncVariantCombinations = (variants, currentCombos = [], baseAmount = 0, baseMrp = null) => {
  const basePrice = parseFloat(baseAmount) || 0;
  const parsedBaseMrp = baseMrp ? parseFloat(baseMrp) || null : null;
  const generated = generateVariantCombinations(variants, basePrice, parsedBaseMrp);

  const hasActiveVariants = (variants || []).some(
    v => (v.name || '').trim() && (v.variant_options || []).some(o => ((typeof o === 'string' ? o : o?.value) || '').trim())
  );

  if (!hasActiveVariants) {
    const existingDefault = (currentCombos || []).find(c => c.combination_string === 'Default');
    return [{
      combination_string: 'Default',
      sku: existingDefault?.sku || '',
      price: basePrice,
      mrp: existingDefault?.mrp !== undefined ? existingDefault.mrp : parsedBaseMrp,
      quantity: existingDefault?.quantity !== undefined ? existingDefault.quantity : 100,
    }];
  }

  return generated.map(newCombo => {
    const match = (currentCombos || []).find(oldCombo => {
      if (!oldCombo || !oldCombo.combination_string) return false;
      return oldCombo.combination_string.replace(/\s/g, '').toLowerCase() === newCombo.combination_string.replace(/\s/g, '').toLowerCase();
    });

    return {
      ...newCombo,
      id: match?.id,
      price: (newCombo.price !== undefined && newCombo.price !== null) ? newCombo.price : (match?.price !== undefined ? match.price : basePrice),
      mrp: (newCombo.mrp !== undefined && newCombo.mrp !== null) ? newCombo.mrp : (match?.mrp !== undefined ? match.mrp : parsedBaseMrp),
      quantity: (newCombo.quantity !== undefined && newCombo.quantity !== null) ? newCombo.quantity : (match?.quantity !== undefined ? match.quantity : 100),
      sku: match?.sku || newCombo.sku || '',
    };
  });
};

const isImageMedia = (media) => {
  if (!media) return false;
  const type = (media.type || media.media_type || '').toLowerCase();
  const url = media.uri || media.media_url || '';
  if (type === 'video') return false;
  if (type === 'image' || type === 'url' || !type) return true;
  if (type.startsWith('image/')) return true;
  if (typeof url === 'string' && /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url)) return true;
  return true;
};

const ProductFormModal = ({ isVisible, onClose, onSubmit, productToEdit, customerMediaUrl, onDeleteMedia, onDeleteProduct, session }) => {
  const userId = session?.user?.id || session?.id; // Get userId from session
  const accessToken = session?.access_token; // Get access token for media upload
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [mrp, setMrp] = useState('');
  const [productType, setProductType] = useState('grocery');
  const [categoriesList, setCategoriesList] = useState([]);
  const [subcategoriesList, setSubcategoriesList] = useState([]);
  const [subcategoryId, setSubcategoryId] = useState('');
  const [subcategoryName, setSubcategoryName] = useState('');
  const [unit, setUnit] = useState('');
  const [stockQuantity, setStockQuantity] = useState('100');
  const [productVariants, setProductVariants] = useState([]);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [visibleFrom, setVisibleFrom] = useState(new Date());
  const [visibleTo, setVisibleTo] = useState(new Date());
  const [showVisibleFromPicker, setShowVisibleFromPicker] = useState(false);
  const [showVisibleToPicker, setShowVisibleToPicker] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [displayOrder, setDisplayOrder] = useState('0');
  const [variantCombinations, setVariantCombinations] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState([]); // Stores URIs of selected images/videos
  const [loading, setLoading] = useState(false);
  const [showModalMediaViewer, setShowModalMediaViewer] = useState(false);
  const [currentModalMediaIndex, setCurrentModalMediaIndex] = useState(0);
  const [allModalMediaForViewer, setAllModalMediaForViewer] = useState([]);

  const [showMatrix, setShowMatrix] = useState(false);

  // Load categories from DB when modal is shown
  useEffect(() => {
    let isMounted = true;
    const loadCats = async () => {
      try {
        const cats = await getCategories(false);
        if (isMounted && cats && cats.length > 0) {
          setCategoriesList(cats);
        }
      } catch (err) {
        console.warn('Error loading categories in ProductFormModal:', err);
      }
    };
    if (isVisible) {
      loadCats();
    }
    return () => { isMounted = false; };
  }, [isVisible]);

  // Dynamically load subcategories whenever category (productType) changes
  useEffect(() => {
    let isMounted = true;
    const loadSubs = async () => {
      try {
        const cat = categoriesList.find(c => c.code === productType || c.id === productType);
        const subs = await getSubcategories(cat?.id, cat?.code || productType, false);
        if (isMounted) {
          setSubcategoriesList(subs || []);
          if (subcategoryId) {
            const match = (subs || []).find(s => s.id === subcategoryId || s.code === subcategoryId);
            if (!match) {
              setSubcategoryId('');
              setSubcategoryName('');
            }
          }
        }
      } catch (err) {
        console.warn('Error loading subcategories in ProductFormModal:', err);
      }
    };
    if (productType) {
      loadSubs();
    }
    return () => { isMounted = false; };
  }, [productType, categoriesList]);

  useEffect(() => {
    if (productToEdit) {
      setProductName(productToEdit.product_name || '');
      setDescription(productToEdit.description || '');
      setAmount(productToEdit.amount !== undefined && productToEdit.amount !== null ? productToEdit.amount.toString() : '');
      setMrp(productToEdit.mrp !== undefined && productToEdit.mrp !== null ? productToEdit.mrp.toString() : '');
      setProductType(productToEdit.product_type || 'grocery');
      setSubcategoryId(productToEdit.subcategory_id || productToEdit.subcategory || '');
      setSubcategoryName(productToEdit.subcategory || '');
      setUnit(productToEdit.unit || '');
      setStartDate(productToEdit.start_date ? new Date(productToEdit.start_date) : new Date());
      setEndDate(productToEdit.end_date ? new Date(productToEdit.end_date) : new Date());
      if (productToEdit.visible_from) {
        setVisibleFrom(new Date(productToEdit.visible_from));
      }
      if (productToEdit.visible_to) {
        setVisibleTo(new Date(productToEdit.visible_to));
      }
      setIsActive(productToEdit.is_active !== undefined ? productToEdit.is_active : true);
      setDisplayOrder(productToEdit.display_order ? productToEdit.display_order.toString() : '0');
      setSelectedMedia(productToEdit.product_media ? productToEdit.product_media.map(media => ({
        uri: media.media_url,
        type: media.media_type || 'image',
        id: media.id
      })) : []);
      
      const loadedCombinations = productToEdit.product_variant_combinations || [];
      if (loadedCombinations.length > 0 && loadedCombinations[0].quantity !== undefined && loadedCombinations[0].quantity !== null) {
        setStockQuantity(loadedCombinations[0].quantity.toString());
      } else {
        setStockQuantity('100');
      }

      const loadedVariants = (productToEdit.product_variants || []).map(v => ({
        ...v,
        variant_options: (v.variant_options || []).map(o => {
          const optVal = (typeof o === 'string' ? o : o?.value || '').trim();
          const matchCombo = (loadedCombinations || []).find(c => {
            const parts = (c.combination_string || '').split(',').map(p => p.trim());
            return parts.some(p => p.endsWith(`:${optVal}`) || p === optVal);
          });
          return {
            ...(typeof o === 'object' ? o : { value: o }),
            value: optVal,
            price: matchCombo?.price !== undefined ? matchCombo.price : (o.price !== undefined ? o.price : productToEdit.amount),
            mrp: matchCombo?.mrp !== undefined ? matchCombo.mrp : (o.mrp !== undefined ? o.mrp : (productToEdit.mrp || null)),
            quantity: matchCombo?.quantity !== undefined ? matchCombo.quantity : (o.quantity !== undefined ? o.quantity : 100),
          };
        }),
      }));

      setProductVariants(loadedVariants);
      if (loadedCombinations.length > 0) {
        setVariantCombinations(loadedCombinations);
      } else {
        setVariantCombinations(syncVariantCombinations(loadedVariants, [], productToEdit.amount, productToEdit.mrp));
      }
    } else {
      setProductName('');
      setDescription('');
      setAmount('');
      setMrp('');
      setProductType('grocery');
      setSubcategoryId('');
      setSubcategoryName('');
      setUnit('');
      setStockQuantity('100');
      setStartDate(new Date());
      setEndDate(new Date());
      setVisibleFrom(new Date());
      setVisibleTo(new Date());
      setIsActive(true);
      setDisplayOrder('0');
      setSelectedMedia([]);
      setProductVariants([]);
      setVariantCombinations([{
        combination_string: 'Default',
        sku: '',
        price: 0,
        mrp: null,
        quantity: 100,
      }]);
    }
  }, [productToEdit]);

  const handleVariantsChange = (newVariants) => {
    setProductVariants(newVariants);
    setVariantCombinations(prevCombos => syncVariantCombinations(newVariants, prevCombos, amount, mrp));
  };

  const handleAmountChange = (newAmount) => {
    setAmount(newAmount);
    setVariantCombinations(prevCombos => {
      if (prevCombos.length === 1 && prevCombos[0].combination_string === 'Default') {
        return [{
          ...prevCombos[0],
          price: parseFloat(newAmount) || 0,
        }];
      }
      return prevCombos;
    });
  };

  const handleMrpChange = (newMrp) => {
    setMrp(newMrp);
    setVariantCombinations(prevCombos => {
      if (prevCombos.length === 1 && prevCombos[0].combination_string === 'Default') {
        return [{
          ...prevCombos[0],
          mrp: (newMrp !== '' && !isNaN(parseFloat(newMrp))) ? parseFloat(newMrp) : null,
        }];
      }
      return prevCombos;
    });
  };

  const handleComboPriceChange = (index, text) => {
    setVariantCombinations(prevCombos => {
      const updated = [...prevCombos];
      updated[index] = {
        ...updated[index],
        price: text === '' ? '' : (parseFloat(text) || text),
      };
      return updated;
    });
  };

  const handleComboMrpChange = (index, text) => {
    setVariantCombinations(prevCombos => {
      const updated = [...prevCombos];
      updated[index] = {
        ...updated[index],
        mrp: text === '' ? null : (parseFloat(text) || text),
      };
      return updated;
    });
  };

  const handleComboQuantityChange = (index, text) => {
    setVariantCombinations(prevCombos => {
      const updated = [...prevCombos];
      updated[index] = {
        ...updated[index],
        quantity: text === '' ? '' : (parseInt(text, 10) || text),
      };
      return updated;
    });
  };

  const handleMediaPick = async (mediaType) => {
    try {
      let result;
      if (mediaType === 'image') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 1,
        });
      } else if (mediaType === 'video') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsMultipleSelection: true,
          quality: 1,
        });
      }

      if (result && !result.canceled && result.assets && result.assets.length > 0) {
        const newMedia = [];
        for (const asset of result.assets) {
          if (mediaType === 'video' && asset.size && asset.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
            showAlert('Video Too Large', `Video file ${asset.name || 'selected'} exceeds the maximum size of ${MAX_VIDEO_SIZE_MB} MB.`);
            continue;
          }
          if (asset.uri) {
            newMedia.push({ uri: asset.uri, type: mediaType });
          }
        }
        setSelectedMedia((prevMedia) => [
          ...prevMedia,
          ...newMedia,
        ]);
      }
    } catch (err) {
      console.warn('Error selecting media:', err);
      showAlert('Media Selection', 'Could not open file picker. Please try again.');
    }
  };

  const handleRemoveMedia = async (mediaToRemove) => {
    if (mediaToRemove.id) {
      if (onDeleteMedia) {
        const success = await onDeleteMedia(mediaToRemove.id, mediaToRemove.uri);
        if (success) {
          setSelectedMedia(prevMedia => prevMedia.filter(media => media.id !== mediaToRemove.id));
        }
      }
    } else {
      setSelectedMedia(prevMedia => prevMedia.filter(media => media.uri !== mediaToRemove.uri));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    if (!userId) {
      showAlert("Error", "User ID is missing. Cannot create/edit product.");
      setLoading(false);
      return;
    }

    const matchingCat = categoriesList.find(c => c.code === productType || c.id === productType);
    const selectedCatId = matchingCat?.id && matchingCat.id !== matchingCat.code ? matchingCat.id : null;
    const selectedSub = subcategoriesList.find(s => s.id === subcategoryId || s.code === subcategoryId);

    const parsedMrp = (mrp !== '' && !isNaN(parseFloat(mrp))) ? parseFloat(mrp) : null;

    const productData = {
      user_id: userId,
      product_name: productName,
      description: description,
      amount: parseFloat(amount),
      mrp: parsedMrp,
      product_type: matchingCat?.code || productType,
      unit: unit,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      visible_from: visibleFrom.toISOString(),
      visible_to: visibleTo.toISOString(),
      is_active: isActive,
      display_order: parseInt(displayOrder, 10),
    };

    if (selectedCatId) {
      productData.category_id = selectedCatId;
    }
    if (selectedSub?.id && selectedSub.id !== selectedSub.code) {
      productData.subcategory_id = selectedSub.id;
    }
    if (selectedSub?.name || subcategoryName) {
      productData.subcategory = selectedSub?.name || subcategoryName;
    }

    let productResult;
    if (productToEdit) {
      let { data, error } = await supabase
        .from('products')
        .update(productData)
        .eq('id', productToEdit.id)
        .select();

      if (error && (error.code === 'PGRST204' || (error.message && error.message.includes('column')))) {
        console.warn('Retrying product update without category/subcategory columns:', error.message);
        const fallbackData = { ...productData };
        delete fallbackData.category_id;
        delete fallbackData.subcategory_id;
        delete fallbackData.subcategory;
        if (error.message && error.message.includes('mrp')) {
          delete fallbackData.mrp;
        }
        const retry = await supabase.from('products').update(fallbackData).eq('id', productToEdit.id).select();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error("Error updating product:", error.message);
        showAlert("Error", "Failed to update product.");
        setLoading(false);
        return;
      }
      productResult = data ? data[0] : null;
    } else {
      productResult = await createProduct(productData);
    }

    if (productResult) {
      try {
        // Clear any auto-generated or previous variant combinations to prevent duplicates
        await deleteProductVariants(productResult.id);

        const activeVariants = (productVariants || []).filter(
          v => (v.name || '').trim() && (v.variant_options || []).some(o => ((typeof o === 'string' ? o : o?.value) || '').trim())
        );

        for (const variant of activeVariants) {
          const variantName = variant.name.trim();
          const validOptions = (variant.variant_options || [])
            .map(o => (typeof o === 'string' ? o : o?.value || '').trim())
            .filter(v => v.length > 0);

          if (validOptions.length === 0) continue;

          const variantResult = await createProductVariant({
            product_id: productResult.id,
            name: variantName,
          });

          if (variantResult) {
            for (const optVal of validOptions) {
              await createVariantOption({
                variant_id: variantResult.id,
                value: optVal,
              });
            }
          }
        }

        // Generate and save product variant combinations
        const defaultQty = parseInt(stockQuantity, 10);
        const validDefaultQty = !isNaN(defaultQty) ? defaultQty : 100;

        const combosToSave = (activeVariants.length > 0 && variantCombinations && variantCombinations.length > 0)
          ? variantCombinations
          : [{ combination_string: 'Default', sku: '', price: parseFloat(amount) || 0, mrp: parsedMrp, quantity: validDefaultQty }];

        for (const combo of combosToSave) {
          const priceVal = typeof combo.price === 'number'
            ? combo.price
            : (parseFloat(combo.price) || parseFloat(amount) || 0);
          const mrpVal = combo.mrp !== undefined && combo.mrp !== null && combo.mrp !== '' && !isNaN(parseFloat(combo.mrp))
            ? parseFloat(combo.mrp)
            : parsedMrp;
          const qtyVal = typeof combo.quantity === 'number'
            ? combo.quantity
            : (parseInt(combo.quantity, 10) !== undefined && !isNaN(parseInt(combo.quantity, 10)) ? parseInt(combo.quantity, 10) : validDefaultQty);

          await createProductVariantCombination({
            product_id: productResult.id,
            combination_string: combo.combination_string || 'Default',
            price: priceVal,
            mrp: mrpVal,
            quantity: qtyVal,
            sku: combo.sku || '',
          });
        }

        let mediaErrors = 0;
        for (const media of selectedMedia.filter(m => !m.id)) {
          const mediaUrl = await saveProductMedia(productResult.id, media.uri, media.type, userId, accessToken);
          if (!mediaUrl) {
            console.warn("Failed to upload media:", media.uri);
            mediaErrors++;
          }
        }

        if (mediaErrors > 0) {
          showAlert("Notice", `Product saved successfully, but ${mediaErrors} image(s) could not be uploaded.`);
        }

        onSubmit();
        onClose();
      } catch (e) {
        console.error("Error saving product details:", e.message);
        showAlert("Error", `Failed to save product details: ${e.message}`);
      }
    } else {
      showAlert("Error", "Failed to save product.");
    }
    setLoading(false);
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Icon name="times-circle" size={24} color="#333" />
          </TouchableOpacity>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalTitle}>{productToEdit ? 'Edit Product' : 'Add New Product'}</Text>

            <Text style={styles.label}>Product Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter product name"
              value={productName}
              onChangeText={setProductName}
            />
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder="Enter product description"
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Text style={styles.label}>Base Price / Amount (₹)</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter selling price (e.g. 150)"
              value={amount}
              onChangeText={handleAmountChange}
              keyboardType="numeric"
            />

            <Text style={styles.label}>MRP / Original Price (₹) (Optional - for Offer / Discount)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 200 (strike-through price)"
              value={mrp}
              onChangeText={handleMrpChange}
              keyboardType="numeric"
            />

            {(() => {
              const sellP = parseFloat(amount) || 0;
              const origP = parseFloat(mrp) || 0;
              if (origP > sellP && sellP > 0) {
                const disc = Math.round(((origP - sellP) / origP) * 100);
                const sav = Math.round((origP - sellP) * 100) / 100;
                return (
                  <View style={styles.liveOfferBadgeBox}>
                    <Text style={styles.liveOfferBadgeText}>
                      🎉 Live Offer: {disc}% OFF (Buyer saves ₹{sav.toFixed(2)})
                    </Text>
                  </View>
                );
              }
              return null;
            })()}

            <Text style={styles.label}>Product Category</Text>
            <Picker
              selectedValue={productType}
              style={styles.picker}
              onValueChange={(itemValue) => setProductType(itemValue)}
            >
              {(categoriesList && categoriesList.length > 0
                ? categoriesList
                : PRODUCT_CATEGORIES.map(c => ({ id: c.value, code: c.value, name: c.label }))
              ).map((cat) => (
                <Picker.Item key={cat.code || cat.id} label={cat.name || cat.label} value={cat.code || cat.id} />
              ))}
            </Picker>

            <Text style={styles.label}>Product Subcategory</Text>
            <Picker
              selectedValue={subcategoryId}
              style={styles.picker}
              onValueChange={(itemValue) => {
                setSubcategoryId(itemValue);
                const sub = subcategoriesList.find(s => s.id === itemValue || s.code === itemValue);
                setSubcategoryName(sub ? sub.name : '');
              }}
            >
              <Picker.Item label="-- None / General --" value="" />
              {subcategoriesList.map((sub) => (
                <Picker.Item key={sub.id || sub.code} label={sub.name} value={sub.id || sub.code} />
              ))}
            </Picker>

            <Text style={styles.label}>Unit</Text>
            <Picker
              selectedValue={unit}
              style={styles.picker}
              onValueChange={(itemValue) => setUnit(itemValue)}
            >
              <Picker.Item label="Pcs (Pieces)" value="pcs" />
              <Picker.Item label="Kg (Kilograms)" value="kg" />
              <Picker.Item label="Grams (g)" value="grams" />
              <Picker.Item label="Litre (L)" value="l" />
              <Picker.Item label="ml (Millilitres)" value="ml" />
              <Picker.Item label="Pack / Box" value="pack" />
              <Picker.Item label="Dozen" value="dozen" />
              <Picker.Item label="Meter (m)" value="meter" />
            </Picker>

            {(!productVariants || productVariants.length === 0 || !productVariants.some(v => (v.name || '').trim())) && (
              <View style={{ marginBottom: 6 }}>
                <Text style={styles.label}>Available Stock Quantity ({unit || 'units'})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 100"
                  value={stockQuantity}
                  onChangeText={setStockQuantity}
                  keyboardType="numeric"
                />
              </View>
            )}

            <VariantManager
              variants={productVariants}
              onVariantsChange={handleVariantsChange}
              baseAmount={amount}
              baseMrp={mrp}
              unit={unit}
            />

            {productVariants.filter(v => (v.name || '').trim() && (v.variant_options || []).some(o => ((typeof o === 'string' ? o : o?.value) || '').trim())).length > 1 && variantCombinations.length > 0 && (
              <View style={styles.matrixToggleContainer}>
                <TouchableOpacity 
                  style={styles.matrixToggleHeader}
                  onPress={() => setShowMatrix(!showMatrix)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <View style={styles.matrixTitleRow}>
                      <Icon name="sliders" size={15} color="#007AFF" style={{ marginRight: 6 }} />
                      <Text style={styles.matrixToggleTitle}>
                        Custom Combination Matrix (Optional)
                      </Text>
                    </View>
                    <Text style={styles.matrixToggleSubtitle}>
                      {showMatrix
                        ? 'Tap to collapse. (Option prices are automatically used by default)'
                        : 'Tap to manually override prices/stock for specific multi-attribute combinations (e.g., Small + Red).'}
                    </Text>
                  </View>
                  <Icon name={showMatrix ? "chevron-up" : "chevron-down"} size={16} color="#007AFF" />
                </TouchableOpacity>

                {showMatrix && (
                  <View style={styles.combinationsContainer}>
                    <View style={styles.combinationsHeader}>
                      <Text style={styles.combinationsTitle}>Multi-Variant Cross Combinations</Text>
                      <Text style={styles.combinationsSubtitle}>
                        Customize individual cross-combination prices and stock below:
                      </Text>
                    </View>

                {variantCombinations.map((combo, index) => {
                  const parts = (combo.combination_string || '')
                    .split(',')
                    .map(p => p.trim())
                    .filter(Boolean);

                  return (
                    <View key={index} style={styles.combinationCard}>
                      <View style={styles.combinationCardHeader}>
                        <Text style={styles.comboIndexText}>Option #{index + 1}</Text>
                        <View style={styles.badgesWrapper}>
                          {parts.length === 0 ? (
                            <View style={styles.comboBadge}>
                              <Text style={styles.comboBadgeValue}>{combo.combination_string || 'Default'}</Text>
                            </View>
                          ) : (
                            parts.map((part, pIdx) => {
                              const colonIdx = part.indexOf(':');
                              const vName = colonIdx > -1 ? part.substring(0, colonIdx).trim() : '';
                              const vVal = colonIdx > -1 ? part.substring(colonIdx + 1).trim() : part.trim();
                              return (
                                <View key={pIdx} style={styles.comboBadge}>
                                  {vName ? <Text style={styles.comboBadgeName}>{vName}: </Text> : null}
                                  <Text style={styles.comboBadgeValue}>{vVal}</Text>
                                </View>
                              );
                            })
                          )}
                        </View>
                      </View>

                      <View style={styles.comboInputsRow}>
                        <View style={styles.comboInputGroup}>
                          <Text style={styles.comboInputLabel}>Price (₹)</Text>
                          <TextInput
                            style={styles.comboInput}
                            placeholder="0.00"
                            value={combo.price !== undefined && combo.price !== null ? combo.price.toString() : ''}
                            onChangeText={(text) => handleComboPriceChange(index, text)}
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={styles.comboInputGroup}>
                          <Text style={styles.comboInputLabel}>MRP (₹)</Text>
                          <TextInput
                            style={styles.comboInput}
                            placeholder="Optional"
                            value={combo.mrp !== undefined && combo.mrp !== null ? combo.mrp.toString() : ''}
                            onChangeText={(text) => handleComboMrpChange(index, text)}
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={styles.comboInputGroup}>
                          <Text style={styles.comboInputLabel}>Stock Qty ({unit || 'units'})</Text>
                          <TextInput
                            style={styles.comboInput}
                            placeholder="100"
                            value={combo.quantity !== undefined && combo.quantity !== null ? combo.quantity.toString() : ''}
                            onChangeText={(text) => handleComboQuantityChange(index, text)}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

            <TouchableOpacity onPress={() => setShowStartDatePicker(true)} style={styles.datePickerButton}>
              <Text>Start Date: {startDate.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <UniversalDateTimePicker
              isVisible={showStartDatePicker}
              mode="date"
              onConfirm={(date) => {
                setShowStartDatePicker(false);
                setStartDate(date);
              }}
              onCancel={() => setShowStartDatePicker(false)}
              date={startDate}
            />

            <TouchableOpacity onPress={() => setShowEndDatePicker(true)} style={styles.datePickerButton}>
              <Text>End Date: {endDate.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <UniversalDateTimePicker
              isVisible={showEndDatePicker}
              mode="date"
              onConfirm={(date) => {
                setShowEndDatePicker(false);
                setEndDate(date);
              }}
              onCancel={() => setShowEndDatePicker(false)}
              date={endDate}
            />

            <TouchableOpacity onPress={() => setShowVisibleFromPicker(true)} style={styles.datePickerButton}>
              <Text>Visible From: {visibleFrom.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </TouchableOpacity>
            <UniversalDateTimePicker
              isVisible={showVisibleFromPicker}
              mode="time"
              onConfirm={(date) => {
                setShowVisibleFromPicker(false);
                setVisibleFrom(date);
              }}
              onCancel={() => setShowVisibleFromPicker(false)}
              date={visibleFrom}
            />

            <TouchableOpacity onPress={() => setShowVisibleToPicker(true)} style={styles.datePickerButton}>
              <Text>Visible To: {visibleTo.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </TouchableOpacity>
            <UniversalDateTimePicker
              isVisible={showVisibleToPicker}
              mode="time"
              onConfirm={(date) => {
                setShowVisibleToPicker(false);
                setVisibleTo(date);
              }}
              onCancel={() => setShowVisibleToPicker(false)}
              date={visibleTo}
            />

            <View style={styles.switchContainer}>
              <Text style={styles.label}>Product Active</Text>
              <Switch
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={isActive ? "#f5dd4b" : "#f4f3f4"}
                ios_backgroundColor="#3e3e3e"
                onValueChange={setIsActive}
                value={isActive}
              />
            </View>

            <Text style={styles.label}>Display Order</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter display order"
              value={displayOrder}
              onChangeText={setDisplayOrder}
              keyboardType="numeric"
            />

            <View style={styles.mediaPickerContainer}>
              <TouchableOpacity onPress={() => handleMediaPick('image')} style={styles.mediaButton}>
                <Text style={styles.mediaButtonText}>Pick Image</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleMediaPick('video')} style={styles.mediaButton}>
                <Text style={styles.mediaButtonText}>Pick Video</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.selectedMediaContainer}>
              <FlatList
                data={selectedMedia}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(media, index) => media.id ? media.id.toString() : `new-${index}`}
                renderItem={({ item: media, index }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setAllModalMediaForViewer(selectedMedia);
                      setCurrentModalMediaIndex(index);
                      setShowModalMediaViewer(true);
                    }}
                    style={styles.thumbnailContainer}
                  >
                    {isImageMedia(media) ? (
                      <Image source={{ uri: media.uri }} style={styles.thumbnail} />
                    ) : (
                      <Text style={styles.thumbnailText}>Video</Text>
                    )}
                    <TouchableOpacity onPress={() => handleRemoveMedia(media)} style={styles.removeMediaButton}>
                      <Icon name="times-circle" size={20} color="red" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                )}
              />
            </View>
          </ScrollView>
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.bottomButton}
              onPress={handleSubmit}
              disabled={loading}
            >
              <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Save Product'}</Text>
            </TouchableOpacity>

            {productToEdit && (
              <TouchableOpacity
                style={[styles.bottomButton, styles.deleteButton]}
                onPress={() => {
                  onDeleteProduct(productToEdit.id);
                  onClose();
                }}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Delete Product</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Full-Screen Media Viewer with Horizontal Scrolling & Thumbnails */}
        <FullScreenImageViewer
          visible={showModalMediaViewer}
          mediaList={allModalMediaForViewer}
          initialIndex={currentModalMediaIndex}
          onClose={() => setShowModalMediaViewer(false)}
          title={productName || 'Product Media'}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? 16 : 0,
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    width: '100%',
    maxWidth: 720,
    height: Platform.OS === 'web' ? '90vh' : '88%',
    maxHeight: Platform.OS === 'web' ? '90vh' : '88%',
    borderRadius: 16,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  buttonContainer: {
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 16 : 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    fontSize: 16,
  },
  picker: {
    height: 50,
    width: '100%',
    marginBottom: 10,
  },
  combinationsContainer: {
    marginTop: 15,
    marginBottom: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  combinationsHeader: {
    marginBottom: 12,
  },
  combinationsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212529',
  },
  combinationsSubtitle: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 2,
  },
  combinationCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#dee2e6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  combinationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  comboIndexText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0d47a1',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  badgesWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    flex: 1,
  },
  comboBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  comboBadgeName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2e7d32',
  },
  comboBadgeValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1b5e20',
  },
  comboInputsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  comboInputGroup: {
    flex: 1,
    marginHorizontal: 4,
  },
  comboInputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 4,
  },
  comboInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ced4da',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#212529',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  datePickerButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    alignItems: 'center',
  },
  mediaPickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  mediaButton: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  mediaButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  selectedMediaContainer: {
    flexDirection: 'row',
    marginBottom: 10,
    width: '100%',
  },
  thumbnailContainer: {
    position: 'relative',
    margin: 5,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 5,
  },
  thumbnailText: {
    width: 80,
    height: 80,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 10,
    backgroundColor: '#f0f0f0',
  },
  removeMediaButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 2,
  },
  button: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  bottomButton: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
  },
  deleteButton: {
    backgroundColor: '#dc3545',
    marginTop: 0,
  },
  modalMediaViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalMediaViewerCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1,
  },
  modalFullScreenMedia: {
    width: '100%',
    height: '80%',
  },
  modalNoMediaText: {
    color: 'white',
    fontSize: 18,
  },
  modalMediaNavButton: {
    position: 'absolute',
    top: '50%',
    zIndex: 1,
    padding: 10,
  },
  modalMediaNavButtonLeft: {
    left: 10,
  },
  modalMediaNavButtonRight: {
    right: 10,
  },
  liveOfferBadgeBox: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  liveOfferBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
});

export default ProductFormModal;