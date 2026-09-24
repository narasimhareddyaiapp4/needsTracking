import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { FontAwesome as Icon } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { playNotificationChime } from '../services/speechService';
import { decodeQrFromImage } from '../services/qrScanService';
import { showAlert } from '../utils/alertUtils';

let Html5Qrcode = null;
let Html5QrcodeSupportedFormats = null;
let Html5QrcodeScannerState = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    const html5 = require('html5-qrcode');
    Html5Qrcode = html5.Html5Qrcode;
    Html5QrcodeSupportedFormats = html5.Html5QrcodeSupportedFormats;
    Html5QrcodeScannerState = html5.Html5QrcodeScannerState;
  } catch (err) {
    console.warn('[BarcodeScannerModal] html5-qrcode import error:', err);
  }
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Universal Mobile Barcode & QR Scanner Modal
 *
 * Compatible with Web browsers (Mobile Chrome, Safari, Desktop) and Native.
 * Supports:
 * - 1D Barcodes: EAN-13, EAN-8, UPC-A, UPC-E, CODE-128, CODE-39, CODE-93, ITF
 * - 2D Codes: QR Code, Data Matrix
 * - Continuous POS Cashier scanning (scan item after item with audio chime)
 * - Single scan mode (auto-closes upon first detected item)
 * - Flashlight / Torch toggle for low-light store aisles
 * - Camera gallery & photo capture fallback
 * - Manual digit typing fallback
 */
