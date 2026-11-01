import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  FlipHorizontal,
  Zap,
  ZapOff,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Barcode as BarcodeIcon,
  RefreshCw,
  Plus,
  Layers,
  ArrowRight,
  Check,
  Copy,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Scan,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getApiBaseUrl } from '../services/api';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (serialNo: string, batchOrModel?: string) => void;
  initialModelName?: string;
}

// Crisp audio feedback on successful barcode recognition
function playBeepSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1050, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2100, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Audio autoplay restrictions ignored safely
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanComplete,
  initialModelName,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerId = 'html5-barcode-scanner-viewfinder';

  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessingOcr, setIsProcessingOcr] = useState<boolean>(false);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Single scan mode vs Continuous Batch scanning mode
  const [continuousMode, setContinuousMode] = useState<boolean>(false);
  const [batchScannedList, setBatchScannedList] = useState<string[]>([]);
  const [lastScannedToast, setLastScannedToast] = useState<string | null>(null);

  // Single detection result
  const [detectedResult, setDetectedResult] = useState<{
    serialNo: string;
    model?: string;
    batchNo?: string;
    source: 'barcode' | 'ai_ocr';
    formatName?: string;
  } | null>(null);

  // Manual input fallback field
  const [manualSerialInput, setManualSerialInput] = useState<string>('');

  // Zoom & Barcode Enlarge controls (to perfectly fit barcode in box)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [hardwareZoomSupported, setHardwareZoomSupported] = useState<boolean>(false);
  const [maxHardwareZoom, setMaxHardwareZoom] = useState<number>(3.5);
  const [boxPreset, setBoxPreset] = useState<'standard' | 'wide' | 'tall'>('standard');

  // Enlarge barcode image to perfectly fill laser targeting box
  const applyZoom = useCallback(
    async (targetZoom: number) => {
      const clamped = Math.max(1.0, Math.min(3.5, Number(targetZoom.toFixed(1))));
      setZoomLevel(clamped);

      // 1. Hardware camera track zoom (supported on Android Chrome, webcams & high-end mobile cameras)
      if (scannerRef.current) {
        try {
          await scannerRef.current.applyVideoConstraints({
            advanced: [{ zoom: clamped } as any],
          });
        } catch {
          // Hardware zoom unsupported or denied, fallback seamlessly to CSS scale
        }
      }

      // 2. CSS transform scale on video element inside #html5-barcode-scanner-viewfinder
      // Visually and physically enlarges the barcode image inside the container so it fits the targeting box exactly!
      const videoEl = document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;
      if (videoEl) {
        videoEl.style.transform = `scale(${clamped})`;
        videoEl.style.transformOrigin = 'center center';
        videoEl.style.transition = 'transform 0.15s ease-out';
      }
    },
    [containerId]
  );

  // Handle successful barcode recognition
  const handleBarcodeDetected = useCallback(
    (decodedText: string, formatName?: string) => {
      const clean = decodedText.trim();
      if (!clean) return;

      if (!isSoundMuted) {
        playBeepSound();
      }
      if (navigator.vibrate) {
        try {
          navigator.vibrate([100, 50, 100]);
        } catch {
          // ignore
        }
      }

      if (continuousMode) {
        setBatchScannedList((prev) => {
          if (prev.includes(clean)) return prev;
          return [...prev, clean];
        });
        setLastScannedToast(`✓ Scanned: ${clean}`);
        setTimeout(() => setLastScannedToast(null), 3000);
      } else {
        // Stop scanning on single success
        if (scannerRef.current?.isScanning) {
          scannerRef.current.pause(true);
        }
        setDetectedResult({
          serialNo: clean,
          source: 'barcode',
          formatName: formatName || '1D/2D Barcode',
        });
        setManualSerialInput(clean);
      }
    },
    [continuousMode, isSoundMuted]
  );

  // Start the scanner instance
  const startScanner = useCallback(async () => {
    setCameraError(null);
    setDetectedResult(null);

    // Stop existing scanner if running
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // ignore
      }
    }

    try {
      const el = document.getElementById(containerId);
      if (!el) {
        return;
      }

      const scanner = new Html5Qrcode(containerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.AZTEC,
          Html5QrcodeSupportedFormats.PDF_417,
        ],
        verbose: false,
      });

      scannerRef.current = scanner;

      const config = {
        fps: 25, // 25 frames per second for ultra-fast barcode lock
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          // Rectangular laser targeting shape optimized for battery barcodes
          const width = Math.floor(Math.min(viewfinderWidth * 0.9, 360));
          const height = Math.floor(Math.min(viewfinderHeight * 0.55, 200));
          return { width, height };
        },
        aspectRatio: 1.333333,
      };

      await scanner.start(
        { facingMode: facingMode },
        config,
        (decodedText, decodedResult) => {
          const formatName = decodedResult?.result?.format?.formatName || 'Barcode';
          handleBarcodeDetected(decodedText, formatName);
        },
        () => {
          // Frame parse miss (normal when scanning)
        }
      );

      setIsCameraActive(true);

      // Check torch and hardware zoom capabilities
      try {
        const capabilities = (scanner.getRunningTrackCapabilities?.() || {}) as any;
        if (capabilities.torch) {
          setHasTorch(true);
        }
        if (capabilities.zoom) {
          setHardwareZoomSupported(true);
          if (capabilities.zoom.max) {
            setMaxHardwareZoom(capabilities.zoom.max);
          }
        }
      } catch {
        setHasTorch(false);
      }

      // Re-apply preserved zoom level so enlarged view persists
      if (zoomLevel > 1.0) {
        setTimeout(() => {
          applyZoom(zoomLevel);
        }, 150);
      }
    } catch (err: any) {
      console.warn('Barcode scanner start error:', err);
      let msg = 'Could not access camera. Please allow camera permissions or upload a barcode photo.';
      if (err.name === 'NotAllowedError' || String(err).includes('Permission')) {
        msg = 'Camera permission denied. Please enable camera access in your browser or upload a photo.';
      } else if (err.name === 'NotFoundError' || String(err).includes('NotFound')) {
        msg = 'No camera found. You can upload a battery barcode photo or type the serial manually.';
      }
      setCameraError(msg);
      setIsCameraActive(false);
    }
  }, [facingMode, handleBarcodeDetected]);

  // Clean stop of scanner
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Modal open/close lifecycle
  useEffect(() => {
    if (isOpen) {
      // Delay slightly to ensure DOM container is rendered
      const timer = setTimeout(() => {
        startScanner();
      }, 100);
      setBatchScannedList([]);
      setManualSerialInput('');
      setDetectedResult(null);

      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [isOpen, facingMode]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!scannerRef.current) return;
    try {
      const nextTorch = !isTorchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch } as any],
      });
      setIsTorchOn(nextTorch);
    } catch (e) {
      console.warn('Torch toggle failed:', e);
    }
  };

  // Flip Camera Facing Mode (Front / Back)
  const toggleCameraFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Resume camera scanning after rescan
  const handleRescan = () => {
    setDetectedResult(null);
    setManualSerialInput('');
    if (scannerRef.current) {
      try {
        scannerRef.current.resume();
      } catch {
        startScanner();
      }
    } else {
      startScanner();
    }
  };

  // File Upload Barcode Processing (High-speed html5QrCode + Gemini OCR fallback)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingOcr(true);
    setCameraError(null);

    // 1. Try pure client-side file decode via Html5Qrcode
    try {
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;
      }

      const decoded = await scanner.scanFile(file, false);
      if (decoded && decoded.trim()) {
        handleBarcodeDetected(decoded.trim(), 'Decoded from Photo');
        setIsProcessingOcr(false);
        return;
      }
    } catch {
      // Fallback to Gemini AI OCR
    }

    // 2. Fallback to Gemini Flash Vision OCR via /api/scan-barcode-ocr
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target?.result as string;
        if (!base64Data) {
          setIsProcessingOcr(false);
          return;
        }

        try {
          const baseUrl = getApiBaseUrl();
          const res = await fetch(`${baseUrl}/api/scan-barcode-ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: base64Data,
              mimeType: file.type || 'image/jpeg',
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data && data.data.serialNo) {
              handleBarcodeDetected(data.data.serialNo, 'AI Vision OCR');
              setIsProcessingOcr(false);
              return;
            }
          }
          setCameraError('Could not clearly read barcode from this photo. You can type the serial number manually below.');
        } catch {
          setCameraError('Error analyzing image. Please try again or type serial manually.');
        } finally {
          setIsProcessingOcr(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsProcessingOcr(false);
      setCameraError('Failed to read file.');
    }
  };

  // Confirm single result
  const handleConfirmResult = () => {
    const finalSerial = manualSerialInput.trim() || detectedResult?.serialNo.trim();
    if (finalSerial) {
      onScanComplete(finalSerial, detectedResult?.batchNo || detectedResult?.model);
      onClose();
    }
  };

  // Confirm batch scanned list
  const handleConfirmBatch = () => {
    if (batchScannedList.length > 0) {
      onScanComplete(batchScannedList.join(', '));
      onClose();
    }
  };

  // Manual submit
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualSerialInput.trim();
    if (!clean) return;

    if (continuousMode) {
      if (!batchScannedList.includes(clean)) {
        setBatchScannedList((prev) => [...prev, clean]);
        setLastScannedToast(`✓ Added: ${clean}`);
      }
      setManualSerialInput('');
    } else {
      onScanComplete(clean, initialModelName);
      onClose();
    }
  };

  const handleCopy = () => {
    const val = manualSerialInput.trim() || detectedResult?.serialNo.trim();
    if (val) {
      navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-2.5 sm:p-4 bg-slate-950/85 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[96vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-slate-850 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <BarcodeIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Fast Barcode Scanner
                </h3>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
                  25 FPS Auto-Scan
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Instantly scans Code 128, Code 39, EAN-13, QR & all battery barcodes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsSoundMuted(!isSoundMuted)}
              title={isSoundMuted ? 'Unmute Beep' : 'Mute Beep'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isSoundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Bar */}
        <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700">
            <button
              type="button"
              onClick={() => setContinuousMode(false)}
              className={`px-3 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                !continuousMode
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Single Scan
            </button>
            <button
              type="button"
              onClick={() => setContinuousMode(true)}
              className={`px-3 py-1 rounded-md font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                continuousMode
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Multi-Battery Batch</span>
              {batchScannedList.length > 0 && (
                <span className="ml-1 bg-white text-purple-900 rounded-full text-[10px] px-1.5 font-bold">
                  {batchScannedList.length}
                </span>
              )}
            </button>
          </div>

          {lastScannedToast && (
            <div className="text-[11px] font-bold text-emerald-400 bg-emerald-950/90 border border-emerald-500/40 px-2.5 py-0.5 rounded-md animate-in fade-in">
              {lastScannedToast}
            </div>
          )}
        </div>

        {/* Zoom & Enlarge Controls Bar (Quickly enlarge barcode to fit box) */}
        <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2.5 text-xs shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
              <ZoomIn className="w-3.5 h-3.5 text-blue-400" />
              <span>Zoom & Enlarge:</span>
            </span>

            {/* Quick Zoom Presets */}
            <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              {[1.0, 1.5, 2.0, 2.5, 3.0].map((level) => {
                const isActive = Math.abs(zoomLevel - level) < 0.15;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => applyZoom(level)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title={`Enlarge barcode to ${level}x`}
                  >
                    {level}x
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Fine-tuning Slider & +/- Controls */}
            <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => applyZoom(zoomLevel - 0.2)}
                disabled={zoomLevel <= 1.0}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <input
                type="range"
                min="1.0"
                max="3.5"
                step="0.1"
                value={zoomLevel}
                onChange={(e) => applyZoom(parseFloat(e.target.value))}
                className="w-16 sm:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title={`Slider Zoom: ${zoomLevel.toFixed(1)}x`}
              />

              <button
                type="button"
                onClick={() => applyZoom(zoomLevel + 0.2)}
                disabled={zoomLevel >= 3.5}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <span className="text-[11px] font-mono font-bold text-amber-300 w-7 text-right">
                {zoomLevel.toFixed(1)}x
              </span>
            </div>

            {/* Box Shape Presets to match different battery barcode aspect ratios */}
            <div className="hidden xs:flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setBoxPreset('standard')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  boxPreset === 'standard'
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Standard Battery Label Box"
              >
                Standard Box
              </button>
              <button
                type="button"
                onClick={() => setBoxPreset('wide')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  boxPreset === 'wide'
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Long Barcode Strip Box"
              >
                Wide Box
              </button>
              <button
                type="button"
                onClick={() => setBoxPreset('tall')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  boxPreset === 'tall'
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Square QR / Tall Label Box"
              >
                Tall Box
              </button>
            </div>
          </div>
        </div>

        {/* Viewfinder / Camera Video Area */}
        <div className="relative flex-1 bg-black min-h-[280px] sm:min-h-[320px] flex items-center justify-center overflow-hidden">
          {/* HTML5-QRCode Mount Container */}
          <div
            id={containerId}
            className="w-full h-full min-h-[280px] sm:min-h-[320px] flex items-center justify-center [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
          />

          {/* On-screen Floating Thumb Zoom Buttons (Easily accessible while pointing camera) */}
          {!detectedResult && !cameraError && (
            <div className="absolute right-3 top-3 z-15 flex flex-col gap-1 bg-slate-950/85 backdrop-blur-md p-1 rounded-xl border border-slate-700/80 shadow-xl">
              <button
                type="button"
                onClick={() => applyZoom(zoomLevel + 0.3)}
                disabled={zoomLevel >= 3.5}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 text-white flex items-center justify-center font-bold text-xs cursor-pointer shadow-xs"
                title="Enlarge Barcode (+)"
              >
                <ZoomIn className="w-4 h-4 text-blue-400" />
              </button>
              <div className="text-[10px] font-mono font-bold text-center text-amber-300 py-0.5">
                {zoomLevel.toFixed(1)}x
              </div>
              <button
                type="button"
                onClick={() => applyZoom(zoomLevel - 0.3)}
                disabled={zoomLevel <= 1.0}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 text-white flex items-center justify-center font-bold text-xs cursor-pointer shadow-xs"
                title="Reduce Barcode (-)"
              >
                <ZoomOut className="w-4 h-4 text-slate-300" />
              </button>
              {zoomLevel > 1.0 && (
                <button
                  type="button"
                  onClick={() => applyZoom(1.0)}
                  className="px-1 py-0.5 text-[9px] font-bold text-slate-400 hover:text-white text-center cursor-pointer border-t border-slate-800"
                  title="Reset Zoom to 1x"
                >
                  1x
                </button>
              )}
            </div>
          )}

          {/* Visual Red Laser Scan Line Overlay */}
          {!detectedResult && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4 z-10">
              <div
                className={`relative border-2 border-dashed border-blue-400/90 rounded-xl flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.52)] transition-all duration-200 ${
                  boxPreset === 'wide'
                    ? 'w-80 h-28 sm:w-96 sm:h-32'
                    : boxPreset === 'tall'
                    ? 'w-64 h-52 sm:w-72 sm:h-56'
                    : 'w-72 h-36 sm:w-80 sm:h-40'
                }`}
              >
                {/* Corner markers */}
                <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-blue-400 rounded-tl"></span>
                <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-blue-400 rounded-tr"></span>
                <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-blue-400 rounded-bl"></span>
                <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-blue-400 rounded-br"></span>

                {/* Animated Red Laser Scan Line */}
                <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse"></div>

                <div className="absolute bottom-2 text-[10px] text-slate-200 bg-slate-950/90 px-2 py-0.5 rounded backdrop-blur-xs font-mono font-medium flex items-center gap-1.5 shadow-sm">
                  <span>Align Barcode Inside Box</span>
                  {zoomLevel > 1.05 && (
                    <span className="text-amber-300 font-bold bg-amber-950/80 px-1 py-0.2 rounded border border-amber-500/30">
                      {zoomLevel.toFixed(1)}x Zoomed
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Processing Spinner Overlay */}
          {isProcessingOcr && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-3" />
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Reading Barcode & Serial...</span>
              </div>
              <p className="text-xs text-slate-400 text-center mt-1">
                Decoding barcode pattern & label OCR
              </p>
            </div>
          )}

          {/* Single Mode Success Result Overlay */}
          {detectedResult && !continuousMode && (
            <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xs flex flex-col items-center justify-center p-5 z-20 animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold text-emerald-400 tracking-wide uppercase">
                {detectedResult.formatName || 'Barcode Successfully Decoded!'}
              </span>

              {/* Detected Serial Display */}
              <div className="my-3 px-4 py-3 bg-slate-900 border-2 border-emerald-500 rounded-xl text-center shadow-2xl w-full max-w-sm">
                <div className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
                  <span>Battery Serial Number</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={manualSerialInput}
                  onChange={(e) => setManualSerialInput(e.target.value)}
                  className="w-full text-center text-xl sm:text-2xl font-mono font-black text-white bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 mt-1.5 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 w-full max-w-sm mt-1">
                <button
                  type="button"
                  onClick={handleRescan}
                  className="flex-1 py-2.5 px-3 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors cursor-pointer"
                >
                  Rescan Barcode
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResult}
                  className="flex-1 py-2.5 px-3 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Use Serial Number</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Error / Permission Banner */}
          {cameraError && !detectedResult && (
            <div className="absolute inset-x-4 top-4 bg-rose-950/95 border border-rose-600 text-rose-200 p-3.5 rounded-xl text-xs flex items-start gap-2.5 z-20 backdrop-blur-xs shadow-xl">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{cameraError}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={startScanner}
                    className="px-3 py-1 bg-rose-800 hover:bg-rose-700 text-white font-medium rounded-lg text-xs cursor-pointer"
                  >
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs cursor-pointer shadow-xs"
                  >
                    Upload Photo Instead
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Continuous Batch Scanned Chips Tray (if in batch mode) */}
        {continuousMode && batchScannedList.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 max-h-24 overflow-y-auto">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
              <span>Scanned in this session ({batchScannedList.length}):</span>
              <button
                type="button"
                onClick={() => setBatchScannedList([])}
                className="text-rose-400 hover:text-rose-300 cursor-pointer font-medium"
              >
                Clear All
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {batchScannedList.map((sn, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 bg-purple-900/60 border border-purple-500/40 text-purple-200 font-mono text-[11px] px-2 py-0.5 rounded"
                >
                  <span>{sn}</span>
                  <button
                    type="button"
                    onClick={() => setBatchScannedList((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-purple-400 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Controls Toolbar */}
        <div className="p-3.5 bg-slate-850 border-t border-slate-800 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            {/* Torch Toggle */}
            {hasTorch ? (
              <button
                type="button"
                onClick={toggleTorch}
                title="Toggle Flashlight / Torch"
                className={`p-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isTorchOn
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {isTorchOn ? <Zap className="w-4 h-4 text-amber-400" /> : <ZapOff className="w-4 h-4" />}
                <span className="hidden sm:inline">{isTorchOn ? 'Flash On' : 'Flash Off'}</span>
              </button>
            ) : (
              <div />
            )}

            {/* Batch Done Action Button */}
            {continuousMode && batchScannedList.length > 0 ? (
              <button
                type="button"
                onClick={handleConfirmBatch}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Insert All ({batchScannedList.length}) Serials</span>
              </button>
            ) : (
              <div className="text-center text-xs text-slate-400">
                Hold barcode steady in laser box
              </div>
            )}

            {/* Flip Camera Facing Mode (Front / Back) */}
            <button
              type="button"
              onClick={toggleCameraFacing}
              title="Switch Camera (Front / Back)"
              className="p-2 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300 hover:text-white cursor-pointer transition-colors"
            >
              <FlipHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Manual Serial Input Field (Instant fallback so staff is never stuck) */}
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={manualSerialInput}
              onChange={(e) => setManualSerialInput(e.target.value)}
              placeholder="Or type/paste barcode serial (e.g. BAT-6024-001)..."
              className="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!manualSerialInput.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0"
            >
              {continuousMode ? 'Add' : 'Use'}
            </button>
          </form>

          {/* Upload Photo Button */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
            <span>Can also read from an image file:</span>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-lg cursor-pointer font-medium text-[11px]"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Upload Barcode Photo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
