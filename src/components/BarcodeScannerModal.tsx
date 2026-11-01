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
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';
import { getApiBaseUrl } from '../services/api';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (serialNo: string, batchOrModel?: string) => void;
  initialModelName?: string;
}

// Sound feedback on successful barcode recognition
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
    osc.frequency.setValueAtTime(950, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1900, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Audio autoplay restrictions ignored safely
  }
}

// Helper to decode raw ImageData buffer using pure ZXing reader
function decodeImageDataWithZXing(imageData: ImageData, reader: MultiFormatReader): string | null {
  try {
    const luminanceSource = new RGBLuminanceSource(
      imageData.data,
      imageData.width,
      imageData.height
    );
    const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
    const result = reader.decode(binaryBitmap);
    if (result && result.getText()) {
      return result.getText().trim();
    }
  } catch {
    // Expected NotFoundException when frame has no barcode
  }
  return null;
}

// Multi-pass preprocessing for difficult or noisy barcode images
function multiPassDecode(canvas: HTMLCanvasElement, reader: MultiFormatReader): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;

  // Pass 1: Raw Canvas
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const rawResult = decodeImageDataWithZXing(imgData, reader);
    if (rawResult) return rawResult;
  } catch {
    // continue to next pass
  }

  // Pass 2: High Contrast Threshold Binarization
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    // Compute average luminance
    let totalLum = 0;
    const pixelCount = w * h;
    for (let i = 0; i < data.length; i += 4) {
      totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const avgLum = totalLum / pixelCount;

    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = lum > avgLum * 0.95 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
    const binarizedResult = decodeImageDataWithZXing(imgData, reader);
    if (binarizedResult) return binarizedResult;
  } catch {
    // continue
  }

  // Pass 3: Invert colors (for white barcodes on dark backgrounds or metallic battery labels)
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
    const invertedResult = decodeImageDataWithZXing(imgData, reader);
    if (invertedResult) return invertedResult;
  } catch {
    // continue
  }

  return null;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanComplete,
  initialModelName,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [isProcessingOcr, setIsProcessingOcr] = useState<boolean>(false);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(false);

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
  } | null>(null);

  // Manual input fallback field
  const [manualSerialInput, setManualSerialInput] = useState<string>('');

  // Native BarcodeDetector if available
  const [nativeBarcodeDetector, setNativeBarcodeDetector] = useState<any>(null);

  // Initialize ZXing MultiFormatReader
  useEffect(() => {
    try {
      const hints = new Map<DecodeHintType, any>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.PDF_417,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      zxingReaderRef.current = reader;
    } catch (e) {
      console.warn('ZXing MultiFormatReader initialization error:', e);
    }

    // Also check native browser BarcodeDetector API as fast-path
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({
          formats: [
            'code_128',
            'code_39',
            'code_93',
            'ean_13',
            'ean_8',
            'upc_a',
            'upc_e',
            'qr_code',
            'data_matrix',
            'itf',
            'codabar',
          ],
        });
        setNativeBarcodeDetector(detector);
      } catch {
        // native detector fallback to ZXing
      }
    }
  }, []);

  // Stop camera media tracks cleanly
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      setStream(null);
    }
  }, [stream]);

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    setCameraError(null);

    // Stop existing stream first
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
        },
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(() => {
          // auto-play handled
        });
      }

      // Check if torch/flashlight is supported
      const track = newStream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track.getCapabilities?.() || {}) as any;
        if (capabilities.torch) {
          setHasTorch(true);
        } else {
          setHasTorch(false);
        }
      }
    } catch (err: any) {
      console.warn('Camera start error:', err);
      let msg = 'Could not access camera. Please allow camera permissions or upload a photo.';
      if (err.name === 'NotAllowedError') {
        msg = 'Camera permission was denied. Please allow camera access in your browser settings.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No camera found on this device. You can still upload a photo or enter serial manually.';
      }
      setCameraError(msg);
    }
  }, [facingMode, stream]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const targetState = !isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: targetState }],
        });
        setIsTorchOn(targetState);
      } catch (err) {
        console.warn('Failed to toggle torch:', err);
      }
    }
  };

  // Toggle Camera Front / Back
  const toggleCameraFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Start camera when modal opens
  useEffect(() => {
    if (isOpen) {
      startCamera();
      setIsScanning(true);
      setDetectedResult(null);
      setBatchScannedList([]);
      setManualSerialInput('');
      setCameraError(null);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  // Handle successful detection
  const handleBarcodeFound = useCallback(
    (serial: string, source: 'barcode' | 'ai_ocr', extraModel?: string, extraBatch?: string) => {
      const trimmed = serial.trim();
      if (!trimmed) return;

      if (!isSoundMuted) {
        playBeepSound();
      }
      if (navigator.vibrate) {
        try {
          navigator.vibrate([80, 40, 80]);
        } catch {
          // ignore
        }
      }

      if (continuousMode) {
        // In continuous batch mode: add to list if not already just scanned
        setBatchScannedList((prev) => {
          if (prev.includes(trimmed)) return prev;
          return [...prev, trimmed];
        });
        setLastScannedToast(`✓ Scanned: ${trimmed}`);
        setTimeout(() => {
          setLastScannedToast(null);
        }, 3000);
      } else {
        // Single scan mode: show confirmation
        setIsScanning(false);
        setDetectedResult({
          serialNo: trimmed,
          model: extraModel,
          batchNo: extraBatch,
          source,
        });
        setManualSerialInput(trimmed);
      }
    },
    [continuousMode, isSoundMuted]
  );

  // Continuous frame scanning loop with ZXing and native BarcodeDetector
  useEffect(() => {
    if (!isOpen || !isScanning || detectedResult) {
      return;
    }

    let isSubscribed = true;
    let timerId: any = null;
    let lastScanTime = 0;
    let lastScannedText = '';

    const scanCurrentFrame = async () => {
      if (!isSubscribed || !videoRef.current || videoRef.current.readyState < 2) {
        timerId = setTimeout(scanCurrentFrame, 200);
        return;
      }

      const now = Date.now();
      // Throttle scanning to ~180ms to keep CPU silky smooth
      if (now - lastScanTime < 180) {
        timerId = setTimeout(scanCurrentFrame, 180 - (now - lastScanTime));
        return;
      }
      lastScanTime = now;

      const video = videoRef.current;
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      if (!vWidth || !vHeight) {
        timerId = setTimeout(scanCurrentFrame, 200);
        return;
      }

      // Fast-path: Native BarcodeDetector on video element if available
      if (nativeBarcodeDetector) {
        try {
          const barcodes = await nativeBarcodeDetector.detect(video);
          if (barcodes && barcodes.length > 0) {
            const raw = barcodes[0].rawValue?.trim();
            if (raw && (raw !== lastScannedText || continuousMode)) {
              lastScannedText = raw;
              handleBarcodeFound(raw, 'barcode');
              if (!continuousMode) return;
            }
          }
        } catch {
          // continue to ZXing
        }
      }

      // ZXing pure pixel scanner:
      // Focus on the laser target area (center 65% width, 40% height) for ultra-sharp decode
      const reader = zxingReaderRef.current;
      if (reader && canvasRef.current) {
        try {
          const canvas = canvasRef.current;
          const cropW = Math.floor(vWidth * 0.7);
          const cropH = Math.floor(vHeight * 0.45);
          const cropX = Math.floor((vWidth - cropW) / 2);
          const cropY = Math.floor((vHeight - cropH) / 2);

          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          if (ctx) {
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const imgData = ctx.getImageData(0, 0, cropW, cropH);
            const decoded = decodeImageDataWithZXing(imgData, reader);

            if (decoded) {
              if (decoded !== lastScannedText || continuousMode) {
                lastScannedText = decoded;
                handleBarcodeFound(decoded, 'barcode');
                if (!continuousMode) return;
              }
            } else {
              // If center crop didn't find it, test full frame scaled down for wider codes
              canvas.width = 640;
              canvas.height = Math.floor((vHeight / vWidth) * 640);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const fullImgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const fullDecoded = decodeImageDataWithZXing(fullImgData, reader);
              if (fullDecoded) {
                if (fullDecoded !== lastScannedText || continuousMode) {
                  lastScannedText = fullDecoded;
                  handleBarcodeFound(fullDecoded, 'barcode');
                  if (!continuousMode) return;
                }
              }
            }
          }
        } catch {
          // Frame glitch ignored
        }
      }

      if (isSubscribed) {
        timerId = setTimeout(scanCurrentFrame, continuousMode ? 350 : 180);
      }
    };

    timerId = setTimeout(scanCurrentFrame, 300);

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isOpen, isScanning, detectedResult, nativeBarcodeDetector, continuousMode, handleBarcodeFound]);

  // Capture canvas image from current video stream
  const captureCurrentFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  // Process image with Multi-Pass ZXing + Server / Gemini OCR Fallback
  const processImageWithOcr = async (base64Image: string) => {
    setIsProcessingOcr(true);
    setCameraError(null);

    const reader = zxingReaderRef.current;

    // Step 1: Multi-Pass pure client-side barcode decoding (ZXing)
    if (reader && canvasRef.current) {
      const zxingFound = multiPassDecode(canvasRef.current, reader);
      if (zxingFound) {
        handleBarcodeFound(zxingFound, 'barcode');
        setIsProcessingOcr(false);
        return;
      }
    }

    // Step 2: Native BarcodeDetector on canvas if supported
    if (nativeBarcodeDetector && canvasRef.current) {
      try {
        const barcodes = await nativeBarcodeDetector.detect(canvasRef.current);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          handleBarcodeFound(barcodes[0].rawValue.trim(), 'barcode');
          setIsProcessingOcr(false);
          return;
        }
      } catch {
        // continue to AI OCR
      }
    }

    // Step 3: Call backend /api/scan-barcode-ocr (Gemini Flash Vision)
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/scan-barcode-ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Image,
          mimeType: 'image/jpeg',
        }),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success && result.data && result.data.serialNo) {
          handleBarcodeFound(
            result.data.serialNo,
            'ai_ocr',
            result.data.model,
            result.data.batchNo
          );
          setIsProcessingOcr(false);
          return;
        }
      }

      // If no barcode or serial recognized automatically, prompt manual typing
      setCameraError(
        'Could not clearly detect a barcode in this photo. Please hold closer with good lighting, or type the serial number manually below.'
      );
    } catch (err: any) {
      console.warn('OCR error:', err);
      setCameraError('Processing photo failed. Please try again or type the serial number manually.');
    } finally {
      setIsProcessingOcr(false);
    }
  };

  // User clicked "Capture & Read Serial" button
  const handleCaptureSnapshot = () => {
    const dataUrl = captureCurrentFrame();
    if (dataUrl) {
      processImageWithOcr(dataUrl);
    }
  };

  // User uploaded a photo from camera roll / gallery
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        const img = new Image();
        img.onload = () => {
          if (canvasRef.current) {
            canvasRef.current.width = img.width;
            canvasRef.current.height = img.height;
            const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
            ctx?.drawImage(img, 0, 0);
          }
          processImageWithOcr(dataUrl);
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  // Confirm single result and pass back to parent
  const handleConfirmResult = () => {
    const serialToUse = manualSerialInput.trim() || detectedResult?.serialNo.trim();
    if (serialToUse) {
      onScanComplete(serialToUse, detectedResult?.batchNo || detectedResult?.model);
      onClose();
    }
  };

  // Confirm batch scanned list and pass comma-separated back to parent
  const handleConfirmBatch = () => {
    if (batchScannedList.length > 0) {
      onScanComplete(batchScannedList.join(', '));
      onClose();
    }
  };

  // Manual submission from input field
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

  // Quick prefix suggestion helper
  const handleApplyPrefix = (prefix: string) => {
    setManualSerialInput((prev) => (prev ? `${prefix}${prev}` : `${prefix}`));
  };

  // Reset and scan next
  const handleScanAgain = () => {
    setDetectedResult(null);
    setIsScanning(true);
    setCameraError(null);
    setManualSerialInput('');
  };

  if (!isOpen) return null;

  // Clean prefix helper from model name
  const modelCleanPrefix = initialModelName
    ? initialModelName.replace(/[×x\s]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)
    : 'BAT';

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-2.5 sm:p-4 bg-slate-950/85 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-slate-850 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <BarcodeIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Battery Barcode Scanner
                </h3>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
                  ZXing Multi-1D/2D
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Auto-decodes Code 128, Code 39, EAN, QR & battery labels
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Audio Toggle */}
            <button
              type="button"
              onClick={() => setIsSoundMuted(!isSoundMuted)}
              title={isSoundMuted ? 'Unmute Beep' : 'Mute Beep'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isSoundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            {/* Close Button */}
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
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                !continuousMode
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Single Battery
            </button>
            <button
              type="button"
              onClick={() => setContinuousMode(true)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                continuousMode
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Continuous Batch</span>
              {batchScannedList.length > 0 && (
                <span className="ml-1 bg-white text-purple-900 rounded-full text-[10px] px-1.5 font-bold">
                  {batchScannedList.length}
                </span>
              )}
            </button>
          </div>

          {/* Quick Notification Toast */}
          {lastScannedToast && (
            <div className="text-[11px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-md animate-in fade-in">
              {lastScannedToast}
            </div>
          )}
        </div>

        {/* Viewfinder Area */}
        <div className="relative flex-1 bg-black min-h-[260px] sm:min-h-[300px] flex items-center justify-center overflow-hidden">
          {/* Hidden Canvas for Frame Processing */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Video Stream */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${detectedResult ? 'opacity-40 grayscale' : ''}`}
          />

          {/* Scanner Overlay Guide (when actively scanning) */}
          {isScanning && !detectedResult && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
              {/* Laser Target Box */}
              <div className="relative w-64 h-36 sm:w-72 sm:h-40 border-2 border-dashed border-blue-400/80 rounded-xl flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.52)]">
                {/* Corner markers */}
                <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-blue-400 rounded-tl"></span>
                <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-blue-400 rounded-tr"></span>
                <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-blue-400 rounded-bl"></span>
                <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-blue-400 rounded-br"></span>

                {/* Animated Laser Scan Line */}
                <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-pulse"></div>

                <div className="absolute bottom-2 text-[10px] text-slate-200 bg-slate-950/85 px-2 py-0.5 rounded backdrop-blur-xs font-mono font-medium">
                  Align Barcode Inside Box
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="text-[11px] text-slate-300 font-medium bg-black/60 px-3 py-1 rounded-full backdrop-blur-xs text-center">
                  {continuousMode ? '⚡ Multi-scan active · Point at each battery' : '⚡ Auto-reading live frames in real-time'}
                </span>
              </div>
            </div>
          )}

          {/* Processing Spinner Overlay */}
          {isProcessingOcr && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-3" />
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Reading Battery Barcode & Serial...</span>
              </div>
              <p className="text-xs text-slate-400 text-center mt-1">
                Running multi-pass ZXing decoding & vision OCR
              </p>
            </div>
          )}

          {/* Single Mode Success Result Overlay */}
          {detectedResult && !continuousMode && (
            <div className="absolute inset-0 bg-slate-950/92 backdrop-blur-xs flex flex-col items-center justify-center p-5 z-20">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold text-emerald-400 tracking-wide uppercase">
                {detectedResult.source === 'barcode' ? 'Barcode Decoded!' : 'Serial Extracted via OCR!'}
              </span>

              {/* Detected Serial Display with Inline Edit */}
              <div className="my-2.5 px-4 py-2.5 bg-slate-900 border-2 border-emerald-500 rounded-xl text-center shadow-lg w-full max-w-xs">
                <div className="text-[10px] uppercase font-mono text-slate-400">Battery Serial Number</div>
                <input
                  type="text"
                  value={manualSerialInput}
                  onChange={(e) => setManualSerialInput(e.target.value)}
                  className="w-full text-center text-lg sm:text-xl font-mono font-black text-white bg-slate-950/50 border border-slate-700 rounded px-2 py-1 mt-1 focus:border-emerald-500 focus:outline-none"
                />
                {detectedResult.model && (
                  <div className="mt-1 text-xs text-emerald-300 font-medium">
                    Model: {detectedResult.model}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 w-full max-w-xs mt-1">
                <button
                  type="button"
                  onClick={handleScanAgain}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Rescan
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResult}
                  className="flex-1 py-2 px-3 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Use Serial</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Error / Permission Banner */}
          {cameraError && !detectedResult && (
            <div className="absolute inset-x-4 top-4 bg-rose-950/90 border border-rose-600 text-rose-200 p-3 rounded-xl text-xs flex items-start gap-2.5 z-20 backdrop-blur-xs shadow-xl">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{cameraError}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white font-medium rounded text-[11px] cursor-pointer"
                  >
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 bg-white text-slate-900 font-medium rounded text-[11px] cursor-pointer"
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
          <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 max-h-24 overflow-y-auto">
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

        {/* Viewfinder Controls & Capture Toolbar */}
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

            {/* Central Big Action Button */}
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
              <button
                type="button"
                disabled={isProcessingOcr || (!!detectedResult && !continuousMode)}
                onClick={handleCaptureSnapshot}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
                title="Capture camera photo and extract battery serial number"
              >
                <Camera className="w-4 h-4" />
                <span>Capture & Read Barcode</span>
              </button>
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

          {/* Quick Manual Serial Input Field (Always accessible so staff is never stuck) */}
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={manualSerialInput}
              onChange={(e) => setManualSerialInput(e.target.value)}
              placeholder="Or type/paste serial manually (e.g. BAT-6024-001)..."
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

          {/* Quick Prefix Buttons & Photo File Upload */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500">Quick:</span>
              <button
                type="button"
                onClick={() => handleApplyPrefix(`BAT-${modelCleanPrefix}-`)}
                className="px-1.5 py-0.5 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 rounded cursor-pointer"
              >
                BAT-{modelCleanPrefix}-
              </button>
              <button
                type="button"
                onClick={() => handleApplyPrefix('BAT-')}
                className="px-1.5 py-0.5 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 rounded cursor-pointer"
              >
                BAT-
              </button>
            </div>

            <div className="flex items-center gap-1.5">
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
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded cursor-pointer font-medium text-[11px]"
              >
                <Upload className="w-3 h-3 text-blue-400" />
                <span>Upload Battery Photo</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
