import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  Sparkles,
  Upload,
  FlipHorizontal,
  Zap,
  ZapOff,
  RefreshCw,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { apiScanSerialFromPhoto, AiSerialScanResult } from '../services/api';

interface AiSerialCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSerialsDetected: (result: AiSerialScanResult) => void;
  category?: 'battery' | 'charger';
  modelHint?: string;
}

function canvasToFileAndDataUrl(
  canvas: HTMLCanvasElement
): Promise<{ dataUrl: string; mimeType: string; file?: File }> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        const file = blob
          ? new File([blob], 'ai-camera-capture.jpg', { type: 'image/jpeg' })
          : undefined;
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          mimeType: 'image/jpeg',
          file,
        });
      },
      'image/jpeg',
      0.92
    );
  });
}

async function compressImageDataUrl(
  source: HTMLImageElement | HTMLVideoElement,
  naturalWidth: number,
  naturalHeight: number
): Promise<{ dataUrl: string; mimeType: string; file?: File }> {
  const maxDim = 1600;
  let targetW = naturalWidth || 1280;
  let targetH = naturalHeight || 720;

  if (targetW > maxDim || targetH > maxDim) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * maxDim) / targetH);
      targetH = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not prepare image canvas.');
  }
  ctx.drawImage(source, 0, 0, targetW, targetH);
  return await canvasToFileAndDataUrl(canvas);
}

function fileToCompressedDataUrl(file: File): Promise<{ dataUrl: string; mimeType: string; file: File }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read selected photo.'));
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = async () => {
        try {
          const compressed = await compressImageDataUrl(
            img,
            img.naturalWidth || img.width,
            img.naturalHeight || img.height
          );
          resolve({
            dataUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            file: compressed.file || file,
          });
        } catch {
          resolve({ dataUrl: rawUrl, mimeType: file.type || 'image/jpeg', file });
        }
      };
      img.onerror = () => reject(new Error('Unsupported or corrupted photo file.'));
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function tryDecodeBarcodesOnDevice(
  dataUrl: string,
  file?: File,
  decoderElementId = 'ai-serial-barcode-decoder'
): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  const addCode = (val: string) => {
    const clean = val.trim().toUpperCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      found.push(clean);
    }
  };

  // 1. Native browser BarcodeDetector (supports multiple barcodes in a single photo)
  try {
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new () => { detect: (src: HTMLImageElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (BarcodeDetectorCtor) {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = dataUrl;
      });
      const detector = new BarcodeDetectorCtor();
      const detected = await detector.detect(img);
      for (const item of detected) {
        if (item.rawValue) addCode(item.rawValue);
      }
      if (found.length > 0) return found;
    }
  } catch {
    // Fallback to Html5Qrcode file decode
  }

  // 2. Html5Qrcode / ZXing file decoder
  if (file) {
    try {
      const scanner = new Html5Qrcode(decoderElementId, { verbose: false });
      const decoded = await scanner.scanFile(file, false);
      try {
        scanner.clear();
      } catch {
        // ignore clear error
      }
      if (decoded) addCode(decoded);
    } catch {
      // No readable 1D/2D barcode; fall through to Gemini AI OCR for printed text
    }
  }

  return found;
}

