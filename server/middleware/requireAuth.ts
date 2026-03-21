import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

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
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    return;
  }

  // Check if token has expired and refresh if possible
  if (req.session.tokenExpiry && Date.now() >= req.session.tokenExpiry) {
    if (req.session.refreshToken) {
      try {
        const provider = req.session.provider ?? 'google';

        if (provider === 'google') {
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: config.googleClientId,
              client_secret: config.googleClientSecret,
              refresh_token: req.session.refreshToken,
              grant_type: 'refresh_token',
            }),
          });

          const tokens = (await tokenResponse.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            error?: string;
          };

          if (!tokenResponse.ok || tokens.error || !tokens.access_token) {
            req.session.destroy(() => {});
            res.status(401).json({ error: 'Session expired. Please sign in again.' });
            return;
          }

          req.session.accessToken = tokens.access_token;
          req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;
        } else {
          // Microsoft token refresh
          const tenantId = config.msTenantId;
          if (!tenantId) {
            req.session.destroy(() => {});
            res.status(401).json({ error: 'Microsoft provider misconfigured.' });
            return;
          }

          // Microsoft token endpoint requires application/x-www-form-urlencoded (not JSON)
          const tokenResponse = await fetch(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
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
          };

          if (!tokenResponse.ok || tokens.error || !tokens.access_token) {
            req.session.destroy(() => {});
            res.status(401).json({ error: 'Session expired. Please sign in again.' });
            return;
          }

          req.session.accessToken = tokens.access_token;
          req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;
          if (tokens.refresh_token) req.session.refreshToken = tokens.refresh_token;
        }
      } catch {
        req.session.destroy(() => {});
        res.status(401).json({ error: 'Failed to refresh session. Please sign in again.' });
        return;
      }
    } else {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }
  }

  next();
};
