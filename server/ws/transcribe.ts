/**
 * WebSocket server for live transcription.
 * Client sends binary audio chunks; server forwards to Deepgram and sends back transcript JSON.
 */

import type { WebSocket } from 'ws';
import { isDeepgramLiveAvailable, createDeepgramLiveConnection } from '../services/deepgramLive';
import {
  applyLiveTranscriptChunk,
  createLiveTranscriptState,
  flushLiveTranscriptState,
  type LiveTranscriptState,
} from '../../shared/liveTranscriptMerge';

const WS_PATH = '/ws/transcribe';

export function attachTranscribeWebSocket(server: import('http').Server): void {
  const { WebSocketServer } = require('ws') as { WebSocketServer: typeof import('ws').WebSocketServer };
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on('connection', (clientWs: WebSocket) => {
    console.log('[ws/transcribe] Client connected');

    if (!isDeepgramLiveAvailable()) {
      const msg = 'Live transcription is not configured. Set DEEPGRAM_API_KEY.';
      console.warn('[ws/transcribe] Deepgram live not available:', msg);
      clientWs.send(JSON.stringify({ type: 'error', message: msg }));
      clientWs.close();
      return;
    }

    let transcriptState: LiveTranscriptState = createLiveTranscriptState();
    let audioBytes = 0;
    let chunkCount = 0;

    const dg = createDeepgramLiveConnection({
      onOpen: () => {
        console.log('[ws/transcribe] Deepgram live connection open');
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({ type: 'open' }));
        }
      },
      onTranscript: (result) => {
        if (result?.transcript) {
          const merged = applyLiveTranscriptChunk(
            transcriptState,
            result.transcript,
            result.isFinal,
            result.speechFinal
          );
          transcriptState = merged.state;
          if (process.env.NODE_ENV !== 'production') {
            console.log('[ws/transcribe] transcript chunk:', {
              textPreview: result.transcript.trim().slice(0, 80),
              isFinal: result.isFinal,
              displayLength: merged.display.length,
            });
          }
        }
        if (clientWs.readyState === 1) {
          clientWs.send(
            JSON.stringify({
              type: 'transcript',
              transcript: result.transcript,
              isFinal: result.isFinal,
              speechFinal: result.speechFinal,
            })
          );
        }
      },
      onClose: () => {
        const flushed = flushLiveTranscriptState(transcriptState);
        const fullTranscript = flushed.display.trim();
        console.log(
          '[ws/transcribe] Deepgram stream closed',
          fullTranscript
            ? { finalLength: fullTranscript.length, audioBytes, chunkCount }
            : { message: 'no transcript', audioBytes, chunkCount }
        );
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({ type: 'done', transcript: fullTranscript }));
          clientWs.send(JSON.stringify({ type: 'close' }));
        }
      },
      onError: (err) => {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Deepgram error';
        console.error('[ws/transcribe] Deepgram error:', message);
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({ type: 'error', message }));
        }
      },
    });

    clientWs.on('message', (data: Buffer | ArrayBuffer | string) => {
      let isEndSignal = false;
      if (typeof data === 'string') {
        const text = data;
        if (text.trim().toLowerCase() === 'end') {
          isEndSignal = true;
        }
      } else if (Buffer.isBuffer(data)) {
        audioBytes += data.byteLength;
        chunkCount += 1;
        if (chunkCount % 20 === 0) {
          console.log('[ws/transcribe] received audio chunk', {
            chunkCount,
            audioBytes,
          });
        }
      } else if (data instanceof ArrayBuffer) {
        audioBytes += data.byteLength;
        chunkCount += 1;
      }

      if (isEndSignal) {
        console.log('[ws/transcribe] received client end signal');
        dg.requestClose();
        return;
      }

      if (clientWs.readyState !== 1) return;
      if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
        dg.send(data);
      }
    });

    const onClose = () => {
      dg.requestClose();
      dg.disconnect();
    };

    clientWs.on('close', () => {
      console.log('[ws/transcribe] Client connection closed');
      onClose();
    });
    clientWs.on('error', (err) => {
      console.error('[ws/transcribe] Client socket error:', err);
      onClose();
    });
  });
}