export default function BarcodeScannerModal({
  visible,
  onClose,
  onScan,
  title = 'Mobile Barcode Scanner',
  subtitle = 'Point camera at any product barcode, carton code, or QR',
  defaultContinuous = false,
  continuousCooldownMs = 1400,
}) {
  const [isContinuous, setIsContinuous] = useState(defaultContinuous);
  const [scannerActive, setScannerActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [lastScanned, setLastScanned] = useState(null);
  const [manualCode, setManualCode] = useState('');
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const scannerRef = useRef(null);
  const laserAnim = useRef(new Animated.Value(0)).current;
  const lastScanTimestamp = useRef(0);
  const lastCodeScanned = useRef('');
  const containerId = useRef(`qr-reader-${Math.random().toString(36).substring(2, 9)}`).current;

  // Animate laser scanner line
  useEffect(() => {
    if (visible && scannerActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 0,
            duration: 1800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      laserAnim.setValue(0);
    }
  }, [visible, scannerActive]);

  // Clean stop scanner helper
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState?.();
        if (
          Html5QrcodeScannerState &&
          state === Html5QrcodeScannerState.SCANNING
        ) {
          await scannerRef.current.stop();
        } else if (!Html5QrcodeScannerState && scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (err) {
        console.warn('[BarcodeScannerModal] Stop scanner error:', err);
      }
      scannerRef.current = null;
    }
    setScannerActive(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  // Handle successful code detection
  const handleDetectedCode = useCallback(
    (codeStr) => {
      if (!codeStr || typeof codeStr !== 'string') return;
      const clean = codeStr.trim();
      if (!clean) return;

      const now = Date.now();
      // Debounce if in continuous mode and same code was just scanned
      if (
        isContinuous &&
        clean.toLowerCase() === lastCodeScanned.current.toLowerCase() &&
        now - lastScanTimestamp.current < continuousCooldownMs
      ) {
        return;
      }

      lastScanTimestamp.current = now;
      lastCodeScanned.current = clean;
      setLastScanned(clean);

      // Play audio chime and haptic feedback
      try {
        playNotificationChime();
      } catch (_) {}

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([60, 40, 60]);
        } catch (_) {}
      }

      if (onScan) {
        onScan(clean);
      }

      // If single-scan mode, close modal immediately
      if (!isContinuous) {
        stopScanner();
        if (onClose) onClose();
      }
    },
    [isContinuous, continuousCooldownMs, onScan, onClose, stopScanner]
  );

  // Initialize and start camera scanner on Web
  const startScanner = useCallback(async () => {
    if (Platform.OS !== 'web' || !Html5Qrcode) {
      return;
    }

    setCameraError(null);
    try {
      await stopScanner();

      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      // Detect available cameras
      try {
        const devList = await Html5Qrcode.getCameras();
        if (devList && devList.length > 0) {
          setCameras(devList);
          if (!selectedCameraId) {
            const backCam =
              devList.find((c) =>
                /back|rear|environment|main/i.test(c.label || '')
              ) || devList[devList.length - 1];
            setSelectedCameraId(backCam.id);
          }
        }
      } catch (camErr) {
        console.warn('Error enumerating cameras:', camErr);
      }

      const formatsToSupport = [
        Html5QrcodeSupportedFormats?.EAN_13,
        Html5QrcodeSupportedFormats?.EAN_8,
        Html5QrcodeSupportedFormats?.UPC_A,
        Html5QrcodeSupportedFormats?.UPC_E,
        Html5QrcodeSupportedFormats?.CODE_128,
        Html5QrcodeSupportedFormats?.CODE_39,
        Html5QrcodeSupportedFormats?.CODE_93,
        Html5QrcodeSupportedFormats?.ITF,
        Html5QrcodeSupportedFormats?.QR_CODE,
        Html5QrcodeSupportedFormats?.DATA_MATRIX,
      ].filter(Boolean);

      const cameraConfig = selectedCameraId
        ? { deviceId: { exact: selectedCameraId } }
        : { facingMode: 'environment' };

      await scanner.start(
        cameraConfig,
        {
          fps: 15,
          qrbox: (w, h) => {
            const minEdge = Math.min(w, h);
            return {
              width: Math.min(Math.floor(minEdge * 0.85), 320),
              height: Math.min(Math.floor(minEdge * 0.65), 220),
            };
          },
          aspectRatio: 1.0,
          formatsToSupport:
            formatsToSupport.length > 0 ? formatsToSupport : undefined,
        },
        (decodedText) => {
          handleDetectedCode(decodedText);
        },
        () => {
          // Scanner frame error (silent - normal between frames)
        }
      );

      setScannerActive(true);

      // Check if torch/flashlight is supported
      try {
        const capabilities = scanner.getRunningTrackCapabilities?.();
        if (capabilities && capabilities.torch) {
          setTorchAvailable(true);
        }
      } catch (_) {}
    } catch (err) {
      console.warn('Start scanner error:', err);
      setScannerActive(false);
      setCameraError(
        err?.message ||
          'Camera could not be accessed. Please ensure camera permissions are allowed in your browser settings.'
      );
    }
  }, [containerId, selectedCameraId, stopScanner, handleDetectedCode]);

  // Lifecycle: Start when modal opens, stop when modal closes
  useEffect(() => {
    let timer;
    if (visible) {
      setLastScanned(null);
      lastCodeScanned.current = '';
      lastScanTimestamp.current = 0;
      setManualCode('');
      setCameraError(null);
      // Small timeout to allow DOM element to render
      timer = setTimeout(() => {
        startScanner();
      }, 250);
    } else {
      stopScanner();
    }

    return () => {
      if (timer) clearTimeout(timer);
      stopScanner();
    };
  }, [visible, startScanner, stopScanner]);

  // Switch camera toggle
  const handleSwitchCamera = async () => {
    if (!cameras || cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    setSelectedCameraId(nextCamera.id);
  };

  // Re-start scanner when selected camera changes
  useEffect(() => {
    if (visible && selectedCameraId && scannerActive) {
      startScanner();
    }
  }, [selectedCameraId]);

  // Toggle Torch/Flashlight
  const handleToggleTorch = async () => {
    if (!scannerRef.current || !torchAvailable) return;
    try {
      const nextTorch = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Torch toggle error:', err);
    }
  };

  // Photo / Gallery scan fallback
  const handlePickImage = async (sourceType = 'gallery') => {
    setIsProcessingFile(true);
    try {
      let result;
      if (sourceType === 'camera' && Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          showAlert('Permission Denied', 'Camera permission is required.');
          setIsProcessingFile(false);
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: false,
          quality: 0.9,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: false,
          quality: 0.9,
        });
      }

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];

        // 1. Try Html5Qrcode.scanFile on Web
        if (Platform.OS === 'web' && scannerRef.current) {
          try {
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            const file = new File([blob], 'barcode.jpg', {
              type: blob.type || 'image/jpeg',
            });
            const decoded = await scannerRef.current.scanFile(file, true);
            if (decoded) {
              handleDetectedCode(decoded);
              setIsProcessingFile(false);
              return;
            }
          } catch (fileScanErr) {
            console.warn('scanFile notice:', fileScanErr);
          }
        }

        // 2. Fallback to decodeQrFromImage
        const qrRes = await decodeQrFromImage(asset.uri);
        if (qrRes && qrRes.success && qrRes.rawText) {
          handleDetectedCode(qrRes.rawText);
          setIsProcessingFile(false);
          return;
        }

        showAlert(
          'No Barcode Detected',
          'Could not find a recognizable barcode in this photo. Please hold the barcode steady, centered, and well-lit.'
        );
      }
    } catch (err) {
      console.warn('handlePickImage error:', err);
      showAlert('Error', 'Failed to scan image. Please try again or type the code.');
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) return;
    handleDetectedCode(manualCode.trim());
    setManualCode('');
  };

  const laserTranslateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 200],
  });

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {
        stopScanner();
        if (onClose) onClose();
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="barcode" size={20} color="#007AFF" />
                <Text style={styles.headerTitle}>{title}</Text>
              </View>
              <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => {
                stopScanner();
                if (onClose) onClose();
              }}
              accessibilityLabel="Close Scanner"
            >
              <Icon name="times" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Mode Switcher: POS Continuous vs Single Scan */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[
                styles.modeTab,
                !isContinuous && styles.modeTabActive,
              ]}
              onPress={() => setIsContinuous(false)}
            >
              <Text
                style={[
                  styles.modeTabText,
                  !isContinuous && styles.modeTabTextActive,
                ]}
              >
                🎯 Single Scan
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modeTab,
                isContinuous && styles.modeTabActiveContinuous,
              ]}
              onPress={() => setIsContinuous(true)}
            >
              <Text
                style={[
                  styles.modeTabText,
                  isContinuous && styles.modeTabTextActiveContinuous,
                ]}
              >
                🛒 Continuous POS Scan
              </Text>
            </TouchableOpacity>
          </View>

          {/* Viewfinder Area */}
          <View style={styles.viewfinderContainer}>
            {/* HTML5 Video element container on Web */}
            {Platform.OS === 'web' ? (
              <div
                id={containerId}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: '230px',
                  backgroundColor: '#000000',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            ) : (
              <View style={styles.nativePlaceholder}>
                <Icon name="camera" size={48} color="#94A3B8" />
                <Text style={styles.nativePlaceholderText}>
                  Tap below to open camera or select barcode photo
                </Text>
              </View>
            )}

            {/* Targeting Reticle & Laser Sweep Overlay */}
            {scannerActive && (
              <View style={styles.overlayFrame} pointerEvents="none">
                <View style={styles.reticleBox}>
                  {/* Corner accents */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />

                  {/* Animated Laser Line */}
                  <Animated.View
                    style={[
                      styles.laserLine,
                      { transform: [{ translateY: laserTranslateY }] },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Camera Floating Controls (Torch & Flip) */}
            {scannerActive && (
              <View style={styles.floatingControls}>
                {torchAvailable && (
                  <TouchableOpacity
                    style={[
                      styles.controlIconBtn,
                      torchOn && styles.controlIconBtnActive,
                    ]}
                    onPress={handleToggleTorch}
                    accessibilityLabel="Toggle Flashlight"
                  >
                    <Icon
                      name="flash"
                      size={18}
                      color={torchOn ? '#F59E0B' : '#FFFFFF'}
                    />
                  </TouchableOpacity>
                )}

                {cameras.length > 1 && (
                  <TouchableOpacity
                    style={styles.controlIconBtn}
                    onPress={handleSwitchCamera}
                    accessibilityLabel="Switch Camera"
                  >
                    <Icon name="refresh" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Loading Indicator */}
            {isProcessingFile && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.processingText}>Analyzing barcode...</Text>
              </View>
            )}
          </View>

          {/* Camera Error / Permission Notice */}
          {cameraError && (
            <View style={styles.errorBox}>
              <Icon name="exclamation-triangle" size={16} color="#DC2626" />
              <Text style={styles.errorText}>
                {cameraError}
              </Text>
            </View>
          )}

          {/* Scanned Feedback Pill */}
          {lastScanned && (
            <View style={styles.scannedSuccessBanner}>
              <Icon name="check-circle" size={16} color="#059669" />
              <Text style={styles.scannedSuccessText}>
                Scanned: <Text style={{ fontWeight: '700' }}>{lastScanned}</Text>
              </Text>
              {isContinuous && (
                <View style={styles.continuousReadyBadge}>
                  <Text style={styles.continuousReadyBadgeText}>Ready for Next</Text>
                </View>
              )}
            </View>
          )}

          {/* Fallback Actions (Gallery / Photo / Manual Typing) */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => handlePickImage('gallery')}
              disabled={isProcessingFile}
            >
              <Icon name="image" size={15} color="#007AFF" />
              <Text style={styles.actionBtnSecondaryText}>Pick Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => handlePickImage('camera')}
              disabled={isProcessingFile}
            >
              <Icon name="camera" size={15} color="#007AFF" />
              <Text style={styles.actionBtnSecondaryText}>Take Photo</Text>
            </TouchableOpacity>
          </View>

          {/* Manual Code Input Bar */}
          <View style={styles.manualInputRow}>
            <TextInput
              style={styles.manualInput}
              placeholder="Or type barcode / serial number..."
              placeholderTextColor="#94A3B8"
              value={manualCode}
              onChangeText={setManualCode}
              onSubmitEditing={handleManualSubmit}
              returnKeyType="done"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[
                styles.manualSubmitBtn,
                !manualCode.trim() && { opacity: 0.5 },
              ]}
              onPress={handleManualSubmit}
              disabled={!manualCode.trim()}
            >
              <Text style={styles.manualSubmitBtnText}>Submit</Text>
            </TouchableOpacity>
          </View>

          {/* Guidance Footnote */}
          <Text style={styles.footerTip}>
            Supports standard 1D barcodes (EAN-13, UPC-A, Code-128) & QR codes.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
    marginLeft: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modeTabActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  modeTabActiveContinuous: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modeTabTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  modeTabTextActiveContinuous: {
    color: '#047857',
    fontWeight: '700',
  },
  viewfinderContainer: {
    width: '100%',
    height: 250,
    backgroundColor: '#000000',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  nativePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  nativePlaceholderText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleBox: {
    width: 250,
    height: 170,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#06B6D4',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  laserLine: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 2,
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  floatingControls: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 8,
  },
  controlIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  controlIconBtnActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.85)',
    borderColor: '#F59E0B',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 16,
  },
  scannedSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    gap: 8,
  },
  scannedSuccessText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
  },
  continuousReadyBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  continuousReadyBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  actionBtnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
    gap: 8,
  },
  manualInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 6,
  },
  manualSubmitBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  manualSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  footerTip: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
  },
});
