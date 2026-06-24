import {
  createExpressTelemetryMiddleware,
  patchAuthStack,
  patchAwsSdkV3,
  patchAxios,
  patchBigQuery,
  patchBullAndBullMq,
  patchChildProcess,
  patchDeepgram,
  patchDynamoDbDocumentClients,
  patchFirebaseAdmin,
  patchFsPromises,
  patchGlobalFetch,
  patchGoogleApis,
  patchGoogleCloudStorage,
  patchHttpModules,
  patchNodemailer,
  patchPostgres,
  patchProcessErrors,
  patchProviderClients,
  startRuntimeMetrics
} from "./patches.js";

export { createExpressTelemetryMiddleware };

export function applyInstrumentation(state) {
  const flags = state.config.instrumentation;

  if (flags.http) {
    patchGlobalFetch(state);
    patchHttpModules(state);
    patchAxios(state);
  }

  if (flags.process) {
    patchProcessErrors(state);
  }

  if (flags.filesystem) {
    patchFsPromises(state);
    patchChildProcess(state);
  }

  if (flags.db) {
    patchPostgres(state);
    patchDynamoDbDocumentClients(state);
    patchBigQuery(state);
    patchGoogleCloudStorage(state);
  }

  if (flags.queue) {
    patchBullAndBullMq(state);
  }

  if (flags.providers) {
    patchProviderClients(state);
    patchDeepgram(state);
    patchGoogleApis(state);
    patchAwsSdkV3(state);
    patchFirebaseAdmin(state);
    patchNodemailer(state);
  }

  if (flags.auth) {
    patchAuthStack(state);
  }

  if (flags.runtimeMetrics || state.config.performance.runtimeMetricsIntervalMs > 0) {
    startRuntimeMetrics(state);
  }
}
