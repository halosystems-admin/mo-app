import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Pause, Play } from 'lucide-react';
import { getTranscribeWebSocketUrl, transcribeAudio } from '../../services/api';
import {
  getConsultationRecorderUiState,
  setConsultationRecorderUiState,
} from './consultationRecorderStore';
import {
  applyLiveTranscriptChunk,
  createLiveTranscriptState,
  flushLiveTranscriptState,
  pickBestTranscript,
  type LiveTranscriptState,
} from '../../../../shared/liveTranscriptMerge';
import { setLastRecordingTranscriptionRetry } from './consultationRecordingRetry';

export interface HeaderConsultationRecorderProps {
  onLiveTranscriptUpdate: (transcript: string) => void;
  onLiveStopping?: () => void;
  onLiveStopped: (transcript: string) => void;
  onTranscriptRefining?: (refining: boolean) => void;
  onError?: (message: string) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';

const WS_DRAIN_TIMEOUT_MS = 8000;
const WS_DRAIN_TAIL_MS = 300;

function waitForTranscriptDrain(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CLOSING) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimeout);
      if (tailTimeout !== undefined) window.clearTimeout(tailTimeout);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      resolve();
    };

    const hardTimeout = window.setTimeout(finish, timeoutMs);
    let tailTimeout: number | undefined;

    const onClose = () => finish();

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string };
        if (msg.type === 'done' || msg.type === 'close') {
          if (tailTimeout !== undefined) window.clearTimeout(tailTimeout);
          tailTimeout = window.setTimeout(finish, WS_DRAIN_TAIL_MS);
        }
      } catch {
        // ignore
      }
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);

    try {
      ws.send('end');
    } catch {
      finish();
    }
  });
}

