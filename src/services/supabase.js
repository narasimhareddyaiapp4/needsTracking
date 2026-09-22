import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system'; // Import FileSystem
import { Buffer } from 'buffer';

WebBrowser.maybeCompleteAuthSession();

let Storage;
if (Platform.OS === 'web') {
  Storage = {
    getItem: async (key) => window.localStorage.getItem(key),
    setItem: async (key, value) => window.localStorage.setItem(key, value),
    removeItem: async (key) => window.localStorage.removeItem(key),
  };
} else {
  Storage = require('@react-native-async-storage/async-storage').default;
}

// Credentials resolution for Standalone / APK / EAS / Web / Expo Go builds
const DEFAULT_SUPABASE_URL = 'https://cikxysaxvbixrcwlgzds.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpa3h5c2F4dmJpeHJjd2xnemRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzA2MjgsImV4cCI6MjEwNDIwNjYyOH0.YIc4KXr055r1D3-mKW1bCn06GNWWK4TXettqhazgpg4';

const getValidString = (val) => (typeof val === 'string' && val.trim().length > 0 ? val.trim() : null);

const supabaseUrl =
  getValidString(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
  getValidString(process.env.SUPABASE_URL) ||
  getValidString(Constants?.expoConfig?.extra?.SUPABASE_URL) ||
  DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  getValidString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
  getValidString(process.env.SUPABASE_ANON_KEY) ||
  getValidString(Constants?.expoConfig?.extra?.SUPABASE_ANON_KEY) ||
  DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: Storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

export async function getTransactionsByCustomerId(customerId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('customer_id', customerId);

  if (error) {
    console.error('Error fetching transactions:', error.message);
    return null;
  }
  return data;
}

export async function createProduct(productData) {
  let { data, error } = await supabase
    .from('products')
    .insert([productData])
    .select();

  if (error && (error.code === 'PGRST204' || (error.message && error.message.includes('column')))) {
    console.warn('Retrying createProduct without category_id/subcategory fields:', error.message);
    const fallbackData = { ...productData };
    delete fallbackData.category_id;
    delete fallbackData.subcategory_id;
    delete fallbackData.subcategory;
    const retry = await supabase.from('products').insert([fallbackData]).select();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error('Error creating product:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export function extractFileDetails(uri, defaultMediaType = 'image') {
  const isVideo = defaultMediaType === 'video';
  let extension = isVideo ? 'mp4' : 'jpg';
  let contentType = isVideo ? 'video/mp4' : 'image/jpeg';

  if (typeof uri === 'string') {
    if (uri.startsWith('data:image/png')) {
      extension = 'png';
      contentType = 'image/png';
    } else if (uri.startsWith('data:image/webp')) {
      extension = 'webp';
      contentType = 'image/webp';
    } else if (uri.startsWith('data:image/gif')) {
      extension = 'gif';
      contentType = 'image/gif';
    } else if (uri.startsWith('data:video/mp4')) {
      extension = 'mp4';
      contentType = 'video/mp4';
    } else {
      const cleanPath = uri.split('?')[0].split('#')[0];
      const match = cleanPath.match(/\.([a-zA-Z0-9]{2,5})$/);
      if (match && match[1]) {
        const ext = match[1].toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm'].includes(ext)) {
          extension = ext === 'jpeg' ? 'jpg' : ext;
          if (extension === 'png') contentType = 'image/png';
          else if (extension === 'webp') contentType = 'image/webp';
          else if (extension === 'gif') contentType = 'image/gif';
          else if (extension === 'mp4') contentType = 'video/mp4';
          else if (extension === 'mov' || extension === 'webm') contentType = `video/${extension}`;
          else contentType = 'image/jpeg';
        }
      }
    }
  }

  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${extension}`;
  return { extension, contentType, fileName };
}

export async function saveProductMedia(productId, mediaData, mediaType, userId, accessToken) {
  const normalizedMediaType = mediaType === 'video' ? 'video' : 'image';
  
  if (mediaType === 'url' || (typeof mediaData === 'string' && (mediaData.startsWith('http://') || mediaData.startsWith('https://')))) {
    const { error: insertError } = await supabase
      .from('product_media')
      .insert([
        {
          product_id: productId,
          media_url: mediaData,
          media_type: normalizedMediaType,
        },
      ]);

    if (insertError) {
      console.error('Error inserting media URL into database:', insertError.message);
      return null;
    }
    return mediaData;
  } else {
    try {
      const { extension, contentType, fileName } = extractFileDetails(mediaData, normalizedMediaType);
      const filePath = `product_media/${productId}/${fileName}`;
      const finalEdgePath = userId ? `${userId}/${filePath}` : filePath;

      let publicUrl = null;
      let fileData = null;

      // Safe binary data conversion for Web, iOS, and Android
      if (Platform.OS === 'web' || (typeof window !== 'undefined' && typeof fetch === 'function')) {
        try {
          const fileResponse = await fetch(mediaData);
          fileData = await fileResponse.blob();
        } catch (webBlobErr) {
          console.warn('Web blob fetch failed:', webBlobErr.message);
        }
      }
      
      if (!fileData) {
        try {
          const fileResponse = await fetch(mediaData);
          fileData = await fileResponse.blob();
        } catch (fetchBlobErr) {
          try {
            const base64 = await FileSystem.readAsStringAsync(mediaData, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (typeof Buffer !== 'undefined') {
              const buf = Buffer.from(base64, 'base64');
              fileData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            } else {
              fileData = new Uint8Array(
                atob(base64).split('').map((c) => c.charCodeAt(0))
              ).buffer;
            }
          } catch (fsErr) {
            console.error('FileSystem read error:', fsErr.message);
          }
        }
      }

      if (!fileData) {
        console.error('saveProductMedia: Unable to obtain file binary data.');
        return null;
      }

      // Primary Attempt: Try storage buckets
      const bucketsToTry = ['productsmedia', 'locationtracker', 'chat_media', 'damage_photos', 'qr_codes'];
      for (const bucketName of bucketsToTry) {
        if (!fileData) break;
        try {
          console.log(`Attempting upload to Supabase storage bucket '${bucketName}'...`);
          const { data: storageUploadData, error: storageUploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, fileData, {
              contentType: contentType,
              upsert: true,
            });

          if (!storageUploadError) {
            const { data: publicUrlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(filePath);
            if (publicUrlData?.publicUrl) {
              publicUrl = publicUrlData.publicUrl;
              console.log(`Direct storage upload successful to '${bucketName}'. Public URL:`, publicUrl);
              break;
            }
          } else {
            console.warn(`Storage upload to '${bucketName}' failed:`, storageUploadError.message);
          }
        } catch (bucketErr) {
          console.warn(`Error trying storage bucket '${bucketName}':`, bucketErr.message);
        }
      }

      // Fallback Attempt: Signed URL workflow via Edge Function if storage direct failed
      if (!publicUrl) {
        try {
          let token = accessToken;
          if (!token) {
            const { data: { session } } = await supabase.auth.getSession();
            token = session?.access_token || supabaseAnonKey;
          }

          const { data: functionData, error: funcError } = await supabase.functions.invoke('upload-image', {
            body: {
              action: 'generateSignedUrl',
              file_name: fileName,
              file_path: filePath,
              content_type: contentType,
              user_id: userId,
            },
          });

          let signedUrl = functionData?.signedUrl;

          if (funcError || !signedUrl) {
            const edgeFunctionUrl = `${supabaseUrl}/functions/v1/upload-image`;
            const signedUrlResponse = await fetch(edgeFunctionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                action: 'generateSignedUrl',
                file_name: fileName,
                file_path: filePath,
                content_type: contentType,
                user_id: userId,
              }),
            });

            if (signedUrlResponse.ok) {
              const resJson = await signedUrlResponse.json();
              signedUrl = resJson.signedUrl;
            }
          }

          if (signedUrl) {
            const fileResponse = await fetch(mediaData);
            const blob = await fileResponse.blob();

            const uploadDirectResponse = await fetch(signedUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': contentType,
                'x-upsert': 'true',
              },
              body: blob,
            });

            if (uploadDirectResponse.ok) {
              const { data: pubData } = supabase.storage
                .from('productsmedia')
                .getPublicUrl(finalEdgePath);
              publicUrl = pubData.publicUrl;
            }
          }
        } catch (edgeErr) {
          console.warn('Edge function fallback error:', edgeErr.message);
        }
      }

      if (!publicUrl) {
        console.error('Failed to obtain public URL for uploaded media.');
        return null;
      }

      // Save Public URL to Database
      const { error: insertError } = await supabase
        .from('product_media')
        .insert([
          {
            product_id: productId,
            media_url: publicUrl,
            media_type: normalizedMediaType,
          },
        ]);

      if (insertError) {
        console.error('Error inserting media URL into database:', insertError.message);
        return null;
      }

      return publicUrl;
    } catch (error) {
      console.error('Error in saveProductMedia:', error.message);
      return null;
    }
  }
}


export async function getAllProducts() {
  const { data, error } = await supabase.from('products').select('*');
  if (error) {
    console.error('Error fetching all products:', error.message);
    return null;
  }
  return data;
}

export async function getProductsWithDetails(userId) {
  console.log('getProductsWithDetails: Received userId:', userId);
  const { data: { user } } = await supabase.auth.getUser();
  console.log('getProductsWithDetails: Authenticated user UID:', user?.id);

  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      product_media (id, media_url, media_type),
      product_variants (
        id,
        name,
        variant_options (id, value)
      ),
      product_variant_combinations (id, combination_string, price, quantity, sku)
    `)
    .eq('user_id', userId)
    .order('display_order');

  if (error) {
    console.error('Error fetching products with details:', error.message);
    return null;
  }
  console.log('getProductsWithDetails: Fetched products data:', data);
  return data;
}

export async function getActiveProductsWithDetails(userId) {
  // Primary: Direct query on products table with relations (guarantees category_id, subcategory_id, subcategory columns)
  try {
    let query = supabase
      .from('products')
      .select(`
        *,
        product_media (id, media_url, media_type),
        product_variants (
          id,
          name,
          variant_options (id, value)
        ),
        product_variant_combinations (id, combination_string, price, quantity, sku)
      `)
      .eq('is_active', true);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.order('display_order', { ascending: true });
    if (!error && data) {
      console.log('Fetched active products via direct query:', data.length);
      return data;
    }
    if (error) {
      console.warn('getActiveProductsWithDetails direct query returned error, trying RPC fallback:', error.message);
    }
  } catch (err) {
    console.warn('getActiveProductsWithDetails direct query exception, trying RPC fallback:', err);
  }

  // Fallback: RPC get_active_products_with_details
  try {
    if (userId) {
      const { data, error } = await supabase.rpc('get_active_products_with_details', {
        p_user_id: userId,
      });

      if (!error && data && data.length > 0) {
        console.log('Fetched active products via RPC fallback:', data);
        return data;
      }
    }
  } catch (rpcErr) {
    console.warn('RPC get_active_products_with_details failed:', rpcErr);
  }

  return [];
}

export async function getTopProductsWithDetails() {
  const now = new Date();
  const currentTime = new Date().toTimeString().split(' ')[0];

  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      product_media (id, media_url, media_type),
      product_variants (
        id,
        name,
        variant_options (id, value)
      ),
      product_variant_combinations (id, combination_string, price, quantity, sku)
    `)
    .eq('is_active', true)
    .or(`visible_from.is.null,visible_from.lte.${currentTime}`)
    .or(`visible_to.is.null,visible_to.gte.${currentTime}`)
    .order('display_order', { ascending: true })
    .limit(10);

  if (error) {
    console.error('Error fetching top products with details:', error.message);
    return null;
  }
  return data;
}





export async function createProductVariant(variantData) {
  const { data, error } = await supabase
    .from('product_variants')
    .insert(variantData)
    .select();

  if (error) {
    console.error('Error creating product variant:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function createVariantOption(optionData) {
  const { data, error } = await supabase
    .from('variant_options')
    .insert(optionData)
    .select();

  if (error) {
    console.error('Error creating variant option:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function createProductVariantCombination(combinationData) {
  const { data, error } = await supabase
    .from('product_variant_combinations')
    .insert(combinationData)
    .select();

  if (error) {
    console.error('Error creating product variant combination:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function deleteProductVariants(productId) {
  try {
    // Delete product_variant_combinations first
    const { error: combinationsError } = await supabase
      .from('product_variant_combinations')
      .delete()
      .eq('product_id', productId);

    if (combinationsError) {
      console.error('Error deleting product variant combinations:', combinationsError.message);
      throw combinationsError;
    }

    // Then delete product_variants (variant_options will cascade due to schema)
    const { error: variantsError } = await supabase
      .from('product_variants')
      .delete()
      .eq('product_id', productId);

    if (variantsError) {
      console.error('Error deleting product variants:', variantsError.message);
      throw variantsError;
    }
    console.log(`Successfully deleted variants and combinations for product ${productId}`);
  } catch (error) {
    console.error('Failed to delete product variants and combinations:', error.message);
    throw error; // Re-throw to be caught by the calling function
  }
}

export async function getCart(userId) {
  const { data, error } = await supabase
    .from('carts')
    .select(`
      id,
      cart_items (
        id,
        quantity,
        product_variant_combinations (
          id,
          combination_string,
          price,
          products (
            id,
            product_name,
            customer_id,
            user_id,
            product_media (media_url, media_type)
          )
        )
      )
    `)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching cart:', error.message);
    return null;
  }
  return data;
}

export async function addToCart(userId, productVariantCombinationId, quantity = 1) {
  try {
    if (!userId) {
      console.error('addToCart: userId is required');
      return null;
    }

    // 1. Get or create cart for user
    let { data: cart, error: cartError } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (cartError) {
      console.error('Error fetching cart in addToCart:', cartError.message);
    }

    if (!cart) {
      const { data: newCart, error: newCartError } = await supabase
        .from('carts')
        .insert({ user_id: userId })
        .select('id')
        .single();

      if (newCartError) {
        console.error('Error creating cart:', newCartError.message);
        return null;
      }
      cart = newCart;
    }

    // 2. Resolve valid product_variant_combination_id
    let validCombinationId = productVariantCombinationId;

    // Check if ID exists in product_variant_combinations
    const { data: existingPvc } = await supabase
      .from('product_variant_combinations')
      .select('id, product_id, price')
      .eq('id', productVariantCombinationId)
      .maybeSingle();

    if (existingPvc) {
      validCombinationId = existingPvc.id;
    } else {
      // productVariantCombinationId might be a product_id
      // Check if a combination exists for this product_id
      const { data: comboForProduct } = await supabase
        .from('product_variant_combinations')
        .select('id, product_id, price')
        .eq('product_id', productVariantCombinationId)
        .limit(1)
        .maybeSingle();

      if (comboForProduct) {
        validCombinationId = comboForProduct.id;
      } else {
        // Find product to create default combination so foreign key is valid
        const { data: prod } = await supabase
          .from('products')
          .select('id, amount, product_name')
          .eq('id', productVariantCombinationId)
          .maybeSingle();

        if (prod) {
          const { data: createdCombo, error: createComboError } = await supabase
            .from('product_variant_combinations')
            .insert({
              product_id: prod.id,
              combination_string: 'Default',
              price: prod.amount || 0,
              quantity: 100,
              sku: '',
            })
            .select('id')
            .single();

          if (createdCombo) {
            validCombinationId = createdCombo.id;
          } else {
            console.error('Failed to create default combination:', createComboError?.message);
          }
        }
      }
    }

    if (!validCombinationId) {
      console.error('addToCart: Unable to resolve valid combination ID for:', productVariantCombinationId);
      return null;
    }

    // 3. Check if cart item already exists
    const { data: existingItem } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('cart_id', cart.id)
      .eq('product_variant_combination_id', validCombinationId)
      .maybeSingle();

    if (existingItem) {
      const { data, error } = await supabase
        .from('cart_items')
        .update({ quantity: existingItem.quantity + quantity })
        .eq('id', existingItem.id)
        .select();

      if (error) {
        console.error('Error updating existing cart item:', error.message);
        return null;
      }
      return data ? data[0] : null;
    }

    // 4. Insert new cart item
    const { data, error } = await supabase
      .from('cart_items')
      .insert({
        cart_id: cart.id,
        product_variant_combination_id: validCombinationId,
        quantity: quantity,
      })
      .select();

    if (error) {
      console.error('Error adding to cart:', error.message);
      return null;
    }
    return data ? data[0] : null;
  } catch (err) {
    console.error('Unexpected error in addToCart:', err);
    return null;
  }
}

export async function updateCartItem(cartItemId, quantity) {
  const { data, error } = await supabase
    .from('cart_items')
    .update({ quantity: quantity })
    .eq('id', cartItemId)
    .select();

  if (error) {
    console.error('Error updating cart item:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function removeCartItem(cartItemId) {
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', cartItemId);

  if (error) {
    console.error('Error removing cart item:', error.message);
  }
}




export async function getAreas() {
  const { data, error } = await supabase
    .from('area_master')
    .select(`
      *,
      group_areas(
        groups(name)
      )
    `);

  if (error) {
    console.error('Error fetching areas:', error.message);
    return null;
  }
  console.log("Supabase getAreas raw data:", data); // Log raw data
  return data;
}

export async function deleteProductMedia(mediaId, mediaUrl) {
  try {
    // 1. Delete from Supabase Storage
    const bucketName = 'productsmedia';
    // Extract the file path from the full URL
    // Example URL: https://<project_ref>.supabase.co/storage/v1/object/public/productsmedia/product_media/123/image.jpeg
    const pathSegments = mediaUrl.split('/');
    const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');

    const { error: storageError } = await supabase.storage
      .from(bucketName)
      .remove([filePathInBucket]);

    if (storageError) {
      console.error('Error deleting media from storage:', storageError.message);
      throw storageError; // Propagate error to prevent DB deletion if storage fails
    }
    console.log('Media deleted from storage successfully:', filePathInBucket);

    // 2. Delete from product_media table in database
    const { error: dbError } = await supabase
      .from('product_media')
      .delete()
      .eq('id', mediaId);

    if (dbError) {
      console.error('Error deleting media from database:', dbError.message);
      throw dbError;
    }
    console.log('Media deleted from database successfully:', mediaId);

    return true; // Indicate success
  } catch (error) {
    console.error('Failed to delete product media:', error.message);
    return false; // Indicate failure
  }
}

export async function deleteProduct(productId) {
  try {
    // 1. Fetch all media associated with the product
    const { data: mediaData, error: fetchMediaError } = await supabase
      .from('product_media')
      .select('id, media_url')
      .eq('product_id', productId);

    if (fetchMediaError) {
      console.error('Error fetching product media for deletion:', fetchMediaError.message);
      throw fetchMediaError;
    }

    // 2. Delete each media file from Supabase storage
    const bucketName = 'productsmedia';
    for (const media of mediaData) {
      const pathSegments = media.media_url.split('/');
      const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
      const { error: storageError } = await supabase.storage
        .from(bucketName)
        .remove([filePathInBucket]);

      if (storageError) {
        console.warn(`Warning: Could not delete media file ${filePathInBucket} from storage:`, storageError.message);
        // Do not throw, try to continue with other deletions
      }
    }

    // 3. Delete all product_media records from the database for that product
    const { error: deleteMediaDbError } = await supabase
      .from('product_media')
      .delete()
      .eq('product_id', productId);

    if (deleteMediaDbError) {
      console.error('Error deleting product media records from database:', deleteMediaDbError.message);
      throw deleteMediaDbError;
    }

    // 4. Delete the product record itself from the products table
    const { error: deleteProductError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (deleteProductError) {
      console.error('Error deleting product from database:', deleteProductError.message);
      throw deleteProductError;
    }

    console.log(`Product ${productId} and its media deleted successfully.`);
    return true; // Indicate success
  } catch (error) {
    console.error('Failed to delete product:', error.message);
    return false; // Indicate failure
  }
} 

export async function deleteOrder(orderId) {
  try {
    // Check user role before allowing deletion: buyers are not permitted to delete orders
    const { data: { user } = {} } = await supabase.auth.getUser();
    if (!user) {
      console.warn('deleteOrder: User not authenticated');
      return false;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role === 'buyer') {
      console.warn('deleteOrder: Buyers are not authorized to delete orders.');
      return false;
    }

    // Delete associated order items first
    const { error: deleteItemsError } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId);

    if (deleteItemsError) {
      console.error('Error deleting order items:', deleteItemsError.message);
      throw deleteItemsError;
    }

    // Then delete the order itself
    const { error: deleteOrderError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteOrderError) {
      console.error('Error deleting order:', deleteOrderError.message);
      throw deleteOrderError;
    }

    console.log(`Order ${orderId} and its items deleted successfully.`);
    return true;
  } catch (error) {
    console.error('Failed to delete order:', error.message);
    return false;
  }
} 

export async function uploadQrImage(userId, imageUri) {
  try {
    const { extension, contentType, fileName } = extractFileDetails(imageUri, 'image');
    const qrFileName = `${Date.now()}-${userId}.${extension}`;
    const filePath = `qr_codes/${userId}/${qrFileName}`;

    let fileData = null;
    if (Platform.OS === 'web' || (typeof window !== 'undefined' && typeof fetch === 'function')) {
      try {
        const fileResponse = await fetch(imageUri);
        fileData = await fileResponse.blob();
      } catch (webBlobErr) {
        console.warn('Web blob fetch failed in uploadQrImage:', webBlobErr.message);
      }
    }
    
    if (!fileData) {
      try {
        const base64 = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        fileData = new Uint8Array(
          atob(base64).split("").map((c) => c.charCodeAt(0))
        );
      } catch (fsErr) {
        console.error('FileSystem read error in uploadQrImage:', fsErr.message);
      }
    }

    if (!fileData) {
      console.error('uploadQrImage: Unable to obtain QR image binary data.');
      return null;
    }

    let publicUrl = null;

    // Try storage buckets: qr_codes, productsmedia, locationtracker
    const bucketsToTry = ['qr_codes', 'productsmedia', 'locationtracker'];
    for (const bucketName of bucketsToTry) {
      try {
        const { error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, fileData, {
            contentType: contentType,
            upsert: true,
          });

        if (!error) {
          const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);
          publicUrl = publicUrlData?.publicUrl;
          if (publicUrl) {
            console.log(`QR image uploaded successfully to bucket "${bucketName}":`, publicUrl);
            break;
          }
        } else {
          console.warn(`Storage upload to "${bucketName}" failed:`, error.message);
        }
      } catch (bucketErr) {
        console.warn(`Error trying storage bucket "${bucketName}":`, bucketErr.message);
      }
    }

    // Fallback: Edge function signed upload if needed
    if (!publicUrl) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || supabaseAnonKey;
        const { data: functionData, error: funcError } = await supabase.functions.invoke('upload-image', {
          body: {
            action: 'generateSignedUrl',
            file_name: fileName,
            file_path: filePath,
            content_type: contentType,
            user_id: userId,
          },
        });

        if (!funcError && functionData?.signedUrl) {
          const fileResponse = await fetch(imageUri);
          const blob = await fileResponse.blob();
          const uploadDirectResponse = await fetch(functionData.signedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': contentType,
              'x-upsert': 'true',
            },
            body: blob,
          });

          if (uploadDirectResponse.ok) {
            const { data: pubData } = supabase.storage
              .from('productsmedia')
              .getPublicUrl(filePath);
            publicUrl = pubData.publicUrl;
          }
        }
      } catch (edgeErr) {
        console.warn('Edge function fallback error:', edgeErr.message);
      }
    }

    return publicUrl;
  } catch (error) {
    console.error('Error in uploadQrImage:', error.message);
    return null;
  }
}

/**
 * Upload profile media (image or video) to Supabase Storage
 */
export async function uploadProfileMedia(userId, mediaUri, mediaType = 'image') {
  try {
    const isVideo = mediaType === 'video';
    const { extension, contentType, fileName } = extractFileDetails(mediaUri, isVideo ? 'video' : 'image');
    const profileFileName = `${Date.now()}-${userId}-${fileName}`;
    const filePath = `profile_media/${userId}/${profileFileName}`;

    let fileData = null;
    if (Platform.OS === 'web' || (typeof window !== 'undefined' && typeof fetch === 'function')) {
      try {
        const fileResponse = await fetch(mediaUri);
        fileData = await fileResponse.blob();
      } catch (webBlobErr) {
        console.warn('Web blob fetch failed in uploadProfileMedia:', webBlobErr.message);
      }
    }

    if (!fileData) {
      try {
        const base64 = await FileSystem.readAsStringAsync(mediaUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (typeof Buffer !== 'undefined') {
          const buf = Buffer.from(base64, 'base64');
          fileData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } else {
          fileData = new Uint8Array(
            atob(base64).split('').map((c) => c.charCodeAt(0))
          );
        }
      } catch (fsErr) {
        console.error('FileSystem read error in uploadProfileMedia:', fsErr.message);
      }
    }

    if (!fileData) {
      console.error('uploadProfileMedia: Unable to obtain media binary data.');
      return null;
    }

    let publicUrl = null;
    const bucketsToTry = ['productsmedia', 'locationtracker', 'chat_media', 'qr_codes', 'damage_photos'];
    for (const bucketName of bucketsToTry) {
      try {
        const { error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, fileData, {
            contentType: contentType,
            upsert: true,
          });

        if (!error) {
          const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);
          publicUrl = publicUrlData?.publicUrl;
          if (publicUrl) {
            console.log(`Profile media uploaded successfully to bucket "${bucketName}":`, publicUrl);
            break;
          }
        } else {
          console.warn(`Storage upload to "${bucketName}" failed:`, error.message);
        }
      } catch (bucketErr) {
        console.warn(`Error trying storage bucket "${bucketName}":`, bucketErr.message);
      }
    }

    return publicUrl;
  } catch (error) {
    console.error('Error in uploadProfileMedia:', error.message);
    return null;
  }
}

export async function addQrCode(userId, qrImageUrl, name = 'My UPI QR', isActive = true) {
  try {
    if (isActive) {
      // Deactivate previous active QR codes for this user
      await supabase
        .from('user_qr_codes')
        .update({ is_active: false })
        .eq('user_id', userId);
    }

    const { data, error } = await supabase
      .from('user_qr_codes')
      .insert([{ user_id: userId, qr_image_url: qrImageUrl, name: name, is_active: isActive }])
      .select();

    if (error) {
      console.error('Error adding QR code:', error.message);
      return null;
    }
    return data ? data[0] : null;
  } catch (err) {
    console.error('Exception in addQrCode:', err);
    return null;
  }
}

export async function updateQrCode(qrCodeId, name, isActive) {
  const { data, error } = await supabase
    .from('user_qr_codes')
    .update({ name: name, is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', qrCodeId)
    .select();

  if (error) {
    console.error('Error updating QR code:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function deleteQrCode(qrCodeId, imageUrl) {
  try {
    const bucketsToTry = ['qr_codes', 'productsmedia', 'locationtracker'];
    if (imageUrl) {
      for (const bucketName of bucketsToTry) {
        if (imageUrl.includes(bucketName)) {
          const pathSegments = imageUrl.split('/');
          const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
          await supabase.storage.from(bucketName).remove([filePathInBucket]);
          break;
        }
      }
    }

    const { error: dbError } = await supabase
      .from('user_qr_codes')
      .delete()
      .eq('id', qrCodeId);

    if (dbError) {
      console.error('Error deleting QR code from database:', dbError.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to delete QR code:', error.message);
    return false;
  }
}

export async function getActiveQrCode(userId) {
  try {
    const { data, error } = await supabase
      .from('user_qr_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching active QR code:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Exception in getActiveQrCode:', err);
    return null;
  }
}

export async function getAllQrCodes(userId) {
  const { data, error } = await supabase
    .from('user_qr_codes')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching all QR codes:', error.message);
    return null;
  }
  return data;
}

export async function getCustomerDocuments(customerId) {
  const { data, error } = await supabase
    .from('customer_documents')
    .select('file_data, file_type')
    .eq('customer_id', customerId);

  if (error) {
    console.error('Error fetching customer documents:', error.message);
    return null;
  }
  return data;
}

// Order Management Functions
export async function getOrders(userId, options = {}) {
  console.log('getOrders: userId', userId, 'options', options);
  if (!userId) return [];

  const isSeller = options.role === 'seller' || options.isSeller;
  const isAdmin = options.role === 'admin' || options.role === 'superadmin';

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

  let orders = [];

  if (isSeller) {
    // 1. Try querying orders where seller_id = userId OR user_id = userId (for shop orders created by seller)
    try {
      const { data: sellerData, error: sellerErr } = await supabase
        .from('orders')
        .select(selectQuery)
        .or(`seller_id.eq.${userId},user_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (!sellerErr && Array.isArray(sellerData)) {
        orders = sellerData;
      } else if (sellerErr) {
        console.warn('getOrders: seller_id query notice:', sellerErr.message);
      }
    } catch (err) {
      console.warn('getOrders: seller_id query exception:', err);
    }

    // 2. Product-linked fallback for older legacy orders created prior to seller_id column
    // Only query if direct seller_id match found nothing, ensuring instantaneous load times
    if (orders.length === 0) {
      try {
        const { data: myProducts } = await supabase
          .from('products')
          .select('id')
          .or(`user_id.eq.${userId},customer_id.eq.${userId}`);

        if (myProducts && myProducts.length > 0) {
          const prodIds = myProducts.map((p) => p.id);
          const { data: combinations } = await supabase
            .from('product_variant_combinations')
            .select('id')
            .in('product_id', prodIds);

          if (combinations && combinations.length > 0) {
            const combiIds = combinations.map((c) => c.id);
            const { data: items } = await supabase
              .from('order_items')
              .select('order_id')
              .in('product_variant_combination_id', combiIds);

            if (items && items.length > 0) {
              const linkedOrderIds = Array.from(new Set(items.map((it) => it.order_id).filter(Boolean)));
              if (linkedOrderIds.length > 0) {
                const existingIds = new Set(orders.map((o) => o.id));
                const missingIds = linkedOrderIds.filter((id) => !existingIds.has(id));

                if (missingIds.length > 0) {
                  const { data: extraOrders } = await supabase
                    .from('orders')
                    .select(selectQuery)
                    .in('id', missingIds)
                    .order('created_at', { ascending: false });

                  if (extraOrders && extraOrders.length > 0) {
                    orders = [...orders, ...extraOrders].sort(
                      (a, b) => new Date(b.created_at) - new Date(a.created_at)
                    );
                  }
                }
              }
            }
          }
        }
      } catch (fallbackErr) {
        console.warn('getOrders fallback product search notice:', fallbackErr);
      }
    }
  } else if (isAdmin && !options.buyerOnly) {
    const { data: adminData, error: adminErr } = await supabase
      .from('orders')
      .select(selectQuery)
      .order('created_at', { ascending: false });

    if (!adminErr && adminData) {
      orders = adminData;
    }
  } else {
    // Buyer query: strictly orders placed by this buyer
    const { data: buyerData, error: buyerErr } = await supabase
      .from('orders')
      .select(selectQuery)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (buyerErr) {
      console.error('getOrders: Error fetching buyer orders:', buyerErr.message);
      return null;
    }
    orders = buyerData || [];
  }

  // Enrich orders with buyer profiles if missing customer names
  try {
    const missingProfileUserIds = Array.from(
      new Set(
        orders
          .filter((o) => o.user_id && !o.customer_name)
          .map((o) => o.user_id)
      )
    );

    if (missingProfileUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, mobile')
        .in('id', missingProfileUserIds);

      if (profiles && profiles.length > 0) {
        const profMap = new Map(profiles.map((p) => [p.id, p]));
        orders.forEach((ord) => {
          if (ord.user_id && profMap.has(ord.user_id)) {
            const p = profMap.get(ord.user_id);
            if (!ord.customer_name && p.full_name) ord.customer_name = p.full_name;
            if (!ord.customer_mobile && p.mobile) ord.customer_mobile = p.mobile;
          }
        });
      }
    }
  } catch (profErr) {
    console.warn('getOrders profile enrichment notice:', profErr);
  }

  return orders;
}

