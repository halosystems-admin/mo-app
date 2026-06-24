import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';

type TelemetryRequestContext = {
  method: string;
  route: string;
};

const requestContextStore = new AsyncLocalStorage<TelemetryRequestContext>();

function normalizeRoute(req: Request): string {
  const raw = req.originalUrl || req.url || '';
  const [withoutQuery] = raw.split('?');
  return withoutQuery || '/';
}

export function telemetryRequestContextMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const context: TelemetryRequestContext = {
      method: req.method,
      route: normalizeRoute(req),
    };
    requestContextStore.run(context, () => next());
  };
}

export function getTelemetryRequestContext(): TelemetryRequestContext | null {
  return requestContextStore.getStore() ?? null;
}

export function installTelemetryRequestContextGetter(): void {
  const globalWithGetter = globalThis as typeof globalThis & {
    __haloTelemetryRequestContext?: () => TelemetryRequestContext | null;
  };
  globalWithGetter.__haloTelemetryRequestContext = getTelemetryRequestContext;
}
