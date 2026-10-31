import React, { useState } from 'react';
import { Image as ImageIcon, Eye, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ReferenceImageViewerProps {
  imagePath?: string;
}

export const ReferenceImageViewer: React.FC<ReferenceImageViewerProps> = ({
  imagePath = '/assets/aistudio/image_99e1f4ad.png',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<string>(imagePath);
  const [zoom, setZoom] = useState(1);

  const referencePhotos = [
    {
      id: 'clear',
      label: 'Clear Header Snap (Reference)',
      path: '/assets/aistudio/image_99e1f4ad.png',
      badge: 'Visual Design Ref',
    },
    {
      id: 'baseline',
      label: 'Official Baseline (31-10-2026)',
      path: '/assets/aistudio/image_854e73a7.png',
      badge: 'Official Baseline',
    },
    {
      id: 'prev',
      label: 'Photo (27-10-2026)',
      path: '/assets/aistudio/WhatsApp_Image_2026-10-31_at_10.47.20_AM_23659019.jpeg',
      badge: 'Historical',
    },
  ];

  return (
    <>
      <button
        onClick={() => {
          setActivePhoto(imagePath);
          setIsOpen(true);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
        title="Compare with official Excel photo reference"
      >
        <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
        <span>View Excel Reference Snaps</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-blue-400" />
                  <span className="text-sm font-bold">Excel Photo References</span>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-lg border border-slate-700">
                  {referencePhotos.map((photo) => (
                    <button
                      key={photo.id}
                      onClick={() => {
                        setActivePhoto(photo.path);
                        setZoom(1);
                      }}
                      className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                        activePhoto === photo.path
                          ? 'bg-blue-600 text-white shadow-xs font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-slate-700'
                      }`}
                    >
                      {photo.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                  className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <div className="h-4 w-px bg-slate-700 mx-1"></div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Image Viewport */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950">
              <div
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                className="transition-transform duration-150"
              >
                <img
                  src={activePhoto}
                  alt="Original Battery Excel Register"
                  className="max-w-full h-auto rounded border border-slate-800 shadow-2xl"
                />
              </div>
            </div>

            {/* Footer with note */}
            <div className="px-6 py-2.5 bg-slate-900 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>
                Exact structure reproduced: 9 standard models + Total + Repair + Service columns.
              </span>
              <span className="font-mono text-slate-500">Zoom: {Math.round(zoom * 100)}%</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