export async function getOrderById(orderId) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
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
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching order by ID:', error.message);
      return null;
    }

    if (!data) return null;

    // Fetch buyer profile if user_id is set
    if (data.user_id) {
      try {
        const { data: userProf } = await supabase
          .from('profiles')
          .select('id, full_name, mobile, email')
          .eq('id', data.user_id)
          .maybeSingle();
        if (userProf) {
          data.customer_profile = userProf;
          if (!data.customer_name && userProf.full_name) data.customer_name = userProf.full_name;
          if (!data.customer_mobile && userProf.mobile) data.customer_mobile = userProf.mobile;
        }
      } catch (_) {}
    }

    // Fetch delivery manager profile if assigned
    if (data.delivery_manager_id) {
      try {
        const { data: dmProf } = await supabase
          .from('profiles')
          .select('id, full_name, mobile')
          .eq('id', data.delivery_manager_id)
          .maybeSingle();
        if (dmProf) {
          data.delivery_manager_profile = dmProf;
        }
      } catch (_) {}
    }

    return data;
  } catch (err) {
    console.error('getOrderById exception:', err);
    return null;
  }
}

export async function updateOrderStatus(orderId, newStatus) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .eq('id', orderId)
    .select();

  if (error) {
    console.error('Error updating order status:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function updateOrderPaymentStatus(orderId, paymentStatus) {
  try {
    let updatePayload = { payment_status: paymentStatus };

    // If payment is confirmed as paid, also transition pending_payment orders to processing
    if (paymentStatus === 'paid') {
      try {
        const { data: cur } = await supabase
          .from('orders')
          .select('status')
          .eq('id', orderId)
          .maybeSingle();
        if (cur?.status === 'pending_payment') {
          updatePayload.status = 'processing';
        }
      } catch (_) {}
    }

    let { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select();

    if (error && (error.code === 'PGRST204' || error.message?.includes('payment_status'))) {
      // payment_status column not yet in orders table, fallback to shipping_address JSON
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('shipping_address, status')
        .eq('id', orderId)
        .single();
      const currentShipping = typeof currentOrder?.shipping_address === 'object' && currentOrder?.shipping_address !== null
        ? currentOrder.shipping_address
        : { address: currentOrder?.shipping_address };
      const updatedShipping = { ...currentShipping, payment_status: paymentStatus };
      const fallbackPayload = { shipping_address: updatedShipping };
      if (paymentStatus === 'paid' && currentOrder?.status === 'pending_payment') {
        fallbackPayload.status = 'processing';
      }
      const res = await supabase
        .from('orders')
        .update(fallbackPayload)
        .eq('id', orderId)
        .select();
      return res.data ? res.data[0] : null;
    }

    if (error) {
      console.error('Error updating order payment status:', error.message);
      return null;
    }
    return data ? data[0] : null;
  } catch (err) {
    console.error('updateOrderPaymentStatus exception:', err);
    return null;
  }
}

export async function getPendingOrdersCount(userId, options = {}) {
  const isSeller = options.role === 'seller' || options.isSeller;
  let query = supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'processing', 'pending_payment']);

  if (isSeller) {
    query = query.or(`seller_id.eq.${userId},user_id.eq.${userId}`);
  } else {
    query = query.eq('user_id', userId);
  }

  const { count, error } = await query;

  if (error) {
    console.error('Error fetching pending orders count:', error.message);
    return 0;
  }
  return count || 0;
}

