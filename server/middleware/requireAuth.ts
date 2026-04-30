import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { requireUser } from './requireUser';
import { getSharedMicrosoftTokens } from '../services/sharedOauth';

// Extend express-session to include our custom fields
declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    userEmail?: string;
    provider?: 'google' | 'microsoft';
    oauthState?: string;
    microsoftStorageMode?: 'onedrive' | 'sharepoint';
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // App login is always required first.
  await requireUser(req, res, async () => {
    // Ensure we have a valid shared provider token (Mo's OneDrive). All app users share it.
    // Desktop behavior is preserved because downstream routes still read req.session.accessToken/provider.
    try {
      const shared = await getSharedMicrosoftTokens();
      req.session.provider = 'microsoft';
      req.session.accessToken = shared.accessToken;
      req.session.refreshToken = shared.refreshToken;
      req.session.tokenExpiry = shared.tokenExpiryMs ?? undefined;
      req.session.userEmail = req.appUser?.email;
      // Default storage mode is OneDrive (Mo's account). SharePoint mode remains available via config/env.
      if (!req.session.microsoftStorageMode) req.session.microsoftStorageMode = 'onedrive';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Shared OneDrive is not connected.';
      res.status(503).json({ error: msg });
      return;
    }

    // Check if token has expired and refresh if possible (Microsoft only now).
    // This is defensive; shared token refresh normally happens in getSharedMicrosoftTokens().
    if (req.session.tokenExpiry && Date.now() >= req.session.tokenExpiry) {
      if (!req.session.refreshToken) {
        res.status(503).json({ error: 'Shared OneDrive session expired. Admin must reconnect.' });
        return;
      }
      try {
        const tokenResponse = await fetch(
          `https://login.microsoftonline.com/${config.msTenantId}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: config.msClientId,
              client_secret: config.msClientSecret,
              refresh_token: req.session.refreshToken ?? '',
              grant_type: 'refresh_token',
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
          res.status(503).json({ error: tokens.error_description || tokens.error || 'Shared OneDrive refresh failed.' });
          return;
        }
        req.session.accessToken = tokens.access_token;
        req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;
        if (tokens.refresh_token) req.session.refreshToken = tokens.refresh_token;
      } catch {
        res.status(503).json({ error: 'Failed to refresh shared OneDrive token.' });
        return;
      }
    }

    next();
  });
};
