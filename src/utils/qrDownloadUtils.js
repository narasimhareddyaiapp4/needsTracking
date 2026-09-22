import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { showAlert } from './alertUtils';

/**
 * Downloads or saves a QR code image to the user's device across Web, iOS, and Android.
 * Supports data URLs (base64) and remote URLs (https://...).
 *
 * @param {string} uri - The image data URL or remote URL.
 * @param {string} [fileName="payment-qr-code"] - The suggested file name without extension.
 * @returns {Promise<boolean>}
 */
export async function downloadQrCodeImage(uri, fileName = 'payment-qr-code') {
  if (!uri) {
    showAlert('Error', 'No QR code image available to download.');
    return false;
  }

  const cleanName = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fullFileName = cleanName.endsWith('.png') ? cleanName : `${cleanName}.png`;

  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;

      if (uri.startsWith('data:image')) {
        try {
          const parts = uri.split(',');
          const mimeMatch = parts[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/png';
          const bstr = atob(parts[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          const blob = new Blob([u8arr], { type: mime });
          const objectUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = fullFileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
          showAlert('Success', `QR code downloaded as ${fullFileName}`);
          return true;
        } catch (_) {
          // Fallback to direct href
          const link = document.createElement('a');
          link.href = uri;
          link.download = fullFileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showAlert('Success', `QR code downloaded as ${fullFileName}`);
          return true;
        }
      }

      // If remote HTTP/HTTPS URL, fetch blob to ensure download attribute works without cross-origin navigation
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fullFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(objectUrl);
        showAlert('Success', `QR code downloaded as ${fullFileName}`);
        return true;
      } catch (fetchErr) {
        // Fallback for CORS restricted remote URLs
        const link = document.createElement('a');
        link.href = uri;
        link.download = fullFileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showAlert('Success', 'QR code download opened.');
        return true;
      }
    }

    // Native Mobile (Android & iOS)
    const targetPath = `${FileSystem.cacheDirectory}${fullFileName}`;

    if (uri.startsWith('data:image')) {
      const commaIdx = uri.indexOf(',');
      const base64Data = commaIdx !== -1 ? uri.substring(commaIdx + 1) : uri;
      await FileSystem.writeAsStringAsync(targetPath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      await FileSystem.downloadAsync(uri, targetPath);
    }

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(targetPath, {
        mimeType: 'image/png',
        dialogTitle: 'Save QR Code',
        UTI: 'public.png',
      });
      return true;
    } else {
      showAlert('Saved', 'QR Code saved to device storage.');
      return true;
    }
  } catch (err) {
    console.error('[qrDownloadUtils] downloadQrCodeImage error:', err);
    showAlert('Download Error', 'Could not save QR code: ' + (err.message || 'Unknown error'));
    return false;
  }
}