export async function getAssignedOrders(deliveryManagerId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        id,
        quantity,
        price,
        product_variant_combinations (
          id,
          combination_string,
          products (
            id,
            product_name,
            customer_id,
            product_media (media_url, media_type)
          )
        )
      )
    `)
    .eq('delivery_manager_id', deliveryManagerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching assigned orders:', error.message);
    return [];
  }
  return data || [];
}

export async function getAvailableDeliveryOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        id,
        quantity,
        price,
        product_variant_combinations (
          id,
          combination_string,
          products (
            id,
            product_name,
            customer_id,
            product_media (media_url, media_type)
          )
        )
      )
    `)
    .is('delivery_manager_id', null)
    .or('order_type.is.null,order_type.neq.shop-order')
    .neq('status', 'completed')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching available delivery orders:', error.message);
    return [];
  }
  return data || [];
}

export async function acceptDeliveryOrder(orderId, deliveryManagerId) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      delivery_manager_id: deliveryManagerId,
      status: 'Processing',
    })
    .eq('id', orderId)
    .select();

  if (error) {
    console.error('Error accepting delivery order:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

export async function updateDeliveryManagerLocation(managerId, location) {
  const { data, error } = await supabase
    .from('delivery_manager_locations')
    .insert({
      manager_id: managerId,
      location: `POINT(${location.coords.longitude} ${location.coords.latitude})`,
    });

  return data;
}

export async function getDeliveryManagerLocations() {
  const { data, error } = await supabase
    .from('latest_delivery_manager_locations')
    .select(`
      manager_id,
      location,
      profiles (
        full_name,
        mobile
      )
    `);

  if (error) {
    console.error('Error fetching delivery manager locations:', error.message);
    return null;
  }
  return data;
}

export async function getSellersInRange(latitude, longitude, radius) {
  const { data, error } = await supabase.rpc('get_sellers_in_range', {
    user_lat: latitude,
    user_lon: longitude,
    radius_meters: radius,
  });

  if (error) {
    console.error('Error fetching sellers in range:', error);
    return null;
  }
  return data;
}

export async function getProductsInRange(latitude, longitude, radius) {
  console.log('Calling get_products_in_range RPC with:', { user_lat: latitude, user_lon: longitude, radius_meters: radius });
  const { data, error } = await supabase.rpc('get_products_in_range', {
    user_lat: latitude,
    user_lon: longitude,
    radius_meters: radius,
  });

  if (error) {
    console.error('Error fetching products in range:', error);
    return null;
  }
  console.log('Products in range data:', data);
  return data;
}

/**
 * Calculate the exact callback URL for OAuth and Email Confirmation
 * Works on Web, GitHub Pages subpaths, and Native Mobile deep links.
 */
export function getAuthRedirectUrl() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      let pathname = window.location.pathname || '';
      // Remove specific file names like index.html if present
      if (pathname.endsWith('.html')) {
        pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
      }
      if (!pathname.endsWith('/')) {
        pathname = pathname + '/';
      }
      return `${origin}${pathname}`;
    }
    return 'https://narasimhareddyaiapp2-localwala.github.io/needsTracking/';
  }

  return AuthSession.makeRedirectUri({
    scheme: 'needstracking',
    path: 'auth/callback',
  });
}

