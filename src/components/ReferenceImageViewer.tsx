import React, { useState } from 'react';
import { Image as ImageIcon, Eye, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ReferenceImageViewerProps {
  imagePath?: string;
}

export const ReferenceImageViewer: React.FC<ReferenceImageViewerProps> = ({
  imagePath = '/assets/aistudio/WhatsApp_Image_2026-10-31_at_10.47.20_AM_23659019.jpeg',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
        title="Compare with original spreadsheet photo"
      >
        <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
        <span>View Reference Photo</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 text-white shrink-0">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-bold">Original Excel Photo Reference</span>
                <span className="text-xs text-slate-400">(Date: 27-10-2026)</span>
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
                  src={imagePath}
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
