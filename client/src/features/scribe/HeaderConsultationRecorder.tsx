import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { getTranscribeWebSocketUrl, transcribeAudio } from '../../services/api';

export interface HeaderConsultationRecorderProps {
  onLiveTranscriptUpdate: (transcript: string) => void;
  onLiveStopped: (transcript: string) => void;
  onError?: (message: string) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';

export const HeaderConsultationRecorder: React.FC<HeaderConsultationRecorderProps> = ({
  onLiveTranscriptUpdate,
  onLiveStopped,
  onError,
}) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isLive, setIsLive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string>('audio/webm');
  const transcriptRef = useRef<string>('');
  const timerRef = useRef<number | null>(null);

  const stopAudioVisualization = () => {};

  const startAudioVisualization = (_stream: MediaStream) => {
    /* Level meter removed — minimal header UI */
  };

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    const startedAt = performance.now() - elapsedMs;
    timerRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt);
    }, 500);
  };

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send('end');
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    stopAudioVisualization();
    stopTimer();
    setConnectionState('idle');
    setIsPaused(false);
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const runFallbackTranscription = useCallback(async (): Promise<string> => {
    if (!chunksRef.current.length) return '';
    try {
      const blob = new Blob(chunksRef.current, {
        type: recordingMimeTypeRef.current || 'audio/webm',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          try {
            const result = reader.result as string;
            const encoded = result.split(',')[1] || '';
            resolve(encoded);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read recording.'));
        reader.readAsDataURL(blob);
      });

      if (!base64) return '';

      const transcript = await transcribeAudio(
        base64,
        recordingMimeTypeRef.current || 'audio/webm'
      );
      return transcript?.trim() || '';
    } catch (err) {
      console.error('[HeaderConsultationRecorder] Fallback transcription failed:', err);
      onError?.(
        'Live transcription was unavailable and the backup transcription also failed. Please try again.'
      );
      return '';
    }
  }, [onError]);

  const stopLive = useCallback(async () => {
    const streamedText = transcriptRef.current.trim();
    cleanup();
    setIsLive(false);

    let finalText = streamedText;
    if (!finalText && chunksRef.current.length > 0) {
      finalText = await runFallbackTranscription();
    }

    if (finalText) {
      onLiveStopped(finalText);
    }
  }, [cleanup, onLiveStopped, runFallbackTranscription]);

  const startLive = useCallback(async () => {
    if (isLive || connectionState === 'connecting') return;
    transcriptRef.current = '';
    chunksRef.current = [];
    setElapsedMs(0);
    setConnectionState('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startAudioVisualization(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';
      recordingMimeTypeRef.current = mimeType;

      const wsUrl = getTranscribeWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setConnectionState('open');
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
            // Use ref to avoid stale closure issues; this makes pause actually stop transcription.
            if (ws.readyState === WebSocket.OPEN && !isPausedRef.current) {
              ws.send(e.data);
            }
          }
        };
        // 100ms timeslices: audio reaches Deepgram faster (Deepgram recommends ~20–100ms chunks for low latency).
        mediaRecorder.start(100);
        setIsLive(true);
        setIsPaused(false);
        startTimer();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; transcript?: string; message?: string };
          if (msg.type === 'transcript' && typeof msg.transcript === 'string' && msg.transcript.trim()) {
            const prev = transcriptRef.current;
            const sep = prev ? (prev.endsWith(' ') || msg.transcript.startsWith(' ') ? '' : ' ') : '';
            transcriptRef.current = prev + sep + msg.transcript.trim();
            onLiveTranscriptUpdate(transcriptRef.current);
          }
          if (msg.type === 'error') {
            console.error('[HeaderConsultationRecorder] WebSocket error message from server:', msg.message);
            onError?.(msg.message || 'Live transcription error');
          }
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        setConnectionState('closed');
        void stopLive();
      };

      ws.onerror = () => {
        onError?.('WebSocket connection failed. Check that the server is running and DEEPGRAM_API_KEY is set.');
      };
    } catch (err) {
      setConnectionState('idle');
      onError?.(
        err instanceof Error ? err.message : 'Could not access microphone. Please check your browser permissions.'
      );
    }
  }, [connectionState, isLive, onLiveTranscriptUpdate, onError, stopLive]);

  const togglePause = () => {
    if (!isLive || connectionState !== 'open') return;
    // Pause should stop chunk generation + prevent further transcription updates.
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      stopTimer();
      setIsPaused(true);
      return;
    }
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      startTimer();
      setIsPaused(false);
      return;
    }

    // Fallback: if recorder state is unexpected, just flip UI state.
    setIsPaused((prev) => !prev);
  };

  useEffect(() => {
    isPausedRef.current = isPaused;

    // Keep WS sending gated via ref even with stale closures.
    // If MediaRecorder is present (browser support permitting), ensure its state matches UI.
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (isPaused && recorder.state === 'recording') {
      recorder.pause();
      stopTimer();
    } else if (!isPaused && recorder.state === 'paused') {
      recorder.resume();
      startTimer();
    }
  }, [isPaused]);

  const isBusy = connectionState === 'connecting';
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const displayTime = `${minutes.toString().padStart(2, '0')}:${(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

  return (
    <div className="max-md:hidden flex items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        {isLive && (
          <button
            type="button"
            onClick={togglePause}
            className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-red-100/80 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-red-50/80 transition"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" /> Pause
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={isLive ? () => void stopLive() : () => void startLive()}
          disabled={isBusy}
          className={`inline-flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-halo-soft)] transition-all ${
            isLive
              ? 'bg-rose-500/95 hover:bg-rose-500 text-white'
              : 'bg-halo-primary hover:bg-halo-primary-hover text-white'
          } ${isBusy ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          <Mic className={`h-4 w-4 shrink-0 ${isLive ? 'text-white' : 'text-white'}`} />
          <span className="tabular-nums">
            {isBusy ? '…' : isLive ? displayTime : 'Record'}
          </span>
        </button>
      </div>
    </div>
  );
};

