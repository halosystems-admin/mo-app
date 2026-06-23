const DEFAULT_INSTRUMENTATION = {
  http: true,
  providers: true,
  db: true,
  queue: true,
  auth: true,
  filesystem: true,
  process: true,
  runtimeMetrics: false
};

export function resolveConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("initTelemetryDiscovery requires a config object");
  }

  const appName = nonEmptyString(config.appName);
  const endpoint = nonEmptyString(config.endpoint);
  const token = nonEmptyString(config.token);

  const performance = {
    queueMaxEvents: numberOrDefault(config.queueMaxEvents, 10000),
    batchSize: numberOrDefault(config.batchSize, 250),
    flushIntervalMs: numberOrDefault(config.flushIntervalMs, 500),
    requestTimeoutMs: numberOrDefault(config.requestTimeoutMs, 15000),
    maxConcurrentFlushes: numberOrDefault(config.maxConcurrentFlushes, 2),
    maxPayloadBytes: numberOrDefault(config.maxPayloadBytes, 1024 * 1024),
    sampleSuccessRate: numberOrDefault(config.sampleSuccessRate, 1),
    runtimeMetricsIntervalMs: numberOrDefault(config.runtimeMetricsIntervalMs, 0)
  };

  const instrumentation = resolveInstrumentationConfig(config.instrumentation);

  return {
    appName,
    endpoint: endpoint.replace(/\/+$/, ""),
    token,
    performance,
    instrumentation
  };
}

export function resolveInstrumentationConfig(value) {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_INSTRUMENTATION };
  }

  return {
    http: booleanOrDefault(value.http, DEFAULT_INSTRUMENTATION.http),
    providers: booleanOrDefault(value.providers, DEFAULT_INSTRUMENTATION.providers),
    db: booleanOrDefault(value.db, DEFAULT_INSTRUMENTATION.db),
    queue: booleanOrDefault(value.queue, DEFAULT_INSTRUMENTATION.queue),
    auth: booleanOrDefault(value.auth, DEFAULT_INSTRUMENTATION.auth),
    filesystem: booleanOrDefault(value.filesystem, DEFAULT_INSTRUMENTATION.filesystem),
    process: booleanOrDefault(value.process, DEFAULT_INSTRUMENTATION.process),
    runtimeMetrics: booleanOrDefault(value.runtimeMetrics, DEFAULT_INSTRUMENTATION.runtimeMetrics)
  };
}

export function nonEmptyString(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing required non-empty string config value");
  }
  return value.trim();
}

export function numberOrDefault(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function booleanOrDefault(value, fallback) {
  if (typeof value !== "boolean") {
    return fallback;
  }
  return value;
}
