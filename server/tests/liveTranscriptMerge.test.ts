import assert from 'assert';
import {
  applyLiveTranscriptChunk,
  createLiveTranscriptState,
  flushLiveTranscriptState,
  pickBestTranscript,
} from '../../shared/liveTranscriptMerge';

function run() {
  let state = createLiveTranscriptState();

  // Interim results replace — never accumulate.
  let r = applyLiveTranscriptChunk(state, 'Mrs Davis is a', false, false);
  state = r.state;
  assert.strictEqual(r.display, 'Mrs Davis is a');

  r = applyLiveTranscriptChunk(state, 'Mrs Davis is a 66 year old lady', false, false);
  state = r.state;
  assert.strictEqual(r.display, 'Mrs Davis is a 66 year old lady');

  // Cumulative finals supersede within the same utterance.
  r = applyLiveTranscriptChunk(state, 'Mrs Davis is a 66 year old lady known with', true, false);
  state = r.state;
  assert.strictEqual(r.display, 'Mrs Davis is a 66 year old lady known with');

  r = applyLiveTranscriptChunk(
    state,
    'Mrs Davis is a 66 year old lady known with metastatic colon cancer',
    true,
    true
  );
  state = r.state;
  assert.strictEqual(
    r.display,
    'Mrs Davis is a 66 year old lady known with metastatic colon cancer'
  );

  // Next utterance commits after speech_final.
  r = applyLiveTranscriptChunk(state, 'She presents with', false, false);
  state = r.state;
  assert.ok(r.display.includes('metastatic colon cancer'));
  assert.ok(r.display.endsWith('She presents with'));

  r = applyLiveTranscriptChunk(state, 'She presents with a recurrent abscess', true, true);
  state = r.state;
  assert.strictEqual(
    r.display,
    'Mrs Davis is a 66 year old lady known with metastatic colon cancer She presents with a recurrent abscess'
  );

  // Naive-append simulation would duplicate — merge must not.
  state = createLiveTranscriptState();
  const chunks = [
    'renal abscesses that have been drained',
    'renal abscesses that have been drained as well as',
    'renal abscesses that have been drained as well as a diverting ileostomy',
  ];
  for (const chunk of chunks) {
    r = applyLiveTranscriptChunk(state, chunk, false, false);
    state = r.state;
  }
  assert.strictEqual(
    r.display,
    'renal abscesses that have been drained as well as a diverting ileostomy'
  );

  // Deepgram revision with same opening words (surgical dictation duplication case).
  state = createLiveTranscriptState();
  r = applyLiveTranscriptChunk(state, 'Nemopyridipine in grade through a', true, false);
  state = r.state;
  r = applyLiveTranscriptChunk(state, 'Nemopyridipine in through a open Hasson port', true, false);
  state = r.state;
  assert.strictEqual(r.display, 'Nemopyridipine in through a open Hasson port');

  state = createLiveTranscriptState();
  r = applyLiveTranscriptChunk(
    state,
    'Laparoscopic cholecystectomy performed with intra',
    true,
    false
  );
  state = r.state;
  r = applyLiveTranscriptChunk(
    state,
    'Laparoscopic cholecystectomy performed with intraoperative cholangiogram',
    true,
    true
  );
  state = r.state;
  assert.strictEqual(
    r.display,
    'Laparoscopic cholecystectomy performed with intraoperative cholangiogram'
  );

  // Flush on stop captures in-progress utterance.
  state = createLiveTranscriptState();
  r = applyLiveTranscriptChunk(state, 'First sentence', true, true);
  state = r.state;
  r = applyLiveTranscriptChunk(state, 'Second sentence in progress', false, false);
  const flushed = flushLiveTranscriptState(r.state);
  assert.strictEqual(
    flushed.display,
    'First sentence Second sentence in progress'
  );

  assert.strictEqual(
    pickBestTranscript(['short live', 'much longer batch transcript from full recording']),
    'much longer batch transcript from full recording'
  );

  console.log('liveTranscriptMerge.test.ts: all assertions passed');
}

run();