export const HeaderConsultationRecorder: React.FC<HeaderConsultationRecorderProps> = ({
  onLiveTranscriptUpdate,
  onLiveStopping,
  onLiveStopped,
  onTranscriptRefining,
  onError,
}) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isLive, setIsLive] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string>('audio/webm');
  const transcriptRef = useRef<string>('');
  const transcriptStateRef = useRef<LiveTranscriptState>(createLiveTranscriptState());
  const serverTranscriptRef = useRef<string>('');
  const timerRef = useRef<number | null>(null);
  /** Prevents stopLive from running twice (user Done + ws.onclose). */
  const isStoppingRef = useRef(false);
  const isLiveRef = useRef(false);

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

  const processTranscriptMessage = useCallback(
    (msg: {
      type?: string;
      transcript?: string;
      message?: string;
      isFinal?: boolean;
      speechFinal?: boolean;
    }) => {
      if (msg.type === 'done' && typeof msg.transcript === 'string' && msg.transcript.trim()) {
        serverTranscriptRef.current = msg.transcript.trim();
        return;
      }

      if (msg.type === 'transcript' && typeof msg.transcript === 'string' && msg.transcript.trim()) {
        const merged = applyLiveTranscriptChunk(
          transcriptStateRef.current,
          msg.transcript,
          msg.isFinal === true,
          msg.speechFinal === true
        );
        transcriptStateRef.current = merged.state;
        transcriptRef.current = merged.display;
        if (merged.display) onLiveTranscriptUpdate(merged.display);
      }

      if (msg.type === 'error') {
        console.error('[HeaderConsultationRecorder] WebSocket error message from server:', msg.message);
        onError?.(msg.message || 'Live transcription error');
      }
    },
    [onError, onLiveTranscriptUpdate]
  );

  const stopMedia = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopAudioVisualization();
    stopTimer();
  }, []);

  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    closeWebSocket();
    stopMedia();
    setConnectionState('idle');
    setIsPaused(false);
    setElapsedMs(0);
  }, [closeWebSocket, stopMedia]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const runFallbackTranscription = useCallback(
    async (audioChunks: Blob[]): Promise<string> => {
      if (!audioChunks.length) return '';
      try {
        const blob = new Blob(audioChunks, {
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
    },
    [onError]
  );

  const stopLive = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    isLiveRef.current = false;

    setIsLive(false);
    setIsPaused(false);
    setIsFinalizing(true);
    onLiveStopping?.();
    onTranscriptRefining?.(true);

    try {
      const recorder = mediaRecorderRef.current;
      const ws = wsRef.current;

      if (recorder && recorder.state === 'recording') {
        try {
          recorder.requestData();
        } catch {
          // ignore
        }
      }

      await new Promise<void>((resolve) => {
        if (recorder && recorder.state !== 'inactive') {
          const prevOnStop = recorder.onstop;
          recorder.onstop = (ev) => {
            prevOnStop?.call(recorder, ev);
            resolve();
          };
          recorder.stop();
        } else {
          resolve();
        }
      });

      if (ws?.readyState === WebSocket.OPEN) {
        await waitForTranscriptDrain(ws, WS_DRAIN_TIMEOUT_MS);
      }

      const flushed = flushLiveTranscriptState(transcriptStateRef.current);
      transcriptStateRef.current = flushed.state;
      transcriptRef.current = flushed.display;
      const streamedText = flushed.display.trim();
      const serverText = serverTranscriptRef.current.trim();
      const audioChunks = [...chunksRef.current];

      stopMedia();
      closeWebSocket();
      setConnectionState('idle');

      let batchText = '';
      if (audioChunks.length > 0) {
        setLastRecordingTranscriptionRetry(() => runFallbackTranscription([...audioChunks]));
        batchText = (await runFallbackTranscription(audioChunks)).trim();
      } else {
        setLastRecordingTranscriptionRetry(null);
      }

      const finalText = pickBestTranscript([streamedText, serverText, batchText]);

      if (finalText) {
        onLiveStopped(finalText);
      } else if (audioChunks.length > 0) {
        onError?.('No speech was detected in the recording. Please try again.');
      }
    } finally {
      setIsFinalizing(false);
      isStoppingRef.current = false;
      onTranscriptRefining?.(false);
    }
  }, [
    closeWebSocket,
    onError,
    onLiveStopped,
    onLiveStopping,
    onTranscriptRefining,
    runFallbackTranscription,
    stopMedia,
  ]);

  const startLive = useCallback(async () => {
    const ui = getConsultationRecorderUiState();
    if (ui.isLive || ui.isBusy || ui.isFinalizing || isStoppingRef.current) return;
    isStoppingRef.current = false;
    transcriptRef.current = '';
    transcriptStateRef.current = createLiveTranscriptState();
    serverTranscriptRef.current = '';
    chunksRef.current = [];
    setLastRecordingTranscriptionRetry(null);
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
            if (ws.readyState === WebSocket.OPEN && !isPausedRef.current) {
              ws.send(e.data);
            }
          }
        };
        mediaRecorder.start(100);
        isLiveRef.current = true;
        setIsLive(true);
        setIsPaused(false);
        startTimer();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            transcript?: string;
            message?: string;
            isFinal?: boolean;
            speechFinal?: boolean;
          };
          processTranscriptMessage(msg);
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        setConnectionState('closed');
        if (isLiveRef.current && !isStoppingRef.current) {
          void stopLive();
        }
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
  }, [onError, processTranscriptMessage, stopLive]);

  const startLiveRef = useRef(startLive);
  const stopLiveRef = useRef(stopLive);
  useEffect(() => {
    startLiveRef.current = startLive;
    stopLiveRef.current = stopLive;
  }, [startLive, stopLive]);

  useEffect(() => {
    const onToggle = () => {
      const ui = getConsultationRecorderUiState();
      if (ui.isBusy || ui.isFinalizing) return;
      if (ui.isLive) {
        void stopLiveRef.current();
      } else {
        void startLiveRef.current();
      }
    };
    window.addEventListener('halo:toggle-consultation-dictation', onToggle as EventListener);
    return () => {
      window.removeEventListener('halo:toggle-consultation-dictation', onToggle as EventListener);
    };
  }, []);

  const togglePause = () => {
    if (!isLive || connectionState !== 'open') return;
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

    setIsPaused((prev) => !prev);
  };

  useEffect(() => {
    isPausedRef.current = isPaused;

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

  const isConnecting = connectionState === 'connecting';
  const isBusy = isConnecting || isFinalizing;
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const displayTime = `${minutes.toString().padStart(2, '0')}:${(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

  useEffect(() => {
    setConsultationRecorderUiState({
      isLive,
      isPaused,
      isBusy,
      isFinalizing,
      displayTime,
    });
  }, [isLive, isPaused, isBusy, isFinalizing, displayTime]);

  const handleRecordClick = () => {
    if (isBusy || isFinalizing) return;
    if (isLive) {
      void stopLive();
    } else {
      void startLive();
    }
  };

  useEffect(() => {
    const onTogglePause = () => {
      togglePause();
    };
    window.addEventListener('halo:toggle-consultation-pause', onTogglePause as EventListener);
    return () => {
      window.removeEventListener('halo:toggle-consultation-pause', onTogglePause as EventListener);
    };
  }, [togglePause]);

  return (
    <div className="consultation-recorder-pill relative z-20 flex items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        {isLive && !isFinalizing ? (
          <button
            type="button"
            onClick={togglePause}
            className="halo-touch-min hidden min-h-[44px] items-center gap-1.5 rounded-xl border border-red-100/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-red-50/80 transition md:inline-flex"
          >
            {isPaused ? (
              <>
                <Play className="w-4 h-4" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-4 h-4" /> Pause
              </>
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleRecordClick}
          disabled={isBusy}
          title={
            isFinalizing
              ? 'Finalizing transcript…'
              : isLive
                ? 'Stop recording (Done)'
                : isConnecting
                  ? 'Connecting microphone…'
                  : 'Start recording'
          }
          aria-label={
            isFinalizing
              ? 'Finalizing transcript'
              : isLive
                ? 'Stop recording'
                : 'Start recording'
          }
          className={`halo-touch-min relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold shadow-[var(--shadow-halo-soft)] transition-all select-none ${
            isFinalizing
              ? 'cursor-wait bg-amber-500 text-white'
              : isLive
                ? 'bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.98]'
                : 'bg-halo-primary text-white hover:bg-halo-primary-hover active:scale-[0.98]'
          } ${isBusy ? 'cursor-wait opacity-80' : ''}`}
        >
          {isFinalizing ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              <span>Finalizing…</span>
            </>
          ) : isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              <span className="hidden sm:inline">Connecting…</span>
            </>
          ) : isLive ? (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-white shadow-sm animate-pulse"
                aria-hidden
              />
              <span className="tabular-nums">{displayTime}</span>
              <span>Done</span>
            </>
          ) : (
            <>
              <Mic className="h-4 w-4 shrink-0" aria-hidden />
              <span>Record</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
