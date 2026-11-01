import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  FlipHorizontal,
  Zap,
  ZapOff,
  Upload,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Barcode as BarcodeIcon,
  RefreshCw,
  Plus,
} from 'lucide-react';
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
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1900, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [isProcessingOcr, setIsProcessingOcr] = useState<boolean>(false);
  const [detectedResult, setDetectedResult] = useState<{
    serialNo: string;
    model?: string;
    batchNo?: string;
    source: 'barcode' | 'ai_ocr';
  } | null>(null);

  const [barcodeDetectorSupported, setBarcodeDetectorSupported] = useState<boolean>(false);
  const [barcodeDetector, setBarcodeDetector] = useState<any>(null);

  // Initialize BarcodeDetector API if available in browser
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const formats = [
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
        ];
        const detector = new (window as any).BarcodeDetector({ formats });
        setBarcodeDetector(detector);
        setBarcodeDetectorSupported(true);
      } catch {
        setBarcodeDetectorSupported(false);
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
    setDetectedResult(null);

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
          width: { ideal: 1280 },
          height: { ideal: 720 },
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
        msg = 'No camera found on this device. You can still upload a photo.';
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
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  // Continuous frame scanning loop with native BarcodeDetector
  useEffect(() => {
    if (!isOpen || !isScanning || !barcodeDetector || !videoRef.current || detectedResult) {
      return;
    }

    let animationFrameId: number;
    let isActive = true;

    const scanFrame = async () => {
      if (!isActive || !videoRef.current || videoRef.current.readyState < 2) {
        animationFrameId = requestAnimationFrame(scanFrame);
        return;
      }

      try {
        const barcodes = await barcodeDetector.detect(videoRef.current);
        if (barcodes && barcodes.length > 0) {
          const rawVal = barcodes[0].rawValue?.trim();
          if (rawVal) {
            handleBarcodeFound(rawVal, 'barcode');
            return;
          }
        }
      } catch {
        // frame detect glitch ignored
      }

      if (isActive) {
        animationFrameId = requestAnimationFrame(scanFrame);
      }
    };

    animationFrameId = requestAnimationFrame(scanFrame);

    return () => {
      isActive = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [isOpen, isScanning, barcodeDetector, detectedResult]);

  // Handle successful detection
  const handleBarcodeFound = (serial: string, source: 'barcode' | 'ai_ocr', extraModel?: string, extraBatch?: string) => {
    playBeepSound();
    if (navigator.vibrate) {
      try {
        navigator.vibrate([80, 40, 80]);
      } catch {
        // ignore
      }
    }
    setIsScanning(false);
    setDetectedResult({
      serialNo: serial,
      model: extraModel,
      batchNo: extraBatch,
      source,
    });
  };

  // Capture canvas image from current video stream
  const captureCurrentFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // Process image with Server / Gemini OCR
  const processImageWithOcr = async (base64Image: string) => {
    setIsProcessingOcr(true);
    setCameraError(null);

    // 1. Try BarcodeDetector on canvas snapshot first
    if (barcodeDetector && canvasRef.current) {
      try {
        const barcodes = await barcodeDetector.detect(canvasRef.current);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          handleBarcodeFound(barcodes[0].rawValue.trim(), 'barcode');
          setIsProcessingOcr(false);
          return;
        }
      } catch {
        // continue to AI OCR
      }
    }

    // 2. Call backend /api/scan-barcode-ocr
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

      // If no serial found automatically, offer manual serial entry
      setCameraError('Could not clearly detect a barcode or serial number in this photo. Please hold closer with good lighting, or type the serial number.');
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
        // Load into canvas to test
        const img = new Image();
        img.onload = () => {
          if (canvasRef.current) {
            canvasRef.current.width = img.width;
            canvasRef.current.height = img.height;
            const ctx = canvasRef.current.getContext('2d');
            ctx?.drawImage(img, 0, 0);
          }
          processImageWithOcr(dataUrl);
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  // Confirm result and pass back to parent
  const handleConfirmResult = () => {
    if (detectedResult) {
      onScanComplete(detectedResult.serialNo, detectedResult.batchNo || detectedResult.model);
      onClose();
    }
  };

  // Reset and scan next
  const handleScanAgain = () => {
    setDetectedResult(null);
    setIsScanning(true);
    setCameraError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-slate-850 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                <span>Scan Battery Barcode</span>
                {barcodeDetectorSupported && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded font-normal">
                    Live Auto-Scan
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                Point camera at barcode or battery serial sticker
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative flex-1 bg-black min-h-[260px] sm:min-h-[320px] flex items-center justify-center overflow-hidden">
          {/* Hidden Canvas for Snapshots */}
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
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
              {/* Laser Target Box */}
              <div className="relative w-64 h-36 sm:w-72 sm:h-40 border-2 border-dashed border-blue-400/80 rounded-xl flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                {/* Corner markers */}
                <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-blue-400 rounded-tl"></span>
                <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-blue-400 rounded-tr"></span>
                <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-blue-400 rounded-bl"></span>
                <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-blue-400 rounded-br"></span>

                {/* Animated Red Laser Scan Line */}
                <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_8px_#f43f5e] animate-pulse"></div>

                <div className="absolute bottom-2 text-[10px] text-slate-200 bg-slate-950/80 px-2 py-0.5 rounded backdrop-blur-xs font-mono">
                  Align Barcode / Serial Here
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-300 font-medium bg-black/60 px-3 py-1 rounded-full backdrop-blur-xs text-center">
                Auto-reading 1D/2D barcodes & QR labels
              </p>
            </div>
          )}

          {/* Processing Spinner Overlay */}
          {isProcessingOcr && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-3" />
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Processing Battery Label Photo...</span>
              </div>
              <p className="text-xs text-slate-400 text-center mt-1">
                Extracting serial number and battery specifications
              </p>
            </div>
          )}

          {/* Success Result Overlay */}
          {detectedResult && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-5 z-20">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mb-3">
                <CheckCircle className="w-7 h-7" />
              </div>
              <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">
                {detectedResult.source === 'barcode' ? 'Barcode Detected!' : 'Serial Extracted!'}
              </span>

              {/* Detected Serial Display */}
              <div className="my-3 px-4 py-2.5 bg-slate-900 border-2 border-emerald-500 rounded-xl text-center shadow-lg w-full max-w-xs">
                <div className="text-[10px] uppercase font-mono text-slate-400">Battery Serial Number</div>
                <div className="text-lg sm:text-xl font-mono font-black text-white tracking-wider break-all">
                  {detectedResult.serialNo}
                </div>
                {detectedResult.model && (
                  <div className="mt-1 text-xs text-emerald-300 font-medium">
                    Model: {detectedResult.model}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 w-full max-w-xs mt-2">
                <button
                  type="button"
                  onClick={handleScanAgain}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Retake / Rescan
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResult}
                  className="flex-1 py-2 px-3 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Use Serial</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Error / Permission Banner */}
          {cameraError && !detectedResult && (
            <div className="absolute inset-x-4 top-4 bg-rose-950/90 border border-rose-600 text-rose-200 p-3 rounded-xl text-xs flex items-start gap-2.5 z-20 backdrop-blur-xs">
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

        {/* Viewfinder Controls & Capture Toolbar */}
        <div className="p-3.5 bg-slate-850 border-t border-slate-800 flex flex-col gap-3">
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

            {/* Central Big Capture Button */}
            <button
              type="button"
              disabled={isProcessingOcr || !!detectedResult}
              onClick={handleCaptureSnapshot}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
              title="Capture camera photo and extract battery serial number"
            >
              <Camera className="w-4 h-4" />
              <span>Capture & Read Serial</span>
            </button>

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

          {/* Photo File Upload Option (for gallery images or fallback) */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
            <span>Or upload an existing battery photo:</span>
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
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded cursor-pointer font-medium"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Choose Photo / File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