/**
 * Ensures user profile exists in `profiles` table after OAuth or Email login with proper role
 */
export async function ensureUserProfile(user, defaultRole = null) {
  if (!user || !user.id) return null;
  try {
    // 1. Check for explicit or stored pending role (from SellerLogin / DeliveryLogin / BuyerLogin)
    let roleToAssign = defaultRole;
    if (!roleToAssign) {
      try {
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          roleToAssign = localStorage.getItem('pending_auth_role') || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pending_auth_role') : null);
        }
        if (!roleToAssign && Storage && typeof Storage.getItem === 'function') {
          roleToAssign = await Storage.getItem('pending_auth_role');
        }
      } catch (_) {}
    }

    // Clear pending role once read
    if (roleToAssign) {
      try {
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          localStorage.removeItem('pending_auth_role');
          if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('pending_auth_role');
        }
        if (Storage && typeof Storage.removeItem === 'function') {
          await Storage.removeItem('pending_auth_role');
        }
      } catch (_) {}
    }

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // If an explicit role was requested (e.g. 'seller' or 'delivery_manager')
    if (roleToAssign) {
      // Sync auth user metadata
      try {
        await supabase.auth.updateUser({
          data: { role: roleToAssign }
        });
      } catch (_) {}

      if (existingProfile) {
        // Upgrade / sync role if different and not admin / superadmin
        if (existingProfile.role !== roleToAssign && !isUserAdminOrSuperadmin(existingProfile, user)) {
          const { data: updatedProfile, error: updateErr } = await supabase
            .from('profiles')
            .update({
              role: roleToAssign,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id)
            .select()
            .maybeSingle();

          try {
            await supabase.from('users').upsert({
              id: user.id,
              email: user.email || existingProfile.email || '',
              name: updatedProfile?.full_name || existingProfile.full_name || user.email?.split('@')[0] || 'User',
              mobile: updatedProfile?.mobile || existingProfile.mobile || null,
              user_type: roleToAssign,
              updated_at: new Date().toISOString(),
            });
          } catch (_) {}

          if (!updateErr && updatedProfile) {
            console.log(`[ensureUserProfile] Upgraded user profile to role "${roleToAssign}":`, updatedProfile);
            return updatedProfile;
          }
        }

        try {
          await supabase.from('users').upsert({
            id: user.id,
            email: user.email || existingProfile.email || '',
            name: existingProfile.full_name || user.email?.split('@')[0] || 'User',
            mobile: existingProfile.mobile || null,
            user_type: existingProfile.role || roleToAssign,
            updated_at: new Date().toISOString(),
          });
        } catch (_) {}

        return existingProfile;
      }
    }

    if (existingProfile) {
      try {
        await supabase.from('users').upsert({
          id: user.id,
          email: user.email || existingProfile.email || '',
          name: existingProfile.full_name || user.email?.split('@')[0] || 'User',
          mobile: existingProfile.mobile || null,
          user_type: existingProfile.role || 'customer',
          updated_at: new Date().toISOString(),
        });
      } catch (_) {}
      return existingProfile;
    }

    // New profile creation
    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'User';
    const role = roleToAssign || user.user_metadata?.role || 'customer';

    const newProfile = {
      id: user.id,
      full_name: fullName,
      email: user.email || '',
      role: role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (user.user_metadata?.mobile) {
      newProfile.mobile = user.user_metadata.mobile;
    }

    const { data, error: insertErr } = await supabase
      .from('profiles')
      .upsert(newProfile)
      .select()
      .maybeSingle();

    if (insertErr) {
      console.warn('[ensureUserProfile] Upsert notice:', insertErr.message);
    }

    try {
      await supabase.from('users').upsert({
        id: user.id,
        email: user.email || '',
        name: fullName,
        mobile: user.user_metadata?.mobile || null,
        user_type: role,
        updated_at: new Date().toISOString(),
      });
    } catch (_) {}

    return data || newProfile;
  } catch (err) {
    console.error('[ensureUserProfile] Error:', err);
    return null;
  }
}

