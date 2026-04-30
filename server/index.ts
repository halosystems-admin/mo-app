import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import path from 'path';
import http from 'http';
import { config } from './config';
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
// Conversion scheduler disabled — was running in background for txt→docx→pdf
// import { startScheduler } from './jobs/scheduler';

const app = express();

// Heroku terminates TLS; X-Forwarded-Proto / Host must be trusted so req.secure, cookies, and rate limits behave.
// Use full trust on the platform router (see https://expressjs.com/en/guide/behind-proxies.html).
app.set('trust proxy', true);

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
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

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

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
  if (!config.isProduction) {
    const k = config.geminiApiKey;
    console.log(
      `[config] GEMINI_API_KEY ${k ? `loaded (${k.length} chars, starts with ${k.slice(0, 4)}…)` : 'MISSING — AI routes will fail'}`
    );
  }
});
