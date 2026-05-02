import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';

export type AppUserRole = 'admin' | 'user';

export type AppUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AppUserRole;
  haloUserId: string | null;
  isActive: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __haloAppUserTypes: unknown;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    appUser?: AppUser;
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    return;
  }
  if (!isSupabaseAdminConfigured()) {
    res.status(500).json({ error: 'Server misconfigured: Supabase is not configured.' });
    return;
  }
  const sb = getSupabaseAdminClient();
  if (!sb) {
    res.status(500).json({ error: 'Server misconfigured: Supabase admin client unavailable.' });
    return;
  }
  const { data, error } = await sb
    .from('app_users')
    .select('id,email,first_name,last_name,role,halo_user_id,is_active')
    .eq('id', userId)
    .maybeSingle<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      role: AppUserRole;
      halo_user_id: string | null;
      is_active: boolean;
    }>();

  if (error || !data) {
    res.status(401).json({ error: 'Session invalid. Please sign in again.' });
    return;
  }
  if (!data.is_active) {
    res.status(403).json({ error: 'Account disabled.' });
    return;
  }

  req.appUser = {
    id: data.id,
    email: data.email,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    haloUserId: data.halo_user_id,
    isActive: data.is_active,
  };

  next();
}