/**
 * Sign in / Sign up with Google OAuth via Supabase
 * @param {string} defaultRole - Role to assign if new profile ('seller' / 'delivery_manager' / 'customer')
 */
export async function signInWithGoogle(defaultRole = 'customer') {
  try {
    // Persist pending role so after OAuth redirect on web / app refocus, role is preserved
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem('pending_auth_role', defaultRole);
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('pending_auth_role', defaultRole);
      }
      if (Storage && typeof Storage.setItem === 'function') {
        await Storage.setItem('pending_auth_role', defaultRole);
      }
    } catch (storeErr) {
      console.warn('[Google Auth] Could not store pending_auth_role:', storeErr);
    }

    const redirectUrl = getAuthRedirectUrl();
    console.log('[Google Auth] Using redirect URL:', redirectUrl, 'for intended role:', defaultRole);

    if (Platform.OS === 'web') {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (error) throw error;
      return { success: true };
    }

    // Native Mobile (Expo Go / Standalone / Dev Build)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) throw error;

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
    console.log('[Google Auth] Browser result:', res);

    if (res.type === 'success' && res.url) {
      let accessToken = null;
      let refreshToken = null;

      if (res.url.includes('#')) {
        const hashParams = new URLSearchParams(res.url.split('#')[1]);
        accessToken = hashParams.get('access_token');
        refreshToken = hashParams.get('refresh_token');
      }

      if (!accessToken && res.url.includes('?')) {
        const queryParams = new URLSearchParams(res.url.split('?')[1]);
        accessToken = queryParams.get('access_token');
        refreshToken = queryParams.get('refresh_token');
      }

      if (accessToken && refreshToken) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) throw sessionError;

        if (sessionData?.user) {
          const profile = await ensureUserProfile(sessionData.user, defaultRole);
          return { user: sessionData.user, session: sessionData.session, profile, success: true };
        }

        return { user: sessionData.user, session: sessionData.session, success: true };
      }
    }
    return { success: false, cancelled: true };
  } catch (error) {
    console.error('Google Sign-In Error:', error.message || error);
    return { success: false, error: error.message || 'Google sign-in failed' };
  }
}

/**
 * Update real-time GPS location of Delivery Partner
 */
