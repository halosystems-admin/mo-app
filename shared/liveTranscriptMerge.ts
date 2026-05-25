/**
 * Deepgram live streaming transcript assembly.
 * @see https://developers.deepgram.com/docs/understand-endpointing-interim-results
 *
 * - Interim (is_final=false): replace open segment (cumulative guess for current speech).
 * - Final (is_final=true): accumulate segments within the current utterance.
 * - speech_final=true: flush utterance into committed transcript and start fresh.
 */

function joinParts(parts: string[]): string {
  return parts.filter((p) => p.trim()).join(' ').trim();
}

/** Append or supersede a finalized segment within the current utterance. */
export function appendUtteranceSegment(segments: string[], chunk: string): string[] {
  const c = chunk.trim();
  if (!c) return segments;
  if (segments.length === 0) return [c];

  const joined = joinParts(segments);
  if (c === joined) return segments;
  if (c.startsWith(joined)) return [c];
  if (joined.startsWith(c)) return segments;

  const maxOverlap = Math.min(
    joined.split(/\s+/).length,
    c.split(/\s+/).length
  );
  const joinedWords = joined.split(/\s+/);
  const chunkWords = c.split(/\s+/);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const tail = joinedWords.slice(-overlap).join(' ');
    const head = chunkWords.slice(0, overlap).join(' ');
    if (tail === head) {
      return [joinParts([...joinedWords.slice(0, -overlap), ...chunkWords])];
    }
  }

  return [...segments, c];
}

export type LiveTranscriptState = {
  committed: string;
  utteranceSegments: string[];
  openSegment: string;
};

export function createLiveTranscriptState(): LiveTranscriptState {
  return { committed: '', utteranceSegments: [], openSegment: '' };
}

export function applyLiveTranscriptChunk(
  state: LiveTranscriptState,
  chunk: string,
  isFinal: boolean,
  speechFinal: boolean
): { state: LiveTranscriptState; display: string } {
  const c = chunk.trim();
  let { committed, utteranceSegments, openSegment } = state;

  if (c) {
    if (isFinal) {
      openSegment = '';
      utteranceSegments = appendUtteranceSegment(utteranceSegments, c);
    } else {
      openSegment = c;
    }
  }

  if (speechFinal) {
    const utterance = joinParts([
      ...utteranceSegments,
      ...(openSegment ? [openSegment] : []),
    ]);
    if (utterance) {
      committed = committed ? `${committed} ${utterance}`.trim() : utterance;
    }
    utteranceSegments = [];
    openSegment = '';
  }

  const inProgress = openSegment || joinParts(utteranceSegments);
  const display = [committed, inProgress].filter(Boolean).join(' ').trim();

  return {
    state: { committed, utteranceSegments, openSegment },
    display,
  };
}

/** Flush in-progress utterance when the stream ends (mic stopped). */
export function flushLiveTranscriptState(state: LiveTranscriptState): {
  state: LiveTranscriptState;
  display: string;
} {
  const utterance = joinParts([
    ...state.utteranceSegments,
    ...(state.openSegment ? [state.openSegment] : []),
  ]);
  let committed = state.committed.trim();
  if (utterance) {
    committed = committed ? `${committed} ${utterance}`.trim() : utterance;
  }
  return {
    state: { committed, utteranceSegments: [], openSegment: '' },
    display: committed,
  };
}
