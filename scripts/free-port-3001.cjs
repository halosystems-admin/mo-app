/**
 * Dev helper: prevent nodemon crash-loop on EADDRINUSE for port 3001.
 * Kills the process currently listening on :3001 if it exists.
 *
 * This is intentionally best-effort and only runs in `npm run dev:server`.
 */
const { execSync } = require('node:child_process');

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch {
    return '';
  }
}

function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {} // ok: dev-only tiny waits
}

// macOS/Linux: lsof is available.
const getPids = () => {
  const out = tryExec('lsof -t -iTCP:3001 -sTCP:LISTEN || true');
  if (!out) return [];
  return Array.from(new Set(out.split(/\s+/).map((s) => s.trim()).filter(Boolean)));
};

// Also stop stale HALO dev servers by command line (covers edge cases where lsof misses briefly).
tryExec('pkill -f "ts-node server/index.ts" || true');
tryExec('pkill -f "nodemon.*server/index.ts" || true');

// Best-effort: kill any listeners, then wait briefly for the port to clear.
let pids = getPids();
if (pids.length) {
  // eslint-disable-next-line no-console
  console.log(`[dev] Port 3001 in use by PID(s) ${pids.join(', ')} — stopping them.`);
  for (const pid of pids) tryExec(`kill ${pid}`);
  // Give the OS a moment to release the port.
  sleep(250);
  pids = getPids();
  if (pids.length) {
    // eslint-disable-next-line no-console
    console.log(`[dev] Port 3001 still busy — forcing stop of PID(s) ${pids.join(', ')}.`);
    for (const pid of pids) tryExec(`kill -9 ${pid}`);
    sleep(250);
  }
}

// Final guard: block briefly until the port is actually free (prevents nodemon crash-loop).
const deadline = Date.now() + 6000;
while (Date.now() < deadline) {
  const still = getPids();
  if (!still.length) process.exit(0);
  // eslint-disable-next-line no-console
  console.log(`[dev] Waiting for port 3001 to free (PID(s) ${still.join(', ')})...`);
  for (const pid of still) tryExec(`kill ${pid}`);
  sleep(300);
}

// eslint-disable-next-line no-console
console.log('[dev] Port 3001 still busy after waiting. Please stop the running process manually.');
process.exit(0);