export async function updateDeliveryPartnerLocation(partnerId, orderId, coords) {
  try {
    const { latitude, longitude, heading = 0, speed = 0 } = coords;

    // 1. Broadcast via Realtime channel (Instant sub-second delivery)
    if (orderId) {
      const broadcastChannel = supabase.channel(`order-tracking:${orderId}`);
      broadcastChannel.send({
        type: 'broadcast',
        event: 'partner_location',
        payload: {
          partnerId,
          orderId,
          latitude,
          longitude,
          heading,
          speed,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // 2. Persist in delivery_partner_locations
    await supabase.from('delivery_partner_locations').upsert({
      partner_id: partnerId,
      order_id: orderId || null,
      latitude,
      longitude,
      heading,
      speed,
      updated_at: new Date().toISOString(),
    });

    // 3. Keep legacy delivery_manager_locations compatible
    await supabase.from('delivery_manager_locations').insert({
      manager_id: partnerId,
      location: `POINT(${longitude} ${latitude})`,
    });

    return true;
  } catch (err) {
    console.error('Error updating live delivery location:', err);
    return false;
  }
}

/**
 * Subscribe to live tracking of a delivery partner for a given order
 */
export function subscribeToLiveDelivery(orderId, partnerId, onLocationUpdate) {
  const channel = supabase
    .channel(`order-tracking:${orderId}`)
    .on('broadcast', { event: 'partner_location' }, (payload) => {
      if (payload?.payload && onLocationUpdate) {
        onLocationUpdate(payload.payload);
      }
    })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'delivery_partner_locations',
        filter: partnerId ? `partner_id=eq.${partnerId}` : undefined,
      },
      (payload) => {
        if (payload?.new && onLocationUpdate) {
          onLocationUpdate(payload.new);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Set active status for all products of a given seller
 */
export async function setSellerProductsActiveStatus(userId, isActive) {
  try {
    if (!userId) return false;
    // 1. Try RPC
    try {
      const { data, error } = await supabase.rpc('admin_set_seller_products_active', {
        p_seller_id: userId,
        p_is_active: isActive === true,
      });
      if (!error) return true;
    } catch (_) {}

    // 2. Direct table update fallback
    const { error } = await supabase
      .from('products')
      .update({ is_active: isActive })
      .or(`user_id.eq.${userId},customer_id.eq.${userId}`);
    if (error) {
      console.warn('Error updating seller products active status:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Exception updating seller products active status:', e);
    return false;
  }
}

/**
 * Set active status for all products across the entire platform (AppAdmin)
 */
export async function setAllProductsActiveStatus(isActive) {
  try {
    // 1. Try RPC
    try {
      const { data, error } = await supabase.rpc('admin_global_toggle_products', {
        p_is_active: isActive === true,
      });
      if (!error) return true;
    } catch (_) {}

    // 2. Direct table update fallback
    const { error } = await supabase
      .from('products')
      .update({ is_active: isActive })
      .not('id', 'is', null);
    if (error) {
      console.warn('Error updating all products active status:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Exception updating all products active status:', e);
    return false;
  }
}

/**
 * Set store & map active status for a specific seller
 */
export async function setSellerStoreActiveStatus(sellerId, settings) {
  try {
    if (!sellerId) return false;
    const { is_store_active, is_map_active, is_product_active, existingMedia } = settings || {};

    // 1. Attempt via RPC
    try {
      const { data, error } = await supabase.rpc('admin_set_seller_store_settings', {
        p_seller_id: sellerId,
        p_store_active: is_store_active !== false,
        p_map_active: is_map_active !== false,
        p_product_active: is_product_active !== false,
      });
      if (!error) return true;
    } catch (_) {}

    // 2. Direct profiles table update fallback
    const updatedMedia = embedStoreSettings(existingMedia || [], {
      is_store_active: is_store_active !== false,
      is_map_active: is_map_active !== false,
      is_product_active: is_product_active !== false,
    });

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ media_urls: updatedMedia })
      .eq('id', sellerId);

    if (profileErr) {
      console.warn('Direct profile update notice:', profileErr.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception in setSellerStoreActiveStatus:', err);
    return false;
  }
}

/**
 * Global toggle for all stores and maps across the platform
 */
export async function setAllStoresActiveStatus(isActive, sellersList = []) {
  try {
    // 1. Try global RPC
    try {
      const { data, error } = await supabase.rpc('admin_global_toggle_stores', {
        p_is_active: isActive === true,
      });
      if (!error) return true;
    } catch (_) {}

    // 2. Fallback: Iterate and update each profile
    let listToUpdate = sellersList;
    if (!listToUpdate || listToUpdate.length === 0) {
      const { data: profs } = await supabase.from('profiles').select('id, media_urls');
      listToUpdate = profs || [];
    }

    for (const s of listToUpdate) {
      const updatedMedia = embedStoreSettings(s.media_urls || [], {
        is_store_active: isActive === true,
        is_map_active: isActive === true,
        is_product_active: s.is_product_active !== false,
      });
      await supabase
        .from('profiles')
        .update({ media_urls: updatedMedia })
        .eq('id', s.id);
    }
    return true;
  } catch (err) {
    console.error('Exception in setAllStoresActiveStatus:', err);
    return false;
  }
}

/**
 * Helper to check if a user or profile is Admin or Superadmin
 */
export function isUserAdminOrSuperadmin(profile, user) {
  const role = (
    profile?.role ||
    profile?.user_type ||
    user?.user_metadata?.role ||
    user?.user_metadata?.user_type ||
    ''
  ).toLowerCase().trim();
  return (
    role === 'admin' ||
    role === 'superadmin' ||
    role === 'appadmin' ||
    role === 'app_admin'
  );
}

/**
 * Helper to parse store settings from media_urls or object.
 * By default, if no store_settings object is stored yet, default to ACTIVE (true) so stores are visible.
 */
export function extractStoreSettings(mediaUrls) {
  let list = [];
  if (typeof mediaUrls === 'string') {
    try {
      list = JSON.parse(mediaUrls);
    } catch (_) {
      list = [];
    }
  } else if (Array.isArray(mediaUrls)) {
    list = mediaUrls;
  } else if (mediaUrls && typeof mediaUrls === 'object') {
    return {
      is_store_active: mediaUrls.is_store_active !== false && mediaUrls.store_active !== false,
      is_map_active: mediaUrls.is_map_active !== false && mediaUrls.map_active !== false,
      is_product_active: mediaUrls.is_product_active !== false && mediaUrls.product_active !== false,
    };
  }
  const settingsItem = (list || []).find((m) => m && m.type === 'store_settings');
  if (!settingsItem) {
    return {
      is_store_active: true,
      is_map_active: true,
      is_product_active: true,
    };
  }
  return {
    is_store_active: settingsItem.store_active !== false,
    is_map_active: settingsItem.map_active !== false,
    is_product_active: settingsItem.product_active !== false,
  };
}

/**
 * Helper to embed store settings into media_urls array without losing media photos/videos
 */
export function embedStoreSettings(existingMediaList, storeSettings) {
  let list = [];
  if (typeof existingMediaList === 'string') {
    try {
      list = JSON.parse(existingMediaList);
    } catch (_) {
      list = [];
    }
  } else if (Array.isArray(existingMediaList)) {
    list = existingMediaList;
  }
  const cleanMedia = (list || []).filter(
    (m) =>
      m &&
      m.type !== 'store_settings' &&
      (m.type === 'merchant_upi' || (m.uri && typeof m.uri === 'string' && m.uri.trim().length > 0))
  );
  cleanMedia.push({
    type: 'store_settings',
    store_active: storeSettings?.is_store_active !== false,
    map_active: storeSettings?.is_map_active !== false,
    product_active: storeSettings?.is_product_active !== false,
    updated_at: new Date().toISOString(),
  });
  return cleanMedia;
}

/**
 * Extracts merchant UPI ID saved in media_urls array (fallback for when upi_id column is not in profiles table)
 */
export function extractMerchantUpi(mediaUrls) {
  if (!mediaUrls) return '';
  let list = [];
  if (typeof mediaUrls === 'string') {
    try {
      list = JSON.parse(mediaUrls);
    } catch (_) {
      list = [];
    }
  } else if (Array.isArray(mediaUrls)) {
    list = mediaUrls;
  }
  const item = (list || []).find((m) => m && (m.type === 'merchant_upi' || m.type === 'upi_settings'));
  if (item && item.upi_id && typeof item.upi_id === 'string') {
    return item.upi_id.trim();
  }
  return '';
}

/**
 * Embeds merchant UPI ID into media_urls array without losing existing photos or store settings
 */
export function embedMerchantUpi(existingMediaList, upiId) {
  let list = [];
  if (typeof existingMediaList === 'string') {
    try {
      list = JSON.parse(existingMediaList);
    } catch (_) {
      list = [];
    }
  } else if (Array.isArray(existingMediaList)) {
    list = existingMediaList;
  }
  const cleanMedia = (list || []).filter(
    (m) => m && m.type !== 'merchant_upi' && m.type !== 'upi_settings'
  );
  if (upiId && typeof upiId === 'string' && upiId.trim().length > 0) {
    cleanMedia.push({
      type: 'merchant_upi',
      upi_id: upiId.trim(),
      updated_at: new Date().toISOString(),
    });
  }
  return cleanMedia;
}

/**
 * User Addresses Management (Multiple addresses with GPS coords)
 */
export async function getUserAddresses(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('user_addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('getUserAddresses notice:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('getUserAddresses error:', err);
    return [];
  }
}

export async function addUserAddress(userId, addressData) {
  if (!userId) throw new Error('User ID is required');
  const payload = {
    user_id: userId,
    tag: addressData.tag || 'Home',
    recipient_name: addressData.recipient_name || addressData.name || 'Recipient',
    mobile: addressData.mobile,
    address_line_1: addressData.address_line_1 || addressData.address,
    address_line_2: addressData.address_line_2 || '',
    city: addressData.city,
    state: addressData.state || '',
    zip_code: addressData.zip_code || addressData.postalCode || '',
    country: addressData.country || 'India',
    latitude: addressData.latitude != null ? Number(addressData.latitude) : null,
    longitude: addressData.longitude != null ? Number(addressData.longitude) : null,
    is_default: !!addressData.is_default,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('user_addresses')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteUserAddress(addressId) {
  if (!addressId) return false;
  const { error } = await supabase
    .from('user_addresses')
    .delete()
    .eq('id', addressId);

  if (error) throw error;
  return true;
}

// =========================================================================
// CATALOG & SUBCATALOG (CATEGORIES & SUBCATEGORIES) SERVICE LAYER
// =========================================================================

export const DEFAULT_MASTER_CATEGORIES = [
  { id: 'grocery', name: 'Grocery & Essentials', code: 'grocery', icon: 'shopping-basket', display_order: 1, is_active: true },
  { id: 'fruits_vegetables', name: 'Fruits & Vegetables', code: 'fruits_vegetables', icon: 'lemon-o', display_order: 2, is_active: true },
  { id: 'dairy_bakery', name: 'Dairy & Bakery', code: 'dairy_bakery', icon: 'birthday-cake', display_order: 3, is_active: true },
  { id: 'snacks_beverages', name: 'Snacks & Beverages', code: 'snacks_beverages', icon: 'coffee', display_order: 4, is_active: true },
  { id: 'clothing', name: 'Clothing & Fashion', code: 'clothing', icon: 'tag', display_order: 5, is_active: true },
  { id: 'electronics', name: 'Electronics & Gadgets', code: 'electronics', icon: 'laptop', display_order: 6, is_active: true },
  { id: 'beauty_personal_care', name: 'Beauty & Personal Care', code: 'beauty_personal_care', icon: 'heart', display_order: 7, is_active: true },
  { id: 'home_kitchen', name: 'Home & Kitchen', code: 'home_kitchen', icon: 'home', display_order: 8, is_active: true },
  { id: 'pharmacy', name: 'Pharmacy & Health', code: 'pharmacy', icon: 'medkit', display_order: 9, is_active: true },
  { id: 'other', name: 'Other / General', code: 'other', icon: 'cube', display_order: 10, is_active: true },
];

export const DEFAULT_MASTER_SUBCATEGORIES = {
  grocery: [
    { id: 'atta_flours', category_code: 'grocery', name: 'Atta, Flours & Grains', code: 'atta_flours', display_order: 1, is_active: true },
    { id: 'rice_products', category_code: 'grocery', name: 'Rice & Rice Products', code: 'rice_products', display_order: 2, is_active: true },
    { id: 'dals_pulses', category_code: 'grocery', name: 'Dals & Pulses', code: 'dals_pulses', display_order: 3, is_active: true },
    { id: 'oils_ghee', category_code: 'grocery', name: 'Edible Oils & Ghee', code: 'oils_ghee', display_order: 4, is_active: true },
    { id: 'spices_masalas', category_code: 'grocery', name: 'Spices & Masalas', code: 'spices_masalas', display_order: 5, is_active: true },
    { id: 'salt_sugar', category_code: 'grocery', name: 'Salt, Sugar & Jaggery', code: 'salt_sugar', display_order: 6, is_active: true },
  ],
  fruits_vegetables: [
    { id: 'fresh_vegetables', category_code: 'fruits_vegetables', name: 'Fresh Vegetables', code: 'fresh_vegetables', display_order: 1, is_active: true },
    { id: 'fresh_fruits', category_code: 'fruits_vegetables', name: 'Fresh Fruits', code: 'fresh_fruits', display_order: 2, is_active: true },
    { id: 'leafy_greens', category_code: 'fruits_vegetables', name: 'Leafy Greens & Herbs', code: 'leafy_greens', display_order: 3, is_active: true },
    { id: 'organic_exotic', category_code: 'fruits_vegetables', name: 'Organic & Exotic', code: 'organic_exotic', display_order: 4, is_active: true },
  ],
  dairy_bakery: [
    { id: 'milk_cream', category_code: 'dairy_bakery', name: 'Milk & Cream', code: 'milk_cream', display_order: 1, is_active: true },
    { id: 'curd_yogurt', category_code: 'dairy_bakery', name: 'Curd & Yogurt', code: 'curd_yogurt', display_order: 2, is_active: true },
    { id: 'paneer_cheese', category_code: 'dairy_bakery', name: 'Paneer, Butter & Cheese', code: 'paneer_cheese', display_order: 3, is_active: true },
    { id: 'breads_pav', category_code: 'dairy_bakery', name: 'Breads & Pav', code: 'breads_pav', display_order: 4, is_active: true },
    { id: 'cakes_rusk', category_code: 'dairy_bakery', name: 'Cakes & Rusk', code: 'cakes_rusk', display_order: 5, is_active: true },
  ],
  snacks_beverages: [
    { id: 'biscuits_cookies', category_code: 'snacks_beverages', name: 'Biscuits & Cookies', code: 'biscuits_cookies', display_order: 1, is_active: true },
    { id: 'chips_namkeen', category_code: 'snacks_beverages', name: 'Chips & Namkeen', code: 'chips_namkeen', display_order: 2, is_active: true },
    { id: 'tea_coffee', category_code: 'snacks_beverages', name: 'Tea & Coffee', code: 'tea_coffee', display_order: 3, is_active: true },
    { id: 'cold_drinks_juices', category_code: 'snacks_beverages', name: 'Cold Drinks & Juices', code: 'cold_drinks_juices', display_order: 4, is_active: true },
    { id: 'instant_food', category_code: 'snacks_beverages', name: 'Noodles & Instant Food', code: 'instant_food', display_order: 5, is_active: true },
  ],
  clothing: [
    { id: 'mens_wear', category_code: 'clothing', name: "Men's Wear", code: 'mens_wear', display_order: 1, is_active: true },
    { id: 'womens_wear', category_code: 'clothing', name: "Women's Wear", code: 'womens_wear', display_order: 2, is_active: true },
    { id: 'kids_clothing', category_code: 'clothing', name: "Kids' Clothing", code: 'kids_clothing', display_order: 3, is_active: true },
    { id: 'footwear', category_code: 'clothing', name: 'Footwear', code: 'footwear', display_order: 4, is_active: true },
    { id: 'fashion_accessories', category_code: 'clothing', name: 'Fashion Accessories', code: 'fashion_accessories', display_order: 5, is_active: true },
  ],
  electronics: [
    { id: 'mobile_accessories', category_code: 'electronics', name: 'Mobile Accessories', code: 'mobile_accessories', display_order: 1, is_active: true },
    { id: 'audio_earphones', category_code: 'electronics', name: 'Audio & Earphones', code: 'audio_earphones', display_order: 2, is_active: true },
    { id: 'smart_wearables', category_code: 'electronics', name: 'Smart Wearables', code: 'smart_wearables', display_order: 3, is_active: true },
    { id: 'small_appliances', category_code: 'electronics', name: 'Small Appliances', code: 'small_appliances', display_order: 4, is_active: true },
  ],
  beauty_personal_care: [
    { id: 'skincare', category_code: 'beauty_personal_care', name: 'Skin & Face Care', code: 'skincare', display_order: 1, is_active: true },
    { id: 'haircare', category_code: 'beauty_personal_care', name: 'Hair Care', code: 'haircare', display_order: 2, is_active: true },
    { id: 'bath_body', category_code: 'beauty_personal_care', name: 'Bath & Body', code: 'bath_body', display_order: 3, is_active: true },
    { id: 'oral_care', category_code: 'beauty_personal_care', name: 'Oral Care', code: 'oral_care', display_order: 4, is_active: true },
  ],
  home_kitchen: [
    { id: 'cleaning_detergents', category_code: 'home_kitchen', name: 'Cleaning & Detergents', code: 'cleaning_detergents', display_order: 1, is_active: true },
    { id: 'cookware_utensils', category_code: 'home_kitchen', name: 'Cookware & Utensils', code: 'cookware_utensils', display_order: 2, is_active: true },
    { id: 'pooja_needs', category_code: 'home_kitchen', name: 'Pooja Needs', code: 'pooja_needs', display_order: 3, is_active: true },
    { id: 'disposables', category_code: 'home_kitchen', name: 'Disposables & Trash Bags', code: 'disposables', display_order: 4, is_active: true },
  ],
  pharmacy: [
    { id: 'first_aid', category_code: 'pharmacy', name: 'First Aid & Antiseptics', code: 'first_aid', display_order: 1, is_active: true },
    { id: 'vitamins_supplements', category_code: 'pharmacy', name: 'Vitamins & Supplements', code: 'vitamins_supplements', display_order: 2, is_active: true },
    { id: 'healthcare_devices', category_code: 'pharmacy', name: 'Healthcare Devices', code: 'healthcare_devices', display_order: 3, is_active: true },
    { id: 'digestives_pain', category_code: 'pharmacy', name: 'Digestives & Pain Relief', code: 'digestives_pain', display_order: 4, is_active: true },
  ],
  other: [
    { id: 'stationery', category_code: 'other', name: 'Stationery & School', code: 'stationery', display_order: 1, is_active: true },
    { id: 'hardware_electricals', category_code: 'other', name: 'Hardware & Electricals', code: 'hardware_electricals', display_order: 2, is_active: true },
    { id: 'general_misc', category_code: 'other', name: 'General Miscellaneous', code: 'general_misc', display_order: 3, is_active: true },
  ],
};

export async function getCategories(includeInactive = false) {
  try {
    let query = supabase.from('categories').select('*').order('display_order', { ascending: true });
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return DEFAULT_MASTER_CATEGORIES.filter(c => includeInactive || c.is_active);
    }
    return data;
  } catch (err) {
    console.warn('getCategories error, using fallback master data:', err);
    return DEFAULT_MASTER_CATEGORIES.filter(c => includeInactive || c.is_active);
  }
}

export async function getSubcategories(categoryId = null, categoryCode = null, includeInactive = false) {
  try {
    const isUuid = (str) =>
      typeof str === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    const isSpecificCategory =
      (Boolean(categoryId) && categoryId !== 'all') ||
      (Boolean(categoryCode) && categoryCode !== 'all');

    let effectiveCategoryId = isUuid(categoryId) ? categoryId : null;
    let codeToSearch = categoryCode || (!isUuid(categoryId) && categoryId !== 'all' ? categoryId : null);
    if (codeToSearch) {
      codeToSearch = String(codeToSearch).toLowerCase().trim();
    }

    // If categoryId was not a UUID but a code was provided, look up category UUID from categories table
    if (!effectiveCategoryId && codeToSearch && codeToSearch !== 'all') {
      try {
        const { data: catData } = await supabase
          .from('categories')
          .select('id, code')
          .or(`code.eq.${codeToSearch},id.eq.${codeToSearch}`)
          .maybeSingle();
        if (catData?.id) {
          effectiveCategoryId = catData.id;
          if (catData.code) {
            codeToSearch = catData.code.toLowerCase().trim();
          }
        }
      } catch (err) {
        console.warn('Error resolving category UUID for code', codeToSearch, err);
      }
    }

    // If we have effectiveCategoryId UUID but no codeToSearch, look up code from categories table
    if (effectiveCategoryId && (!codeToSearch || codeToSearch === 'all')) {
      try {
        const { data: catData } = await supabase
          .from('categories')
          .select('code')
          .eq('id', effectiveCategoryId)
          .maybeSingle();
        if (catData?.code) {
          codeToSearch = catData.code.toLowerCase().trim();
        }
      } catch (err) {
        console.warn('Error resolving category code for UUID', effectiveCategoryId, err);
      }
    }

    // 1. If a specific category was requested (via code or UUID):
    if (isSpecificCategory) {
      if (effectiveCategoryId) {
        let query = supabase
          .from('subcategories')
          .select('*')
          .eq('category_id', effectiveCategoryId)
          .order('display_order', { ascending: true });
        if (!includeInactive) {
          query = query.eq('is_active', true);
        }
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return data;
        }
      }

      // If DB query returned 0 rows or errored, try master fallback for this specific category
      if (codeToSearch && codeToSearch !== 'all') {
        const fallbackList = DEFAULT_MASTER_SUBCATEGORIES[codeToSearch] || [];
        return fallbackList.filter(s => includeInactive || s.is_active);
      }

      // Specific category has no subcategories in DB and no master fallback:
      // STRICTLY return empty array - NEVER leak all subcategories into a category filter!
      return [];
    }

    // 2. Only if NO specific category was requested at all (caller explicitly wanted all subcategories across all categories):
    let query = supabase.from('subcategories').select('*').order('display_order', { ascending: true });
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      let list = [];
      Object.values(DEFAULT_MASTER_SUBCATEGORIES).forEach(arr => list.push(...arr));
      return list.filter(s => includeInactive || s.is_active);
    }
    return data;
  } catch (err) {
    console.warn('getSubcategories error, using fallback:', err);
    const isSpecificCategory =
      (Boolean(categoryId) && categoryId !== 'all') ||
      (Boolean(categoryCode) && categoryCode !== 'all');
    if (isSpecificCategory) {
      const codeToSearch = String(categoryCode || categoryId || '').toLowerCase().trim();
      if (codeToSearch && DEFAULT_MASTER_SUBCATEGORIES[codeToSearch]) {
        return DEFAULT_MASTER_SUBCATEGORIES[codeToSearch].filter(s => includeInactive || s.is_active);
      }
      return [];
    }
    let list = [];
    Object.values(DEFAULT_MASTER_SUBCATEGORIES).forEach(arr => list.push(...arr));
    return list.filter(s => includeInactive || s.is_active);
  }
}

export async function getAllCategoriesWithSubcategories(includeInactive = false) {
  try {
    let query = supabase
      .from('categories')
      .select('*, subcategories(*)')
      .order('display_order', { ascending: true });
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return DEFAULT_MASTER_CATEGORIES.filter(c => includeInactive || c.is_active).map(cat => ({
        ...cat,
        subcategories: (DEFAULT_MASTER_SUBCATEGORIES[cat.code] || []).filter(s => includeInactive || s.is_active),
      }));
    }
    return data;
  } catch (err) {
    console.warn('getAllCategoriesWithSubcategories error, fallback:', err);
    return DEFAULT_MASTER_CATEGORIES.filter(c => includeInactive || c.is_active).map(cat => ({
      ...cat,
      subcategories: (DEFAULT_MASTER_SUBCATEGORIES[cat.code] || []).filter(s => includeInactive || s.is_active),
    }));
  }
}

export async function createCategory(categoryData) {
  const { data, error } = await supabase.from('categories').insert([categoryData]).select();
  if (error) {
    console.error('Error creating category:', error.message);
    throw error;
  }
  return data?.[0] || null;
}

export async function updateCategory(id, categoryData) {
  const { data, error } = await supabase.from('categories').update(categoryData).eq('id', id).select();
  if (error) {
    console.error('Error updating category:', error.message);
    throw error;
  }
  return data?.[0] || null;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) {
    console.error('Error deleting category:', error.message);
    throw error;
  }
  return true;
}

export async function createSubcategory(subcategoryData) {
  const { data, error } = await supabase.from('subcategories').insert([subcategoryData]).select();
  if (error) {
    console.error('Error creating subcategory:', error.message);
    throw error;
  }
  return data?.[0] || null;
}

export async function updateSubcategory(id, subcategoryData) {
  const { data, error } = await supabase.from('subcategories').update(subcategoryData).eq('id', id).select();
  if (error) {
    console.error('Error updating subcategory:', error.message);
    throw error;
  }
  return data?.[0] || null;
}

export async function deleteSubcategory(id) {
  const { error } = await supabase.from('subcategories').delete().eq('id', id);
  if (error) {
    console.error('Error deleting subcategory:', error.message);
    throw error;
  }
  return true;
}

export async function seedMasterCatalogData() {
  try {
    for (const cat of DEFAULT_MASTER_CATEGORIES) {
      const { data: catData, error: catError } = await supabase
        .from('categories')
        .upsert(
          {
            name: cat.name,
            code: cat.code,
            icon: cat.icon,
            display_order: cat.display_order,
            description: cat.name,
            is_active: true,
          },
          { onConflict: 'code' }
        )
        .select();

      if (!catError && catData && catData[0]) {
        const catId = catData[0].id;
        const subList = DEFAULT_MASTER_SUBCATEGORIES[cat.code] || [];
        for (const sub of subList) {
          await supabase.from('subcategories').upsert(
            {
              category_id: catId,
              name: sub.name,
              code: sub.code,
              display_order: sub.display_order,
              description: sub.name,
              is_active: true,
            },
            { onConflict: 'category_id,code' }
          );
        }
      }
    }
    return { success: true };
  } catch (err) {
    console.error('Error in seedMasterCatalogData:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch seller orders and line items for sales analytics and reports across any date range.
 * Supports hourly distribution analysis and product contribution breakdown.
 */
export async function getSellerOrdersForReport(sellerId, { startDate, endDate } = {}) {
  if (!sellerId) return [];

  const selectQuery = `
    id,
    created_at,
    total_amount,
    status,
    payment_status,
    payment_method,
    order_type,
    seller_id,
    user_id,
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
          product_name
        )
      )
    )
  `;

  try {
    let query = supabase
      .from('orders')
      .select(selectQuery)
      .or(`seller_id.eq.${sellerId},user_id.eq.${sellerId}`)
      .order('created_at', { ascending: true });

    if (startDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      query = query.gte('created_at', s.toISOString());
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      query = query.lte('created_at', e.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.warn('getSellerOrdersForReport query notice:', error.message);
      // Fallback: fetch all via getOrders and filter locally
      const all = await getOrders(sellerId, { role: 'seller', isSeller: true });
      if (!all) return [];
      return all.filter((o) => {
        const t = new Date(o.created_at).getTime();
        if (startDate && t < new Date(startDate).setHours(0, 0, 0, 0)) return false;
        if (endDate && t > new Date(endDate).setHours(23, 59, 59, 999)) return false;
        return true;
      });
    }

    return data || [];
  } catch (err) {
    console.error('getSellerOrdersForReport exception:', err);
    return [];
  }
}
