import type { NextFunction, Request, Response } from 'express';
import { requireUser } from './requireUser';

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireUser(req, res, () => {
    if (!req.appUser || req.appUser.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }
    next();
  });
}

