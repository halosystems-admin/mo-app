import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

const getRedirectUri = (): string => {
  if (config.isProduction) {
    return `${config.productionUrl}/api/auth/callback`;
  }
  return `http://localhost:${config.port}/api/auth/callback`;
};

router.get('/login-url', (req: Request, res: Response) => {
  // Provider selection happens client-side; backend supports both.
  const provider = (typeof req.query.provider === 'string' ? req.query.provider : 'google') as
    | 'google'
    | 'microsoft';
  const storageMode =
    typeof req.query.storageMode === 'string' && (req.query.storageMode === 'onedrive' || req.query.storageMode === 'sharepoint')
      ? (req.query.storageMode as 'onedrive' | 'sharepoint')
      : undefined;

  if (provider === 'google') {
    if (!config.googleClientId) {
      res.status(500).json({ error: 'Server misconfigured: missing Google Client ID.' });
      return;
    }

    const scopes = [
      // Full Drive access for patient folders and files
      'https://www.googleapis.com/auth/drive',
      // Read/write access for bookings calendar events (two-way sync)
      'https://www.googleapis.com/auth/calendar.events',
      'openid',
      'email',
      'profile',
    ].join(' ');

    const redirectUri = getRedirectUri();

    const state = crypto.randomUUID();
    req.session.oauthState = state;
    req.session.provider = 'google';

    const url =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      `client_id=${config.googleClientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    res.json({ url });
    return;
  }

  if (provider === 'microsoft') {
    if (!config.msTenantId) {
      res.status(500).json({ error: 'Server misconfigured: missing Microsoft tenant id.' });
      return;
    }
    if (!config.msClientId) {
      res.status(500).json({ error: 'Server misconfigured: missing Microsoft Client ID.' });
      return;
    }

    const scopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      // Storage
      'Files.ReadWrite',
      // SharePoint (when using fixed SharePoint targets)
      'Sites.ReadWrite.All',
      // Calendar (bookings feature moved to Microsoft Graph)
      'Calendars.ReadWrite',
      // Some environments require explicit access to user profile
      'User.Read',
    ].join(' ');

    const redirectUri = getRedirectUri();

    const state = crypto.randomUUID();
    req.session.oauthState = state;
    req.session.provider = 'microsoft';
    if (storageMode) req.session.microsoftStorageMode = storageMode;

    // Avoid prompt=consent on every login: it re-opens the consent UI and, with admin-only
    // scopes (e.g. Sites.ReadWrite.All), tenants often show "Need admin approval" even after
    // admin consent was granted. select_account still lets users pick the right account.
    const url =
      `https://login.microsoftonline.com/${config.msTenantId}/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(config.msClientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&prompt=select_account` +
      `&state=${encodeURIComponent(state)}`;

    res.json({ url });
    return;
  }

  res.status(400).json({ error: 'Unsupported provider.' });
});

router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  // Entra admin-consent flow redirects here with admin_consent=True (no `code`).
  // https://learn.microsoft.com/entra/identity-platform/v2-admin-consent
  const adminConsentRaw = req.query.admin_consent;
  const adminConsentFlag = Array.isArray(adminConsentRaw) ? adminConsentRaw[0] : adminConsentRaw;
  if (adminConsentFlag === 'True' || adminConsentFlag === 'true') {
    res.redirect(`${config.clientUrl}?admin_consent=ok`);
    return;
  }

  const oauthErrRaw = req.query.error;
  const oauthError = Array.isArray(oauthErrRaw) ? oauthErrRaw[0] : oauthErrRaw;
  if (!code && typeof oauthError === 'string') {
    const descRaw = req.query.error_description;
    const descPart = Array.isArray(descRaw) ? descRaw[0] : descRaw;
    const desc = typeof descPart === 'string' ? descPart : oauthError;
    res.redirect(`${config.clientUrl}?auth_error=${encodeURIComponent(desc)}`);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing or invalid authorization code.' });
    return;
  }

  try {
    const redirectUri = getRedirectUri();

    const expectedState = req.session.oauthState;
    if (!state || typeof state !== 'string' || !expectedState || state !== expectedState) {
      res.status(400).json({ error: 'OAuth state mismatch.' });
      return;
    }

    const provider = req.session.provider ?? 'google';

    if (provider === 'google') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (tokens.error || !tokens.access_token) {
        console.error('Token exchange error:', tokens);
        res.status(400).json({ error: tokens.error_description || 'Token exchange failed.' });
        return;
      }

      // Store tokens in session
      req.session.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        req.session.refreshToken = tokens.refresh_token;
      }
      req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;

      // Fetch user info
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = (await userInfoRes.json()) as { email?: string };
      req.session.userEmail = user.email;

      console.log(`User signed in: ${user.email}`);

      res.redirect(config.clientUrl);
      return;
    }

    if (provider === 'microsoft') {
      const tenantId = config.msTenantId;
      if (!tenantId) throw new Error('Microsoft tenant id missing.');
      const msClientId = config.msClientId;
      const msClientSecret = config.msClientSecret;
      if (!msClientId || !msClientSecret) throw new Error('Microsoft client credentials missing.');

      // Microsoft token endpoint requires application/x-www-form-urlencoded (not JSON)
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: msClientId,
            client_secret: msClientSecret,
            code: code!,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        }
      );

      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (!tokenResponse.ok || tokens.error || !tokens.access_token) {
        console.error('Microsoft token exchange error:', tokens);
        res.status(400).json({ error: tokens.error_description || 'Token exchange failed.' });
        return;
      }

      req.session.accessToken = tokens.access_token;
      if (tokens.refresh_token) req.session.refreshToken = tokens.refresh_token;
      req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;

      // Fetch user profile
      const userInfoRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = (await userInfoRes.json()) as { mail?: string; userPrincipalName?: string };
      req.session.userEmail = user.mail || user.userPrincipalName;

      console.log(`User signed in (Microsoft): ${req.session.userEmail}`);

      res.redirect(config.clientUrl);
      return;
    }

    res.status(400).json({ error: 'Unsupported provider.' });
  } catch (err) {
    console.error('Auth callback error:', err);
    res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

router.get('/me', (req: Request, res: Response) => {
  if (req.session.accessToken) {
    res.json({ signedIn: true, email: req.session.userEmail });
  } else {
    res.json({ signedIn: false });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
