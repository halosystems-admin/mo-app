import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import path from 'path';
import http from 'http';
import { config } from './config';
import { initTelemetry, isTelemetryEnabled, shutdownTelemetry } from './telemetry';
import { MO_TEMPLATES_DIR_NAME, HENK_TEMPLATES_DIR_NAME } from '../shared/clinicalTemplates/docxFileResolver';
import fs from 'fs';
import authRoutes from './routes/auth';
import userAuthRoutes from './routes/userAuth';
import adminRoutes from './routes/admin';
import driveRoutes from './routes/drive';
import aiRoutes from './routes/ai';
import haloRoutes from './routes/halo';
import calendarRoutes from './routes/calendar';
import requestTemplateRoutes from './routes/requestTemplate';
import { attachTranscribeWebSocket } from './ws/transcribe';
import wardRoutes from './routes/ward';
import workspaceRoutes from './routes/workspaces';
// Conversion scheduler disabled — was running in background for txt→docx→pdf
// import { startScheduler } from './jobs/scheduler';

async function startServer(): Promise<void> {
  const telemetry = await initTelemetry();

  const app = express();

  // Heroku terminates TLS; X-Forwarded-Proto / Host must be trusted so req.secure, cookies, and rate limits behave.
  // Use full trust on the platform router (see https://expressjs.com/en/guide/behind-proxies.html).
  // Note: express-rate-limit rejects permissive `true` trustProxy. Trust only the first proxy hop.
  app.set('trust proxy', config.isProduction ? 1 : false);

  // --- Global Rate Limiter ---
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // 300 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });

  // --- AI Route Rate Limiter (stricter) ---
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 AI requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'AI rate limit reached. Please wait before trying again.' },
  });

  // --- Auth Rate Limiter (prevent brute force) ---
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  });

  // --- MIDDLEWARE ---
  app.use(globalLimiter);
  app.use(cors({
    origin: config.isProduction
      ? config.clientUrl
      : (origin, callback) => {
          if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            callback(null, true);
            return;
          }
          if (origin === config.clientUrl) {
            callback(null, true);
            return;
          }
          callback(new Error(`CORS blocked origin: ${origin}`));
        },
    credentials: true,
  }));
  app.use(express.json({ limit: '50mb' }));
  if (telemetry && config.telemetryCaptureInbound) {
    app.use(
      telemetry.createExpressMiddleware({
        includeBodies: true,
        maxBodyBytes: 256 * 1024,
      })
    );
  } else if (telemetry) {
    console.log('[telemetry] Inbound request capture disabled (set HALO_TELEMETRY_CAPTURE_INBOUND=true to enable).');
  }

  // Use persistent session store when DATABASE_URL is set; otherwise fall back to MemoryStore (dev).
  let sessionStore: session.Store | undefined;
  if (config.databaseUrl) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PgSession = require('connect-pg-simple')(session);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Pool } = require('pg') as typeof import('pg');
      const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.isProduction ? { rejectUnauthorized: false } : undefined });
      sessionStore = new PgSession({
        pool,
        tableName: 'session',
        schemaName: 'public',
        createTableIfMissing: true,
      });
    } catch (err) {
      console.error('[session] Could not initialize Postgres session store; falling back to MemoryStore.', err);
    }
  }

  app.use(
    session({
      name: 'halo.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      ...(sessionStore ? { store: sessionStore } : {}),
      proxy: config.isProduction,
      cookie: {
        secure: config.isProduction,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // --- ROUTES ---
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/user-auth', authLimiter, userAuthRoutes);
  app.use('/api/admin', authLimiter, adminRoutes);
  app.use('/api/drive', driveRoutes);
  app.use('/api/ai', aiLimiter, aiRoutes);
  app.use('/api/halo', aiLimiter, haloRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/ward', wardRoutes);
  app.use('/api/request-template', requestTemplateRoutes);
  app.use('/api/workspaces', workspaceRoutes);

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      telemetry: isTelemetryEnabled() ? 'ok' : 'unconfigured',
    });
  });

  // Serve frontend in production
  if (config.isProduction) {
    const staticPath = path.join(__dirname, '../../client/dist');
    app.use(express.static(staticPath));
    // Express 5 / path-to-regexp v8: bare '*' is invalid; use a named wildcard (see path-to-regexp migration).
    app.get('/{*path}', (_req: Request, res: Response) => {
      res.sendFile('index.html', { root: staticPath });
    });
  }

  // --- Global Error Handler ---
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  });

  const server = http.createServer(app);
  attachTranscribeWebSocket(server);

  server.listen(config.port, () => {
    console.log(`Halo server running on port ${config.port} (${config.isProduction ? 'production' : 'development'})`);
    const templateRoot = config.clinicalTemplateRoot;
    const moOk = fs.existsSync(path.join(templateRoot, MO_TEMPLATES_DIR_NAME));
    const henkOk = fs.existsSync(path.join(templateRoot, HENK_TEMPLATES_DIR_NAME));
    console.log(
      `[config] clinical templates root=${templateRoot} mo=${moOk ? 'ok' : 'MISSING'} henk=${henkOk ? 'ok' : 'MISSING'}`
    );
    if (!config.isProduction) {
      const k = config.geminiApiKey;
      console.log(
        `[config] GEMINI_API_KEY ${k ? `loaded (${k.length} chars, starts with ${k.slice(0, 4)}…)` : 'MISSING — AI routes will fail'}`
      );
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received — shutting down`);
    await shutdownTelemetry();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void startServer().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
