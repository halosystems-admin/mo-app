import dotenv from 'dotenv';

dotenv.config();

// --- Required Environment Variables ---
const REQUIRED_ENV = ['GEMINI_API_KEY', 'SESSION_SECRET'] as const;

// We require at least one OAuth provider to be configured.
const missingGoogle = !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET;
const missingMicrosoft = !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET;

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

if (missingGoogle && missingMicrosoft) {
  console.error('Missing OAuth configuration: either Google or Microsoft must be set.');
  process.exit(1);
}

// --- Validated Config Export ---
export const config = {
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

  // Microsoft OAuth (Graph)
  msTenantId: process.env.MS_TENANT_ID || '',
  msClientId: process.env.MS_CLIENT_ID || '',
  msClientSecret: process.env.MS_CLIENT_SECRET || '',
  // Microsoft SharePoint (optional, used when microsoftStorageMode=sharepoint)
  msSharePointSiteId: process.env.MS_SHAREPOINT_SITE_ID || '',
  msSharePointDriveId: process.env.MS_SHAREPOINT_DRIVE_ID || '',

  // AI
  geminiApiKey: process.env.GEMINI_API_KEY!,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',

  // Session
  sessionSecret: process.env.SESSION_SECRET!,

  // Server
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // URLs
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  productionUrl: process.env.PRODUCTION_URL || '',

  // Drive API
  driveApi: 'https://www.googleapis.com/drive/v3',
  uploadApi: 'https://www.googleapis.com/upload/drive/v3',

  // Google Calendar API
  calendarApi: 'https://www.googleapis.com/calendar/v3',
  bookingsCalendarId: process.env.BOOKINGS_CALENDAR_ID || 'primary',

  // Halo Functions API
  haloApiBaseUrl: process.env.HALO_API_BASE_URL || 'https://halo-functions-75316778879.africa-south1.run.app',
  haloUserId: process.env.HALO_USER_ID || '00b70e6e-26e5-422c-bf1e-ea51c658c55c',
  // Mobile app: fixed user/template for dictation flow (Mo Patel: same user, script template)
  haloMobileUserId: process.env.HALO_MOBILE_USER_ID || '00b70e6e-26e5-422c-bf1e-ea51c658c55c',
  haloMobileTemplateId: process.env.HALO_MOBILE_TEMPLATE_ID || 'script',

  // Template request email (optional)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@halo.africa',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
} as const;
