# @halo/telemetry-discovery-js

Drop-in HALO telemetry SDK for Node apps. Auto-captures HTTP, provider SDKs, Postgres, queues, and more — with non-blocking batching so your app stays fast.

**Full integration guide:** [docs/integration.md](../../docs/integration.md)

## Install

```bash
npm install @halo/telemetry-discovery-js
```

## Quick start

```js
import express from "express";
import { initTelemetryDiscovery } from "@halo/telemetry-discovery-js";

const telemetry = initTelemetryDiscovery({
  appName: "halo-genesis",
  endpoint: process.env.HALO_TELEMETRY_URL,
  token: process.env.HALO_TELEMETRY_TOKEN
});

const app = express();
app.use(express.json());
app.use(telemetry.createExpressMiddleware({ includeBodies: true, maxBodyBytes: 256 * 1024 }));
```

Set env vars:

```bash
HALO_TELEMETRY_URL=https://telemetry.halomedical.ai
HALO_TELEMETRY_TOKEN=<your-practice-token>
```

## Activity events (unit economics)

```js
telemetry.trackNoteGenerated();
telemetry.trackTranscriptionProcessed(2.5);
telemetry.trackMessageSent({ billable: true });
```

## Verify connectivity

```bash
npx halo-telemetry-verify --endpoint "$HALO_TELEMETRY_URL" --token "$HALO_TELEMETRY_TOKEN"
```

## Auto-capture (enabled by default)

- Inbound HTTP via Express middleware
- Outbound `fetch`, Node `http/https`, axios
- Provider SDKs: OpenAI, Gemini, Twilio, Deepgram, Google APIs, AWS SDK, Firebase, and more
- Postgres (`pg`), Bull/BullMQ queues, filesystem, child processes
- Toggle via `instrumentation: { http: true, providers: true, db: true, ... }`

## Performance defaults

| Setting | Default |
|---------|---------|
| `queueMaxEvents` | 10000 |
| `batchSize` | 250 |
| `flushIntervalMs` | 500 |
| `requestTimeoutMs` | 400 |

Drop-on-overload when queue is full — app speed first.