export const AiSerialCameraModal: React.FC<AiSerialCameraModalProps> = ({
  isOpen,
  onClose,
  onSerialsDetected,
  category = 'battery',
  modelHint,
}) => {
  const entityCap = category === 'charger' ? 'Charger' : 'Battery';
  const entityLower = category === 'charger' ? 'charger' : 'battery';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraUnavailableMsg, setCameraUnavailableMsg] = useState<string | null>(null);

  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [capturedPhotoPayload, setCapturedPhotoPayload] = useState<{
    dataUrl: string;
    mimeType: string;
    file?: File;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setHasTorch(false);
    setIsTorchOn(false);
  }, []);

  const startCameraStream = useCallback(async () => {
    stopCameraStream();
    setCameraUnavailableMsg(null);
    setErrorMsg(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraUnavailableMsg('Live webcam preview is not supported here. Use Take Photo or Upload Photo below.');
      return;
    }

    setIsStartingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setIsCameraActive(true);
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() || {}) as any;
      setHasTorch(Boolean(caps?.torch));
    } catch (err: any) {
      const msg = String(err?.message || err?.name || '');
      if (/NotAllowedError|Permission/i.test(msg)) {
        setCameraUnavailableMsg('Camera permission was blocked. Use Take Photo or Upload Photo below.');
      } else {
        setCameraUnavailableMsg('No live camera detected. Use Take Photo or Upload Photo below.');
      }
    } finally {
      setIsStartingCamera(false);
    }
  }, [facingMode, stopCameraStream]);

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setCapturedPhotoUrl(null);
      setCapturedPhotoPayload(null);
      setIsAnalyzing(false);
      setErrorMsg(null);
      return;
    }

    setCapturedPhotoUrl(null);
    setCapturedPhotoPayload(null);
    setErrorMsg(null);
    startCameraStream();

    return () => {
      stopCameraStream();
    };
  }, [isOpen, startCameraStream, stopCameraStream]);

  const analyzePhoto = useCallback(
    async (dataUrl: string, mimeType: string, file?: File) => {
      setCapturedPhotoUrl(dataUrl);
      setCapturedPhotoPayload({ dataUrl, mimeType, file });
      setIsAnalyzing(true);
      setErrorMsg(null);
      stopCameraStream();

      try {
        // 1. Fast on-device barcode / QR decode first (works offline without API key)
        const barcodeHits = await tryDecodeBarcodesOnDevice(dataUrl, file);
        if (barcodeHits.length > 0) {
          onSerialsDetected({
            serialNo: barcodeHits.join(', '),
            serialNos: barcodeHits,
            confidence: 'high',
            engine: 'on-device-barcode',
          });
          onClose();
          return;
        }

        // 2. Gemini AI Vision OCR for printed / etched / stamped serial text
        const result = await apiScanSerialFromPhoto({
          imageBase64: dataUrl,
          mimeType,
          category,
          modelHint,
        });

        if (!result.serialNos || result.serialNos.length === 0) {
          setErrorMsg(
            result.rawText
              ? `No serial number found in photo (saw: "${result.rawText.slice(0, 70)}"). Retake a closer, well-lit photo.`
              : 'No serial number was clearly readable in this photo. Retake a closer, well-lit photo.'
          );
          setIsAnalyzing(false);
          return;
        }

        onSerialsDetected(result);
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || 'AI could not read the photo. Please retake or try another photo.');
        setIsAnalyzing(false);
      }
    },
    [category, modelHint, onClose, onSerialsDetected, stopCameraStream]
  );

  const handleCaptureFromLiveVideo = async () => {
    const video = videoRef.current;
    if (!video || !isCameraActive || isAnalyzing) return;

    try {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const { dataUrl, mimeType, file } = await compressImageDataUrl(video, vw, vh);
      await analyzePhoto(dataUrl, mimeType, file);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to capture camera frame.');
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;

    try {
      const { dataUrl, mimeType, file } = await fileToCompressedDataUrl(picked);
      await analyzePhoto(dataUrl, mimeType, file);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not process the selected photo.');
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || isAnalyzing) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const picked = items[i].getAsFile();
          if (picked) {
            e.preventDefault();
            const { dataUrl, mimeType, file } = await fileToCompressedDataUrl(picked);
            await analyzePhoto(dataUrl, mimeType, file);
            return;
          }
        }
      }
    },
    [analyzePhoto, isAnalyzing]
  );

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !hasTorch) return;
    const nextState = !isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextState } as any],
      });
      setIsTorchOn(nextState);
    } catch {
      // ignore unsupported torch toggle
    }
  };

  const handleRetake = () => {
    setCapturedPhotoUrl(null);
    setCapturedPhotoPayload(null);
    setErrorMsg(null);
    setIsAnalyzing(false);
    startCameraStream();
  };

  const handleRetrySamePhoto = () => {
    if (!capturedPhotoPayload || isAnalyzing) return;
    analyzePhoto(
      capturedPhotoPayload.dataUrl,
      capturedPhotoPayload.mimeType,
      capturedPhotoPayload.file
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-xs"
      onPaste={handlePaste}
    >
      <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300">
              <Sparkles className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold leading-tight text-white">
                AI Camera · {entityCap} Serial Reader
              </h3>
              <p className="text-[11px] text-slate-400">
                Snap or upload a photo — AI reads the serial & types it below
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close AI Camera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Hidden inputs & offscreen barcode decoder container */}
        <div id="ai-serial-barcode-decoder" className="hidden" />
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFilePicked}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePicked}
        />

        {/* Viewfinder / Photo Preview Area */}
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-[4/3] flex items-center justify-center">
            {capturedPhotoUrl ? (
              <img
                src={capturedPhotoUrl}
                alt={`Captured ${entityLower} serial label`}
                className="w-full h-full object-contain"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                />

                {isStartingCamera && (
                  <div className="flex flex-col items-center gap-2 text-slate-300 text-xs p-4 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    <span>Starting camera...</span>
                  </div>
                )}

                {!isStartingCamera && !isCameraActive && (
                  <div className="flex flex-col items-center gap-2.5 text-slate-300 text-xs p-6 text-center">
                    <div className="p-3 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-indigo-300">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <p className="font-medium text-slate-200 max-w-xs">
                      {cameraUnavailableMsg || 'Take a photo or choose an image of the serial number label.'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Tip: You can also paste an image with Ctrl+V.
                    </p>
                  </div>
                )}

                {/* Subtle camera framing corners when live */}
                {isCameraActive && (
                  <div className="pointer-events-none absolute inset-4 border border-indigo-400/30 rounded-lg flex items-end justify-center pb-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-950/75 text-[10px] font-semibold text-indigo-200 border border-indigo-400/30">
                      Aim at printed serial, sticker, or barcode
                    </span>
                  </div>
                )}

                {/* Live camera top controls */}
                {isCameraActive && (
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    {hasTorch && (
                      <button
                        type="button"
                        onClick={handleToggleTorch}
                        className="p-2 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-slate-700 transition-colors cursor-pointer"
                        title={isTorchOn ? 'Turn Flash Off' : 'Turn Flash On'}
                      >
                        {isTorchOn ? <ZapOff className="w-4 h-4 text-amber-300" /> : <Zap className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                      className="p-2 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-slate-700 transition-colors cursor-pointer"
                      title="Switch Camera"
                    >
                      <FlipHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}

            {/* AI Analyzing Overlay */}
            {isAnalyzing && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2.5 p-4 text-center">
                <div className="relative">
                  <div className="w-11 h-11 rounded-full bg-indigo-600/30 border border-indigo-400 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-indigo-300 animate-pulse" />
                  </div>
                </div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                  <span>AI reading serial number from photo...</span>
                </div>
              </div>
            )}
          </div>

          {/* Error Feedback */}
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            {capturedPhotoUrl && !isAnalyzing ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleRetrySamePhoto}
                  className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Retry AI Read</span>
                </button>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retake Photo</span>
                </button>
              </div>
            ) : isCameraActive ? (
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleCaptureFromLiveVideo}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md ring-2 ring-indigo-400/30"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Photo & Read Serial</span>
              </button>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => nativeCameraInputRef.current?.click()}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-100 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-indigo-300" />
                <span>Take Photo</span>
              </button>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => galleryInputRef.current?.click()}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-100 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-300" />
                <span>Upload Photo</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
