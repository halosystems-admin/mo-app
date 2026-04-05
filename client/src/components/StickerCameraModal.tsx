import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
};

export const StickerCameraModal: React.FC<Props> = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setReady(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Camera unavailable');
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, stopStream]);

  const snap = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `sticker_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopStream();
        onCapture(file);
        onClose();
      },
      'image/jpeg',
      0.92
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Camera className="w-4 h-4 text-violet-600" />
            Capture sticker
          </h3>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : (
            <video ref={videoRef} className="w-full rounded-xl bg-black aspect-[4/3] object-cover" playsInline muted />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready || !!error}
              onClick={snap}
              className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold text-sm disabled:opacity-50"
            >
              Capture &amp; use
            </button>
            <button
              type="button"
              onClick={() => {
                stopStream();
                onClose();
              }}
              className="px-4 py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-500">Allow camera access. Position the sticker in frame, then capture.</p>
        </div>
      </div>
    </div>
  );
};
