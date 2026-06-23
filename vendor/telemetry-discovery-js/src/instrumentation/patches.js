import http from "node:http";
import https from "node:https";
import { numberOrDefault } from "../runtime/config.js";
import { trackRawEvent } from "../runtime/track.js";
import {
  classifyProvider as classifyServiceFromUrl,
  inferAwsProvider,
  inferGoogleServiceFromUrl,
  isTelemetryEndpointCall
} from "../classification/provider-classifier.js";
import { stringError } from "../shared/errors.js";
import { safeRequire, safeResolve, tryReplaceCachedModuleExport } from "../shared/require-utils.js";
import {
  captureBufferSafe,
  captureJsonSafe,
  extractPgQueryText,
  pushChunk,
  stringifyArg
} from "../shared/payload-capture.js";
import { extractHttpUsageFields, tryReadJsonResponseBody } from "./extract-http-usage.js";
import { wrapProviderMethod } from "./observe.js";

export function patchGlobalFetch(state) {
  if (typeof globalThis.fetch !== "function") {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function telemetryWrappedFetch(input, init) {
    const start = Date.now();
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : input?.url ?? "unknown";
    const serviceHint = classifyServiceFromUrl(url);
    if (isTelemetryEndpointCall(state, url)) {
      return originalFetch(input, init);
    }

    try {
      const response = await originalFetch(input, init);
      const responseBody = response.ok ? await tryReadJsonResponseBody(response) : null;
      const usageFields = extractHttpUsageFields(responseBody, {
        provider: serviceHint.provider,
        url
      });
      trackRawEvent(
        state,
        {
          type: "external_http_call",
          layer: "fetch",
          method,
          url,
          provider: serviceHint.provider,
          operation: serviceHint.operation,
          duration_ms: Date.now() - start,
          status_code: response.status,
          success: response.ok,
          ...usageFields
        },
        { forceKeep: !response.ok }
      );
      return response;
    } catch (error) {
      trackRawEvent(
        state,
        {
          type: "external_http_call",
          layer: "fetch",
          method,
          url,
          provider: serviceHint.provider,
          operation: serviceHint.operation,
          duration_ms: Date.now() - start,
          success: false,
          error_message: stringError(error)
        },
        { forceKeep: true }
      );
      throw error;
    }
  };

  state.stopFns.push(() => {
    globalThis.fetch = originalFetch;
  });
}

export function patchHttpModules(state) {
  patchNodeRequestMethod(state, http, "http");
  patchNodeRequestMethod(state, https, "https");
}

function patchNodeRequestMethod(state, moduleRef, layer) {
  const originalRequest = moduleRef.request.bind(moduleRef);

  moduleRef.request = function telemetryWrappedRequest(...args) {
    const start = Date.now();
    const req = originalRequest(...args);
    const options = normalizeRequestOptions(args[0], args[1]);
    const requestUrl = `${layer}://${options.host}${options.path}`;
    const serviceHint = classifyServiceFromUrl(requestUrl);
    let completed = false;

    const done = (raw) => {
      if (completed) {
        return;
      }
      completed = true;
      if (isTelemetryEndpointCall(state, requestUrl)) {
        return;
      }
      trackRawEvent(state, { type: "external_http_call", layer, ...raw }, { forceKeep: raw.success === false });
    };

    req.on("response", (res) => {
      done({
        method: options.method,
        host: options.host,
        path: options.path,
        provider: serviceHint.provider,
        operation: serviceHint.operation,
        status_code: res.statusCode,
        duration_ms: Date.now() - start,
        success: (res.statusCode ?? 500) < 400
      });
    });

    req.on("error", (error) => {
      done({
        method: options.method,
        host: options.host,
        path: options.path,
        provider: serviceHint.provider,
        operation: serviceHint.operation,
        duration_ms: Date.now() - start,
        success: false,
        error_message: stringError(error)
      });
    });

    return req;
  };

  state.stopFns.push(() => {
    moduleRef.request = originalRequest;
  });
}

export function patchAxios(state) {
  const axiosMod = safeRequire("axios");
  const axios = axiosMod?.default ?? axiosMod;
  if (!axios?.interceptors?.request || !axios?.interceptors?.response) {
    return;
  }

  const requestStartMap = new WeakMap();
  const reqId = axios.interceptors.request.use((config) => {
    requestStartMap.set(config, Date.now());
    return config;
  });

  const resId = axios.interceptors.response.use(
    async (response) => {
      const config = response?.config ?? {};
      const startedAt = requestStartMap.get(config) ?? Date.now();
      const method = String(config.method ?? "GET").toUpperCase();
      const url = config.url ?? "unknown";
      if (!isTelemetryEndpointCall(state, url)) {
        const serviceHint = classifyServiceFromUrl(url);
        const responseBody =
          (response?.status ?? 500) < 400 ? await tryReadJsonResponseBody(response) : null;
        const usageFields = extractHttpUsageFields(responseBody, {
          provider: serviceHint.provider,
          url
        });
        trackRawEvent(state, {
          type: "external_http_call",
          layer: "axios",
          method,
          url,
          provider: serviceHint.provider,
          operation: serviceHint.operation,
          status_code: response?.status ?? null,
          duration_ms: Date.now() - startedAt,
          success: (response?.status ?? 500) < 400,
          ...usageFields
        });
      }
      return response;
    },
    (error) => {
      const config = error?.config ?? {};
      const startedAt = requestStartMap.get(config) ?? Date.now();
      const method = String(config.method ?? "GET").toUpperCase();
      const url = config.url ?? "unknown";
      if (!isTelemetryEndpointCall(state, url)) {
        const serviceHint = classifyServiceFromUrl(url);
        trackRawEvent(
          state,
          {
            type: "external_http_call",
            layer: "axios",
            method,
            url,
            provider: serviceHint.provider,
            operation: serviceHint.operation,
            status_code: error?.response?.status ?? null,
            duration_ms: Date.now() - startedAt,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
      }
      return Promise.reject(error);
    }
  );

  state.stopFns.push(() => {
    axios.interceptors.request.eject(reqId);
    axios.interceptors.response.eject(resId);
  });
}

function normalizeRequestOptions(firstArg, secondArg) {
  const obj = typeof firstArg === "object" && firstArg !== null ? firstArg : secondArg ?? {};
  return {
    method: (obj.method ?? "GET").toUpperCase(),
    host: obj.hostname ?? obj.host ?? "unknown",
    path: obj.path ?? obj.pathname ?? "/"
  };
}

export function patchProcessErrors(state) {
  const onUnhandledRejection = (reason) => {
    trackRawEvent(
      state,
      {
        type: "process_error",
        category: "unhandled_rejection",
        success: false,
        error_message: stringError(reason)
      },
      { forceKeep: true }
    );
  };

  const onUncaughtException = (error) => {
    trackRawEvent(
      state,
      {
        type: "process_error",
        category: "uncaught_exception",
        success: false,
        error_message: stringError(error),
        stack: error?.stack
      },
      { forceKeep: true }
    );
  };

  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtExceptionMonitor", onUncaughtException);

  state.stopFns.push(() => {
    process.off("unhandledRejection", onUnhandledRejection);
    process.off("uncaughtExceptionMonitor", onUncaughtException);
  });
}

export function patchFsPromises(state) {
  const fsModule = safeRequire("node:fs");
  if (!fsModule?.promises) {
    return;
  }

  const promisesApi = fsModule.promises;
  const methods = ["readFile", "writeFile", "appendFile", "unlink", "readdir", "stat", "rename", "mkdir", "rm"];
  const originals = new Map();

  for (const method of methods) {
    if (typeof promisesApi[method] !== "function") {
      continue;
    }
    const original = promisesApi[method].bind(promisesApi);
    originals.set(method, original);
    promisesApi[method] = async (...args) => {
      const start = Date.now();
      try {
        const out = await original(...args);
        trackRawEvent(state, {
          type: "filesystem_operation",
          layer: "fs.promises",
          operation: method,
          target: stringifyArg(args[0]),
          duration_ms: Date.now() - start,
          success: true
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "filesystem_operation",
            layer: "fs.promises",
            operation: method,
            target: stringifyArg(args[0]),
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
  }

  state.stopFns.push(() => {
    for (const [method, original] of originals.entries()) {
      promisesApi[method] = original;
    }
  });
}

export function patchChildProcess(state) {
  const childProcess = safeRequire("node:child_process");
  if (!childProcess) {
    return;
  }

  const methods = ["exec", "execFile", "spawn", "fork"];
  const originals = new Map();

  for (const method of methods) {
    if (typeof childProcess[method] !== "function") {
      continue;
    }
    const original = childProcess[method].bind(childProcess);
    originals.set(method, original);

    childProcess[method] = (...args) => {
      const start = Date.now();
      const cmd = method === "fork" ? stringifyArg(args[0]) : stringifyArg(args[0]);
      const child = original(...args);

      const done = (success, extra = {}) => {
        trackRawEvent(
          state,
          {
            type: "child_process_execution",
            operation: method,
            command: cmd,
            duration_ms: Date.now() - start,
            success,
            ...extra
          },
          { forceKeep: !success }
        );
      };

      if (child && typeof child.on === "function") {
        child.on("error", (error) => done(false, { error_message: stringError(error) }));
        child.on("close", (code, signal) =>
          done((code ?? 1) === 0, { exit_code: code, signal: signal ?? null })
        );
      } else {
        done(true);
      }

      return child;
    };
  }

  state.stopFns.push(() => {
    for (const [method, original] of originals.entries()) {
      childProcess[method] = original;
    }
  });
}

export function patchPostgres(state) {
  const pg = safeRequire("pg");
  if (!pg) {
    return;
  }

  const restorers = [];

  const wrapQuery = (target, targetName) => {
    if (!target || typeof target.query !== "function") {
      return;
    }

    const original = target.query;
    target.query = function telemetryWrappedPgQuery(...args) {
      const startedAt = Date.now();
      const queryText = extractPgQueryText(args[0]);
      try {
        const result = original.apply(this, args);

        if (result && typeof result.then === "function") {
          return result
            .then((value) => {
              trackRawEvent(state, {
                type: "db_query",
                db: "postgres",
                layer: targetName,
                query_text: queryText,
                duration_ms: Date.now() - startedAt,
                success: true,
                row_count: typeof value?.rowCount === "number" ? value.rowCount : null
              });
              return value;
            })
            .catch((error) => {
              trackRawEvent(
                state,
                {
                  type: "db_query",
                  db: "postgres",
                  layer: targetName,
                  query_text: queryText,
                  duration_ms: Date.now() - startedAt,
                  success: false,
                  error_message: stringError(error)
                },
                { forceKeep: true }
              );
              throw error;
            });
        }

        // Callback style fallback.
        if (typeof args[args.length - 1] === "function") {
          const callback = args[args.length - 1];
          args[args.length - 1] = (error, value) => {
            trackRawEvent(
              state,
              {
                type: "db_query",
                db: "postgres",
                layer: targetName,
                query_text: queryText,
                duration_ms: Date.now() - startedAt,
                success: !error,
                error_message: error ? stringError(error) : null,
                row_count: typeof value?.rowCount === "number" ? value.rowCount : null
              },
              { forceKeep: !!error }
            );
            callback(error, value);
          };
          return original.apply(this, args);
        }

        return result;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "db_query",
            db: "postgres",
            layer: targetName,
            query_text: queryText,
            duration_ms: Date.now() - startedAt,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };

    restorers.push(() => {
      target.query = original;
    });
  };

  wrapQuery(pg.Client?.prototype, "pg.Client");
  wrapQuery(pg.Pool?.prototype, "pg.Pool");

  state.stopFns.push(() => {
    for (const restore of restorers) {
      restore();
    }
  });
}

export function patchBullAndBullMq(state) {
  patchBullMq(state);
  patchBull(state);
}

function patchBullMq(state) {
  const bullmq = safeRequire("bullmq");
  if (!bullmq) {
    return;
  }

  const restoreFns = [];

  if (bullmq.Queue?.prototype?.add) {
    const originalAdd = bullmq.Queue.prototype.add;
    bullmq.Queue.prototype.add = async function telemetryWrappedBullMqAdd(...args) {
      const startedAt = Date.now();
      const jobName = stringifyArg(args[0]);
      try {
        const out = await originalAdd.apply(this, args);
        trackRawEvent(state, {
          type: "queue_job_enqueue",
          queue_system: "bullmq",
          queue_name: this.name,
          job_name: jobName,
          duration_ms: Date.now() - startedAt,
          success: true,
          job_id: out?.id ?? null
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "queue_job_enqueue",
            queue_system: "bullmq",
            queue_name: this.name,
            job_name: jobName,
            duration_ms: Date.now() - startedAt,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
    restoreFns.push(() => {
      bullmq.Queue.prototype.add = originalAdd;
    });
  }

  if (bullmq.Worker?.prototype?.run) {
    const originalRun = bullmq.Worker.prototype.run;
    bullmq.Worker.prototype.run = function telemetryWrappedBullMqRun(...args) {
      if (!this.__telemetryListenersAttached) {
        this.__telemetryListenersAttached = true;
        this.on?.("completed", (job) => {
          trackRawEvent(state, {
            type: "queue_job_completed",
            queue_system: "bullmq",
            queue_name: this.name,
            job_name: job?.name ?? null,
            job_id: job?.id ?? null,
            success: true
          });
        });
        this.on?.("failed", (job, error) => {
          trackRawEvent(
            state,
            {
              type: "queue_job_failed",
              queue_system: "bullmq",
              queue_name: this.name,
              job_name: job?.name ?? null,
              job_id: job?.id ?? null,
              success: false,
              error_message: stringError(error)
            },
            { forceKeep: true }
          );
        });
      }
      return originalRun.apply(this, args);
    };
    restoreFns.push(() => {
      bullmq.Worker.prototype.run = originalRun;
    });
  }

  state.stopFns.push(() => {
    for (const restore of restoreFns) {
      restore();
    }
  });
}

function patchBull(state) {
  const Bull = safeRequire("bull");
  if (!Bull?.prototype?.add || !Bull?.prototype?.process) {
    return;
  }

  const originalAdd = Bull.prototype.add;
  Bull.prototype.add = async function telemetryWrappedBullAdd(...args) {
    const startedAt = Date.now();
    const jobName = typeof args[0] === "string" ? args[0] : "default";
    try {
      const out = await originalAdd.apply(this, args);
      trackRawEvent(state, {
        type: "queue_job_enqueue",
        queue_system: "bull",
        queue_name: this.name,
        job_name: jobName,
        duration_ms: Date.now() - startedAt,
        success: true,
        job_id: out?.id ?? null
      });
      return out;
    } catch (error) {
      trackRawEvent(
        state,
        {
          type: "queue_job_enqueue",
          queue_system: "bull",
          queue_name: this.name,
          job_name: jobName,
          duration_ms: Date.now() - startedAt,
          success: false,
          error_message: stringError(error)
        },
        { forceKeep: true }
      );
      throw error;
    }
  };

  const originalProcess = Bull.prototype.process;
  Bull.prototype.process = function telemetryWrappedBullProcess(...args) {
    const processorIndex = args.findIndex((arg) => typeof arg === "function");
    if (processorIndex >= 0) {
      const originalProcessor = args[processorIndex];
      args[processorIndex] = async (job, ...rest) => {
        const startedAt = Date.now();
        try {
          const out = await originalProcessor(job, ...rest);
          trackRawEvent(state, {
            type: "queue_job_completed",
            queue_system: "bull",
            queue_name: this.name,
            job_name: job?.name ?? null,
            job_id: job?.id ?? null,
            duration_ms: Date.now() - startedAt,
            success: true
          });
          return out;
        } catch (error) {
          trackRawEvent(
            state,
            {
              type: "queue_job_failed",
              queue_system: "bull",
              queue_name: this.name,
              job_name: job?.name ?? null,
              job_id: job?.id ?? null,
              duration_ms: Date.now() - startedAt,
              success: false,
              error_message: stringError(error)
            },
            { forceKeep: true }
          );
          throw error;
        }
      };
    }
    return originalProcess.apply(this, args);
  };

  state.stopFns.push(() => {
    Bull.prototype.add = originalAdd;
    Bull.prototype.process = originalProcess;
  });
}

export function patchProviderClients(state) {
  patchOpenAi(state);
  patchGoogleGenerativeAi(state);
  patchTwilio(state);
}

export function patchDeepgram(state) {
  const deepgramMod = safeRequire("@deepgram/sdk");
  const DeepgramClient =
    deepgramMod?.DeepgramClient ??
    deepgramMod?.Deepgram ??
    deepgramMod?.createClient ??
    null;

  if (!DeepgramClient) {
    return;
  }

  // Instance class style patch
  if (DeepgramClient?.prototype) {
    const restoreFns = [];
    wrapProviderMethod(state, restoreFns, DeepgramClient.prototype, "listen.live", {
      provider: "deepgram",
      operation: "listen.live"
    });
    wrapProviderMethod(state, restoreFns, DeepgramClient.prototype, "listen.prerecorded.transcribeFile", {
      provider: "deepgram",
      operation: "listen.prerecorded.transcribeFile"
    });
    wrapProviderMethod(state, restoreFns, DeepgramClient.prototype, "listen.prerecorded.transcribeUrl", {
      provider: "deepgram",
      operation: "listen.prerecorded.transcribeUrl"
    });

    if (restoreFns.length > 0) {
      state.stopFns.push(() => {
        for (const fn of restoreFns) {
          fn();
        }
      });
    }
  }

  // Factory function style patch
  if (typeof deepgramMod?.createClient === "function") {
    const originalCreateClient = deepgramMod.createClient;
    deepgramMod.createClient = function telemetryWrappedCreateClient(...args) {
      const client = originalCreateClient(...args);
      const restoreFns = [];
      wrapProviderMethod(state, restoreFns, client, "listen.live", {
        provider: "deepgram",
        operation: "listen.live"
      });
      wrapProviderMethod(state, restoreFns, client, "listen.prerecorded.transcribeFile", {
        provider: "deepgram",
        operation: "listen.prerecorded.transcribeFile"
      });
      wrapProviderMethod(state, restoreFns, client, "listen.prerecorded.transcribeUrl", {
        provider: "deepgram",
        operation: "listen.prerecorded.transcribeUrl"
      });
      return client;
    };

    state.stopFns.push(() => {
      deepgramMod.createClient = originalCreateClient;
    });
  }
}

export function patchGoogleApis(state) {
  const googleapisMod = safeRequire("googleapis");
  const google = googleapisMod?.google;
  if (!google) {
    return;
  }

  // Patch auth client request layer (covers OAuth client calls)
  const oauth2Proto = google.auth?.OAuth2?.prototype;
  if (oauth2Proto?.request) {
    const originalRequest = oauth2Proto.request;
    oauth2Proto.request = async function telemetryWrappedGoogleAuthRequest(...args) {
      const start = Date.now();
      const requestArg = args?.[0] ?? {};
      try {
        const out = await originalRequest.apply(this, args);
        trackRawEvent(state, {
          type: "provider_call",
          provider: "google_oauth",
          operation: "auth.request",
          method: requestArg?.method ?? null,
          url: requestArg?.url ?? null,
          duration_ms: Date.now() - start,
          success: true
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "provider_call",
            provider: "google_oauth",
            operation: "auth.request",
            method: requestArg?.method ?? null,
            url: requestArg?.url ?? null,
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
    state.stopFns.push(() => {
      oauth2Proto.request = originalRequest;
    });
  }

  // Patch underlying gaxios request used by Drive/Calendar/Gmail/Sheets APIs
  const gaxiosProto = googleapisMod?.Common?.Gaxios?.prototype ?? safeRequire("gaxios")?.Gaxios?.prototype;
  if (gaxiosProto?.request) {
    const originalGaxiosRequest = gaxiosProto.request;
    gaxiosProto.request = async function telemetryWrappedGaxiosRequest(...args) {
      const start = Date.now();
      const requestArg = args?.[0] ?? {};
      const url = requestArg?.url ?? "";
      const serviceHint = inferGoogleServiceFromUrl(url);
      try {
        const out = await originalGaxiosRequest.apply(this, args);
        const status = out?.status ?? out?.statusCode ?? null;
        trackRawEvent(state, {
          type: "provider_call",
          provider: serviceHint.provider,
          operation: serviceHint.operation,
          method: requestArg?.method ?? null,
          url,
          status_code: status,
          duration_ms: Date.now() - start,
          success: !status || status < 400
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "provider_call",
            provider: serviceHint.provider,
            operation: serviceHint.operation,
            method: requestArg?.method ?? null,
            url,
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
    state.stopFns.push(() => {
      gaxiosProto.request = originalGaxiosRequest;
    });
  }
}

export function patchAwsSdkV3(state) {
  const smithyMiddleware = safeRequire("@smithy/middleware-stack");
  if (!smithyMiddleware?.MiddlewareStack?.prototype?.add) {
    return;
  }

  // Only add middleware once per stack.
  const originalAdd = smithyMiddleware.MiddlewareStack.prototype.add;
  smithyMiddleware.MiddlewareStack.prototype.add = function telemetryWrappedMiddlewareAdd(middleware, options = {}) {
    return originalAdd.call(this, middleware, options);
  };

  const originalResolve = smithyMiddleware.MiddlewareStack.prototype.resolve;
  smithyMiddleware.MiddlewareStack.prototype.resolve = function telemetryWrappedMiddlewareResolve(handler, context = {}) {
    const resolved = originalResolve.call(this, handler, context);
    const commandName = context?.commandName ?? "unknown_command";
    const clientName = context?.clientName ?? "aws_sdk_v3";

    return async (args) => {
      const start = Date.now();
      try {
        const out = await resolved(args);
        const status = out?.response?.statusCode ?? null;
        trackRawEvent(state, {
          type: "provider_call",
          provider: inferAwsProvider(clientName),
          operation: commandName,
          client: clientName,
          status_code: status,
          duration_ms: Date.now() - start,
          success: !status || status < 400
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "provider_call",
            provider: inferAwsProvider(clientName),
            operation: commandName,
            client: clientName,
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
  };

  state.stopFns.push(() => {
    smithyMiddleware.MiddlewareStack.prototype.add = originalAdd;
    smithyMiddleware.MiddlewareStack.prototype.resolve = originalResolve;
  });
}

export function patchFirebaseAdmin(state) {
  const firebaseAdmin = safeRequire("firebase-admin");
  if (!firebaseAdmin) {
    return;
  }

  // Firestore
  try {
    const firestore = firebaseAdmin.firestore?.();
    const writeBatchProto = firestore?.batch?.()?.constructor?.prototype;
    if (writeBatchProto?.commit) {
      const originalCommit = writeBatchProto.commit;
      writeBatchProto.commit = async function telemetryWrappedFirestoreCommit(...args) {
        const start = Date.now();
        try {
          const out = await originalCommit.apply(this, args);
          trackRawEvent(state, {
            type: "provider_call",
            provider: "firebase_firestore",
            operation: "batch.commit",
            duration_ms: Date.now() - start,
            success: true
          });
          return out;
        } catch (error) {
          trackRawEvent(
            state,
            {
              type: "provider_call",
              provider: "firebase_firestore",
              operation: "batch.commit",
              duration_ms: Date.now() - start,
              success: false,
              error_message: stringError(error)
            },
            { forceKeep: true }
          );
          throw error;
        }
      };
      state.stopFns.push(() => {
        writeBatchProto.commit = originalCommit;
      });
    }
  } catch {
    // ignore missing firestore initialization
  }

  // Realtime Database
  try {
    const dbRefProto = firebaseAdmin.database?.Reference?.prototype;
    if (dbRefProto) {
      const restoreFns = [];
      wrapProviderMethod(state, restoreFns, dbRefProto, "set", {
        provider: "firebase_rtdb",
        operation: "ref.set"
      });
      wrapProviderMethod(state, restoreFns, dbRefProto, "update", {
        provider: "firebase_rtdb",
        operation: "ref.update"
      });
      wrapProviderMethod(state, restoreFns, dbRefProto, "once", {
        provider: "firebase_rtdb",
        operation: "ref.once"
      });
      if (restoreFns.length > 0) {
        state.stopFns.push(() => {
          for (const fn of restoreFns) {
            fn();
          }
        });
      }
    }
  } catch {
    // ignore missing rtdb
  }

  // Storage
  try {
    const storageBucketProto = firebaseAdmin.storage?.Bucket?.prototype;
    if (storageBucketProto) {
      const restoreFns = [];
      wrapProviderMethod(state, restoreFns, storageBucketProto, "upload", {
        provider: "google_cloud_storage",
        operation: "bucket.upload"
      });
      if (restoreFns.length > 0) {
        state.stopFns.push(() => {
          for (const fn of restoreFns) {
            fn();
          }
        });
      }
    }
  } catch {
    // ignore missing storage
  }
}

export function patchNodemailer(state) {
  const nodemailer = safeRequire("nodemailer");
  if (!nodemailer?.createTransport) {
    return;
  }

  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = function telemetryWrappedCreateTransport(...args) {
    const transport = originalCreateTransport.apply(this, args);
    if (!transport?.sendMail || typeof transport.sendMail !== "function") {
      return transport;
    }

    const originalSendMail = transport.sendMail.bind(transport);
    transport.sendMail = async (...sendArgs) => {
      const start = Date.now();
      const envelope = sendArgs?.[0] ?? {};
      try {
        const out = await originalSendMail(...sendArgs);
        trackRawEvent(state, {
          type: "provider_call",
          provider: "nodemailer",
          operation: "sendMail",
          to: envelope?.to ?? null,
          subject: envelope?.subject ?? null,
          duration_ms: Date.now() - start,
          success: true
        });
        return out;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "provider_call",
            provider: "nodemailer",
            operation: "sendMail",
            to: envelope?.to ?? null,
            subject: envelope?.subject ?? null,
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };

    return transport;
  };

  state.stopFns.push(() => {
    nodemailer.createTransport = originalCreateTransport;
  });
}

export function patchAuthStack(state) {
  patchJsonWebToken(state);
  patchJwksRsa(state);
  patchAwsCognitoIdentityProvider(state);
}

function patchJsonWebToken(state) {
  const jwt = safeRequire("jsonwebtoken");
  if (!jwt) {
    return;
  }

  const wrapFn = (name) => {
    if (typeof jwt[name] !== "function") {
      return null;
    }
    const original = jwt[name];
    jwt[name] = function telemetryWrappedJwtFn(...args) {
      const start = Date.now();
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === "function") {
          return result
            .then((value) => {
              trackRawEvent(state, {
                type: "auth_event",
                provider: "jwt",
                operation: name,
                duration_ms: Date.now() - start,
                success: true
              });
              return value;
            })
            .catch((error) => {
              trackRawEvent(
                state,
                {
                  type: "auth_event",
                  provider: "jwt",
                  operation: name,
                  duration_ms: Date.now() - start,
                  success: false,
                  error_message: stringError(error)
                },
                { forceKeep: true }
              );
              throw error;
            });
        }
        trackRawEvent(state, {
          type: "auth_event",
          provider: "jwt",
          operation: name,
          duration_ms: Date.now() - start,
          success: true
        });
        return result;
      } catch (error) {
        trackRawEvent(
          state,
          {
            type: "auth_event",
            provider: "jwt",
            operation: name,
            duration_ms: Date.now() - start,
            success: false,
            error_message: stringError(error)
          },
          { forceKeep: true }
        );
        throw error;
      }
    };
    return () => {
      jwt[name] = original;
    };
  };

  const restorers = [wrapFn("sign"), wrapFn("verify"), wrapFn("decode")].filter(Boolean);
  if (restorers.length > 0) {
    state.stopFns.push(() => {
      for (const restore of restorers) {
        restore();
      }
    });
  }
}

function patchJwksRsa(state) {
  const jwksRsa = safeRequire("jwks-rsa");
  if (typeof jwksRsa !== "function") {
    return;
  }

  const modulePath = safeResolve("jwks-rsa");
  if (!modulePath || !require.cache[modulePath]) {
    return;
  }

  const originalFactory = require.cache[modulePath].exports;
  const wrappedFactory = function telemetryWrappedJwksFactory(...factoryArgs) {
    const client = originalFactory(...factoryArgs);
    if (!client || typeof client.getSigningKey !== "function") {
      return client;
    }
    const originalGetSigningKey = client.getSigningKey.bind(client);
    client.getSigningKey = (...args) => {
      const start = Date.now();
      const kid = args?.[0] ?? null;
      const last = args[args.length - 1];
      // Callback style support
      if (typeof last === "function") {
        const callback = last;
        args[args.length - 1] = (error, key) => {
          trackRawEvent(
            state,
            {
              type: "auth_event",
              provider: "jwks_rsa",
              operation: "getSigningKey",
              kid,
              duration_ms: Date.now() - start,
              success: !error,
              error_message: error ? stringError(error) : null
            },
            { forceKeep: !!error }
          );
          callback(error, key);
        };
        return originalGetSigningKey(...args);
      }

      return Promise.resolve(originalGetSigningKey(...args))
        .then((key) => {
          trackRawEvent(state, {
            type: "auth_event",
            provider: "jwks_rsa",
            operation: "getSigningKey",
            kid,
            duration_ms: Date.now() - start,
            success: true
          });
          return key;
        })
        .catch((error) => {
          trackRawEvent(
            state,
            {
              type: "auth_event",
              provider: "jwks_rsa",
              operation: "getSigningKey",
              kid,
              duration_ms: Date.now() - start,
              success: false,
              error_message: stringError(error)
            },
            { forceKeep: true }
          );
          throw error;
        });
    };
    return client;
  };

  require.cache[modulePath].exports = wrappedFactory;
  state.stopFns.push(() => {
    require.cache[modulePath].exports = originalFactory;
  });
}

function patchAwsCognitoIdentityProvider(state) {
  const cognito = safeRequire("@aws-sdk/client-cognito-identity-provider");
  const clientProto = cognito?.CognitoIdentityProviderClient?.prototype;
  if (!clientProto || typeof clientProto.send !== "function") {
    return;
  }

  const originalSend = clientProto.send;
  clientProto.send = async function telemetryWrappedCognitoSend(command, ...rest) {
    const start = Date.now();
    const commandName = command?.constructor?.name ?? "unknown_command";
    try {
      const out = await originalSend.call(this, command, ...rest);
      trackRawEvent(state, {
        type: "auth_event",
        provider: "aws_cognito",
        operation: commandName,
        duration_ms: Date.now() - start,
        success: true
      });
      return out;
    } catch (error) {
      trackRawEvent(
        state,
        {
          type: "auth_event",
          provider: "aws_cognito",
          operation: commandName,
          duration_ms: Date.now() - start,
          success: false,
          error_message: stringError(error)
        },
        { forceKeep: true }
      );
      throw error;
    }
  };

  state.stopFns.push(() => {
    clientProto.send = originalSend;
  });
}

export function patchBigQuery(state) {
  const bigqueryMod = safeRequire("@google-cloud/bigquery");
  const BigQuery = bigqueryMod?.BigQuery;
  if (!BigQuery?.prototype) {
    return;
  }

  const restoreFns = [];
  wrapProviderMethod(state, restoreFns, BigQuery.prototype, "query", {
    provider: "google_bigquery",
    operation: "query"
  });
  wrapProviderMethod(state, restoreFns, BigQuery.prototype, "createQueryJob", {
    provider: "google_bigquery",
    operation: "createQueryJob"
  });

  const jobProto = bigqueryMod?.Job?.prototype;
  if (jobProto) {
    wrapProviderMethod(state, restoreFns, jobProto, "getQueryResults", {
      provider: "google_bigquery",
      operation: "job.getQueryResults"
    });
  }

  if (restoreFns.length > 0) {
    state.stopFns.push(() => {
      for (const fn of restoreFns) {
        fn();
      }
    });
  }
}

export function patchGoogleCloudStorage(state) {
  const storageMod = safeRequire("@google-cloud/storage");
  const Bucket = storageMod?.Bucket;
  const File = storageMod?.File;
  if (!Bucket?.prototype && !File?.prototype) {
    return;
  }

  const restoreFns = [];
  if (Bucket?.prototype) {
    wrapProviderMethod(state, restoreFns, Bucket.prototype, "upload", {
      provider: "google_cloud_storage",
      operation: "bucket.upload"
    });
    wrapProviderMethod(state, restoreFns, Bucket.prototype, "deleteFiles", {
      provider: "google_cloud_storage",
      operation: "bucket.deleteFiles"
    });
    wrapProviderMethod(state, restoreFns, Bucket.prototype, "getFiles", {
      provider: "google_cloud_storage",
      operation: "bucket.getFiles"
    });
  }

  if (File?.prototype) {
    wrapProviderMethod(state, restoreFns, File.prototype, "save", {
      provider: "google_cloud_storage",
      operation: "file.save"
    });
    wrapProviderMethod(state, restoreFns, File.prototype, "download", {
      provider: "google_cloud_storage",
      operation: "file.download"
    });
    wrapProviderMethod(state, restoreFns, File.prototype, "delete", {
      provider: "google_cloud_storage",
      operation: "file.delete"
    });
  }

  if (restoreFns.length > 0) {
    state.stopFns.push(() => {
      for (const fn of restoreFns) {
        fn();
      }
    });
  }
}

export function patchDynamoDbDocumentClients(state) {
  patchAwsSdkV3DynamoDocument(state);
  patchAwsSdkV2DocumentClient(state);
}

function patchAwsSdkV3DynamoDocument(state) {
  const dynamoDoc = safeRequire("@aws-sdk/lib-dynamodb");
  const clientProto = dynamoDoc?.DynamoDBDocumentClient?.prototype;
  if (!clientProto || typeof clientProto.send !== "function") {
    return;
  }

  const originalSend = clientProto.send;
  clientProto.send = async function telemetryWrappedDynamoDocSend(command, ...rest) {
    const start = Date.now();
    const operation = command?.constructor?.name ?? "unknown_operation";
    try {
      const out = await originalSend.call(this, command, ...rest);
      trackRawEvent(state, {
        type: "provider_call",
        provider: "aws_dynamodb",
        operation,
        duration_ms: Date.now() - start,
        success: true
      });
      return out;
    } catch (error) {
      trackRawEvent(
        state,
        {
          type: "provider_call",
          provider: "aws_dynamodb",
          operation,
          duration_ms: Date.now() - start,
          success: false,
          error_message: stringError(error)
        },
        { forceKeep: true }
      );
      throw error;
    }
  };

  state.stopFns.push(() => {
    clientProto.send = originalSend;
  });
}

function patchAwsSdkV2DocumentClient(state) {
  const AWS = safeRequire("aws-sdk");
  const docClientProto = AWS?.DynamoDB?.DocumentClient?.prototype;
  if (!docClientProto) {
    return;
  }

  const methods = ["get", "put", "update", "delete", "query", "scan", "batchGet", "batchWrite", "transactWrite", "transactGet"];
  const restoreFns = [];

  for (const method of methods) {
    if (typeof docClientProto[method] !== "function") {
      continue;
    }
    const original = docClientProto[method];
    docClientProto[method] = function telemetryWrappedDynamoV2Method(...args) {
      const start = Date.now();
      const request = original.apply(this, args);
      if (!request || typeof request.promise !== "function") {
        trackRawEvent(state, {
          type: "provider_call",
          provider: "aws_dynamodb",
          operation: `DocumentClient.${method}`,
          duration_ms: Date.now() - start,
          success: true
        });
        return request;
      }

      const originalPromise = request.promise.bind(request);
      request.promise = () =>
        originalPromise()
          .then((value) => {
            trackRawEvent(state, {
              type: "provider_call",
              provider: "aws_dynamodb",
              operation: `DocumentClient.${method}`,
              duration_ms: Date.now() - start,
              success: true
            });
            return value;
          })
          .catch((error) => {
            trackRawEvent(
              state,
              {
                type: "provider_call",
                provider: "aws_dynamodb",
                operation: `DocumentClient.${method}`,
                duration_ms: Date.now() - start,
                success: false,
                error_message: stringError(error)
              },
              { forceKeep: true }
            );
            throw error;
          });
      return request;
    };
    restoreFns.push(() => {
      docClientProto[method] = original;
    });
  }

  if (restoreFns.length > 0) {
    state.stopFns.push(() => {
      for (const restore of restoreFns) {
        restore();
      }
    });
  }
}

function patchOpenAi(state) {
  const openaiMod = safeRequire("openai");
  const OpenAI = openaiMod?.default ?? openaiMod?.OpenAI ?? openaiMod;
  if (!OpenAI?.prototype) {
    return;
  }

  const proto = OpenAI.prototype;
  const restoreFns = [];

  wrapProviderMethod(state, restoreFns, proto, "responses.create", {
    provider: "openai",
    operation: "responses.create",
    modelExtractor: (args) => args?.[0]?.model
  });
  wrapProviderMethod(state, restoreFns, proto, "chat.completions.create", {
    provider: "openai",
    operation: "chat.completions.create",
    modelExtractor: (args) => args?.[0]?.model
  });
  wrapProviderMethod(state, restoreFns, proto, "embeddings.create", {
    provider: "openai",
    operation: "embeddings.create",
    modelExtractor: (args) => args?.[0]?.model
  });
  wrapProviderMethod(state, restoreFns, proto, "audio.transcriptions.create", {
    provider: "openai",
    operation: "audio.transcriptions.create",
    modelExtractor: (args) => args?.[0]?.model
  });

  if (restoreFns.length > 0) {
    state.stopFns.push(() => {
      for (const fn of restoreFns) {
        fn();
      }
    });
  }
}

function patchGoogleGenerativeAi(state) {
  const googleMod = safeRequire("@google/generative-ai");
  const GoogleGenerativeAI = googleMod?.GoogleGenerativeAI;
  if (!GoogleGenerativeAI?.prototype?.getGenerativeModel) {
    return;
  }

  const originalGetModel = GoogleGenerativeAI.prototype.getGenerativeModel;
  GoogleGenerativeAI.prototype.getGenerativeModel = function telemetryWrappedGetModel(...args) {
    const modelConfig = args?.[0] ?? {};
    const modelName = modelConfig.model ?? "unknown";
    const model = originalGetModel.apply(this, args);
    if (!model) {
      return model;
    }

    const restoreFns = [];
    wrapProviderMethod(state, restoreFns, model, "generateContent", {
      provider: "google_gemini",
      operation: "generateContent",
      modelExtractor: () => modelName
    });
    wrapProviderMethod(state, restoreFns, model, "generateContentStream", {
      provider: "google_gemini",
      operation: "generateContentStream",
      modelExtractor: () => modelName
    });
    wrapProviderMethod(state, restoreFns, model, "countTokens", {
      provider: "google_gemini",
      operation: "countTokens",
      modelExtractor: () => modelName
    });

    if (restoreFns.length > 0) {
      const remove = () => {
        for (const fn of restoreFns) {
          fn();
        }
      };
      state.stopFns.push(remove);
    }

    return model;
  };

  state.stopFns.push(() => {
    GoogleGenerativeAI.prototype.getGenerativeModel = originalGetModel;
  });
}

function patchTwilio(state) {
  const twilioFactory = safeRequire("twilio");
  if (typeof twilioFactory !== "function") {
    return;
  }

  const originalFactory = twilioFactory;
  const wrappedFactory = function telemetryWrappedTwilioFactory(...args) {
    const client = originalFactory(...args);
    if (!client) {
      return client;
    }

    const restoreFns = [];
    wrapProviderMethod(state, restoreFns, client, "messages.create", {
      provider: "twilio",
      operation: "messages.create",
      extraExtractor: (callArgs) => ({
        to: callArgs?.[0]?.to,
        messaging_service_sid: callArgs?.[0]?.messagingServiceSid ?? null
      })
    });
    wrapProviderMethod(state, restoreFns, client, "calls.create", {
      provider: "twilio",
      operation: "calls.create",
      extraExtractor: (callArgs) => ({
        to: callArgs?.[0]?.to
      })
    });

    if (restoreFns.length > 0) {
      state.stopFns.push(() => {
        for (const fn of restoreFns) {
          fn();
        }
      });
    }

    return client;
  };

  tryReplaceCachedModuleExport("twilio", wrappedFactory);
}

export function startRuntimeMetrics(state) {
  const intervalMs = state.config.performance.runtimeMetricsIntervalMs;
  if (intervalMs <= 0) {
    return;
  }

  let previousCpu = process.cpuUsage();
  let previousTime = process.hrtime.bigint();
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(previousCpu);
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - previousTime) / 1000;
    const cpuMicros = cpu.user + cpu.system;
    const cpuPct = elapsedMicros > 0 ? (cpuMicros / elapsedMicros) * 100 : 0;

    previousCpu = process.cpuUsage();
    previousTime = now;

    trackRawEvent(state, {
      type: "runtime_metrics",
      success: true,
      process: {
        pid: process.pid,
        uptime_seconds: Math.round(process.uptime()),
        rss_bytes: memory.rss,
        heap_total_bytes: memory.heapTotal,
        heap_used_bytes: memory.heapUsed,
        external_bytes: memory.external,
        array_buffers_bytes: memory.arrayBuffers ?? 0
      },
      cpu: {
        interval_ms: intervalMs,
        usage_pct_approx: Number(cpuPct.toFixed(2))
      }
    });
  }, intervalMs);
  timer.unref?.();

  state.stopFns.push(() => clearInterval(timer));
}

export function createExpressTelemetryMiddleware(state, options = {}) {
  const includeBodies = options.includeBodies === true;
  const maxBodyBytes = numberOrDefault(options.maxBodyBytes, 256 * 1024);

  return function telemetryExpressMiddleware(req, res, next) {
    const startedAt = Date.now();
    const requestBody = includeBodies ? captureJsonSafe(req.body, maxBodyBytes) : undefined;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const responseChunks = includeBodies ? [] : null;

    if (includeBodies) {
      res.write = function telemetryWrite(chunk, encoding, callback) {
        pushChunk(responseChunks, chunk, encoding, maxBodyBytes);
        return originalWrite(chunk, encoding, callback);
      };

      res.end = function telemetryEnd(chunk, encoding, callback) {
        if (chunk) {
          pushChunk(responseChunks, chunk, encoding, maxBodyBytes);
        }
        return originalEnd(chunk, encoding, callback);
      };
    }

    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const statusCode = res.statusCode ?? 500;
      const contentLengthHeader = res.getHeader("content-length");
      const responseSizeBytes =
        typeof contentLengthHeader === "string"
          ? Number(contentLengthHeader)
          : typeof contentLengthHeader === "number"
            ? contentLengthHeader
            : 0;
      const requestSizeBytes = Number(req.headers["content-length"] ?? 0);

      const payload = {
        type: "inbound_http_request",
        framework: "express",
        method: req.method,
        path: req.path,
        original_url: req.originalUrl,
        query: req.query,
        params: req.params,
        status_code: statusCode,
        success: statusCode < 400,
        duration_ms: durationMs,
        request_size_bytes: Number.isNaN(requestSizeBytes) ? 0 : requestSizeBytes,
        response_size_bytes: Number.isNaN(responseSizeBytes) ? 0 : responseSizeBytes,
        ip: req.ip,
        user_agent: req.get("user-agent"),
        practice_id: req.body?.practice_id,
        user_id: req.body?.user_id
      };

      if (includeBodies) {
        payload.request_body = requestBody;
        payload.response_body = captureBufferSafe(Buffer.concat(responseChunks), maxBodyBytes);
      }

      trackRawEvent(state, payload, { forceKeep: payload.success === false });
    });

    return next();
  };
}































