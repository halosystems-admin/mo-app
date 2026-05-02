import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireUser } from '../middleware/requireUser';
import { acceptInvite, findUserByEmail, normalizeEmail, updateLastLogin, verifyPassword } from '../services/userStore';

/** Persist session before responding so the next request (e.g. /api/drive/patients) sees userId. */
function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

const router = Router();

// Brute-force protection for password login and invite acceptance
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.use(limiter);

router.post('/login', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  try {
    const user = await findUserByEmail(email);
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const ok = await verifyPassword(user, password);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    req.session.userId = user.id;
    await updateLastLogin(user.id);
    await saveSession(req);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        haloUserId: user.halo_user_id,
        defaultWardColumnId: user.default_ward_column_id ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed.';
    res.status(500).json({ error: msg });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.json({ signedIn: false });
    return;
  }
  await requireUser(req, res, () => {
    const u = req.appUser!;
    res.json({
      signedIn: true,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        haloUserId: u.haloUserId,
        defaultWardColumnId: u.defaultWardColumnId,
      },
    });
  });
});

router.get('/invite/:token', async (req: Request, res: Response) => {
  const token = typeof req.params.token === 'string' ? req.params.token.trim() : '';
  if (!token) {
    res.status(400).json({ error: 'Missing invite token.' });
    return;
  }
  try {
    const { getInviteByToken } = await import('../services/userStore');
    const inv = await getInviteByToken(token);
    if (!inv) {
      res.status(404).json({ error: 'Invite not found.' });
      return;
    }
    if (inv.accepted_at) {
      res.status(400).json({ error: 'Invite already used.' });
      return;
    }
    if (Date.now() > Date.parse(inv.expires_at)) {
      res.status(400).json({ error: 'Invite expired.' });
      return;
    }
    res.json({
      invite: {
        email: inv.email,
        role: inv.role,
        firstName: inv.first_name,
        lastName: inv.last_name,
        haloUserId: inv.halo_user_id,
        expiresAt: inv.expires_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load invite.';
    res.status(500).json({ error: msg });
  }
});

router.post('/accept-invite', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
  const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';
  if (!token || !password || password.length < 8 || !firstName || !lastName) {
    res.status(400).json({ error: 'First name, last name, and a password (8+ chars) are required.' });
    return;
  }
  try {
    const result = await acceptInvite({ rawToken: token, password, firstName, lastName });
    req.session.userId = result.userId;
    await saveSession(req);
    res.json({
      success: true,
      user: {
        id: result.userId,
        email: result.email,
        role: result.role,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invite acceptance failed.';
    res.status(400).json({ error: msg });
  }
});

export default router;

