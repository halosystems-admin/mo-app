import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/requireAuth';
import { getStorageAdapter } from '../services/storage';
import type { AdmittedPatientKanban, DoctorDiaryEntry } from '../../shared/types';

const router = Router();
router.use(requireAuth);

function sanitizeDiaryEntry(input: Partial<DoctorDiaryEntry> & { id?: string }): DoctorDiaryEntry | null {
  const date = typeof input.date === 'string' ? input.date.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!date || !title || !body) return null;

  const nowIso = new Date().toISOString();
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : crypto.randomUUID();

  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : nowIso;
  const updatedAt = nowIso;

  return {
    id,
    date: date.slice(0, 25),
    title: title.slice(0, 200),
    body: body.slice(0, 200000),
    createdAt,
    updatedAt,
  };
}

router.get('/diary', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;
    const { entries } = await adapter.getDoctorDiary({ token, microsoftStorageMode });
    res.json({ entries });
  } catch (err) {
    console.error('[Ward] get diary error:', err);
    res.status(500).json({ error: 'Failed to load diary entries.' });
  }
});

router.post('/diary', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { entry, entries } = req.body as {
      entry?: Partial<DoctorDiaryEntry>;
      entries?: Array<Partial<DoctorDiaryEntry>>;
    };

    const inputEntries = Array.isArray(entries)
      ? entries
      : entry
        ? [entry]
        : [];

    if (inputEntries.length === 0) {
      res.status(400).json({ error: 'Provide an entry or entries array.' });
      return;
    }

    const { entries: current } = await adapter.getDoctorDiary({ token, microsoftStorageMode });
    const currentById = new Map(current.map((e) => [e.id, e] as const));

    const nowIso = new Date().toISOString();
    const next: DoctorDiaryEntry[] = [];

    for (const raw of inputEntries) {
      const sanitized = sanitizeDiaryEntry(raw);
      if (!sanitized) continue;

      const existing = currentById.get(sanitized.id);
      if (existing) {
        next.push({
          ...existing,
          date: sanitized.date,
          title: sanitized.title,
          body: sanitized.body,
          updatedAt: nowIso,
        });
      } else {
        next.push(sanitized);
      }
    }

    // Merge updates into current list
    const updatedById = new Map(current.map((e) => [e.id, e] as const));
    for (const u of next) updatedById.set(u.id, u);
    const merged = Array.from(updatedById.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    await adapter.saveDoctorDiary({ token, microsoftStorageMode, entries: merged });
    res.json({ entries: merged });
  } catch (err) {
    console.error('[Ward] save diary error:', err);
    res.status(500).json({ error: 'Failed to save diary entries.' });
  }
});

router.get('/kanban', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;
    const { kanban } = await adapter.getDoctorKanban({ token, microsoftStorageMode });
    res.json({ kanban });
  } catch (err) {
    console.error('[Ward] get kanban error:', err);
    res.status(500).json({ error: 'Failed to load ward kanban.' });
  }
});

router.post('/kanban', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { kanban } = req.body as { kanban?: AdmittedPatientKanban[] };
    if (!Array.isArray(kanban)) {
      res.status(400).json({ error: 'kanban array is required.' });
      return;
    }

    const validBoardColumns = new Set([
      'icu',
      'f',
      's',
      'm',
      'paeds',
      'ed',
      'labour',
    ]);

    const safe: AdmittedPatientKanban[] = kanban
      .filter((p) => p && typeof p === 'object')
      .map((p) => {
        const patientId = typeof p.patientId === 'string' ? p.patientId : '';
        const admitted = Boolean((p as any).admitted);
        let bcRaw = (p as any).boardColumn;
        if (bcRaw === 'other') bcRaw = 'm';
        const boardColumn =
          typeof bcRaw === 'string' && validBoardColumns.has(bcRaw) ? bcRaw : undefined;
        const coRaw = (p as any).columnOrder;
        const columnOrder =
          typeof coRaw === 'number' && Number.isFinite(coRaw)
            ? Math.max(0, Math.min(999, Math.floor(coRaw)))
            : undefined;
        const tagsRaw = (p as any).tags;
        const tags = Array.isArray(tagsRaw)
          ? (tagsRaw as unknown[])
              .filter((t) => typeof t === 'string')
              .map((t) => (t as string).trim().toLowerCase().slice(0, 40))
              .filter(Boolean)
              .filter((t, i, a) => a.indexOf(t) === i)
              .slice(0, 20)
          : undefined;
        const todosRaw = Array.isArray((p as any).todos) ? (p as any).todos : [];
        const todos = todosRaw
          .filter((t: any) => t && typeof t === 'object')
          .slice(0, 200)
          .map((t: any) => ({
            id: typeof t.id === 'string' && t.id.trim() ? t.id.trim() : crypto.randomUUID(),
            title: typeof t.title === 'string' ? t.title.trim().slice(0, 200) : 'Untitled task',
            status: typeof t.status === 'string' ? t.status : 'To do',
            order: typeof t.order === 'number' ? t.order : undefined,
            createdAt: typeof t.createdAt === 'string' ? t.createdAt : undefined,
            updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : undefined,
          }));

        const bedRaw = (p as any).bed;
        const bed =
          typeof bedRaw === 'string' && bedRaw.trim() ? bedRaw.trim().slice(0, 40) : undefined;
        const wlRaw = (p as any).wardLabel;
        const wardLabel =
          typeof wlRaw === 'string' && wlRaw.trim() ? wlRaw.trim().slice(0, 80) : undefined;
        const notesRaw = (p as any).notes;
        const notes =
          typeof notesRaw === 'string' && notesRaw.trim() ? notesRaw.trim().slice(0, 4000) : undefined;

        return patientId
          ? {
              patientId,
              admitted,
              todos,
              ...(boardColumn ? { boardColumn } : {}),
              ...(columnOrder !== undefined ? { columnOrder } : {}),
              ...(tags && tags.length ? { tags } : {}),
              ...(bed ? { bed } : {}),
              ...(wardLabel ? { wardLabel } : {}),
              ...(notes ? { notes } : {}),
            }
          : null;
      })
      .filter((p): p is AdmittedPatientKanban => p !== null);

    await adapter.saveDoctorKanban({ token, microsoftStorageMode, kanban: safe });
    res.json({ kanban: safe });
  } catch (err) {
    console.error('[Ward] save kanban error:', err);
    res.status(500).json({ error: 'Failed to save ward kanban.' });
  }
});

export default router;

