import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import {
  listTodayEvents,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventById,
  updateEventAttachments,
} from '../services/calendar';
import {
  listTodayEvents as listTodayMicrosoftEvents,
  listEvents as listMicrosoftEvents,
  createEvent as createMicrosoftEvent,
  updateEvent as updateMicrosoftEvent,
  deleteEvent as deleteMicrosoftEvent,
  getEventById as getMicrosoftEventById,
  updateEventAttachments as updateMicrosoftEventAttachments,
} from '../services/calendar/microsoftCalendar';
import { fetchAllFilesInFolder, extractTextFromFile } from '../services/drive';
import { generateText } from '../services/gemini';
import { summaryPrompt } from '../utils/prompts';
import { getStorageAdapter } from '../services/storage';

type Provider = 'google' | 'microsoft';

async function enrichEventAttachments(
  token: string,
  provider: Provider,
  events: Array<{
    id: string;
    attachments?: Array<{ fileId?: string; name?: string; url?: string; mimeType?: string }>;
  }>,
  microsoftStorageMode?: 'onedrive' | 'sharepoint'
): Promise<typeof events> {
  const adapter = getStorageAdapter(provider);
  const enrichedEvents = await Promise.all(
    events.map(async (ev) => {
      if (!ev.attachments || ev.attachments.length === 0) return ev;

      const enrichedAttachments = await Promise.all(
        ev.attachments.map(async (att) => {
          if (!att.fileId) return att;

          // If the adapter already resolved metadata, keep it.
          if (att.name && att.url && att.mimeType) return att;

          try {
            const info = await adapter.downloadFileInfo({
              token,
              fileId: att.fileId,
              microsoftStorageMode,
            });

            return {
              ...att,
              name: info.name,
              url: info.viewUrl,
              mimeType: info.mimeType,
            };
          } catch {
            return att;
          }
        })
      );

      return { ...ev, attachments: enrichedAttachments };
    })
  );

  return enrichedEvents;
}

const router = Router();
router.use(requireAuth);

// GET /api/calendar/today — today's bookings from Google Calendar
router.get('/today', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const provider = req.session.provider ?? 'google';
    const events =
      provider === 'microsoft' ? await listTodayMicrosoftEvents(token) : await listTodayEvents(token);
    const enriched = await enrichEventAttachments(
      token,
      provider,
      events,
      req.session.microsoftStorageMode
    );
    res.json({ events: enriched });
  } catch (err) {
    console.error('Calendar today error:', err);
    res.status(500).json({ error: 'Failed to fetch today\u2019s events.' });
  }
});

// GET /api/calendar/events?start=...&end=...&timeZone=...
router.get('/events', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const { start, end, timeZone } = req.query as {
      start?: string;
      end?: string;
      timeZone?: string;
    };

    if (!start || !end) {
      res.status(400).json({ error: 'start and end query parameters are required.' });
      return;
    }

    const provider = req.session.provider ?? 'google';
    const events =
      provider === 'microsoft'
        ? await listMicrosoftEvents(token, { timeMin: start, timeMax: end, timeZone })
        : await listEvents(token, { timeMin: start, timeMax: end, timeZone });
    const enriched = await enrichEventAttachments(
      token,
      provider,
      events,
      req.session.microsoftStorageMode
    );
    res.json({ events: enriched });
  } catch (err) {
    console.error('Calendar events range error:', err);
    res.status(500).json({ error: 'Failed to fetch calendar events.' });
  }
});

// GET /api/calendar/events/:id — fetch a single event
router.get('/events/:id', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const eventId = req.params.id as string;
    const provider = req.session.provider ?? 'google';
    const event =
      provider === 'microsoft' ? await getMicrosoftEventById(token, eventId) : await getEventById(token, eventId);
    if (!event) {
      res.status(404).json({ error: 'Event not found.' });
      return;
    }

    const enriched = await enrichEventAttachments(
      token,
      provider,
      [event as any],
      req.session.microsoftStorageMode
    );
    res.json({ event: enriched[0] });
  } catch (err) {
    console.error('Calendar event fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch calendar event.' });
  }
});

// POST /api/calendar/events — create a new event
router.post('/events', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const {
      title,
      description,
      start,
      end,
      timeZone,
      location,
      patientId,
      attachmentFileIds,
    } = req.body as {
      title?: string;
      description?: string;
      start?: string;
      end?: string;
      timeZone?: string;
      location?: string;
      patientId?: string;
      attachmentFileIds?: string[];
    };

    if (!title || !start || !end) {
      res.status(400).json({ error: 'title, start, and end are required.' });
      return;
    }

    const provider = req.session.provider ?? 'google';
    const event =
      provider === 'microsoft'
        ? await createMicrosoftEvent(token, {
            title,
            description,
            start,
            end,
            timeZone,
            location,
            patientId,
            attachmentFileIds,
          })
        : await createEvent(token, {
      title,
      description,
      start,
      end,
      timeZone,
      location,
      patientId,
      attachmentFileIds,
    });
    const enriched = await enrichEventAttachments(
      token,
      provider,
      [event as any],
      req.session.microsoftStorageMode
    );
    res.status(201).json({ event: enriched[0] });
  } catch (err) {
    console.error('Calendar create event error:', err);
    res.status(500).json({ error: 'Failed to create calendar event.' });
  }
});

// PATCH /api/calendar/events/:id — partial update (time, title, etc.)
router.patch('/events/:id', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const eventId = req.params.id as string;
    const {
      title,
      description,
      start,
      end,
      timeZone,
      location,
      patientId,
      attachmentFileIds,
    } = req.body as {
      title?: string;
      description?: string;
      start?: string;
      end?: string;
      timeZone?: string;
      location?: string;
      patientId?: string;
      attachmentFileIds?: string[];
    };

    const provider = req.session.provider ?? 'google';
    const event =
      provider === 'microsoft'
        ? await updateMicrosoftEvent(token, eventId, {
            title,
            description,
            start,
            end,
            timeZone,
            location,
            patientId,
            attachmentFileIds,
          })
        : await updateEvent(token, eventId, {
            title,
            description,
            start,
            end,
            timeZone,
            location,
            patientId,
            attachmentFileIds,
          });
    const enriched = await enrichEventAttachments(
      token,
      provider,
      [event as any],
      req.session.microsoftStorageMode
    );
    res.json({ event: enriched[0] });
  } catch (err) {
    console.error('Calendar update event error:', err);
    res.status(500).json({ error: 'Failed to update calendar event.' });
  }
});

// DELETE /api/calendar/events/:id — delete/cancel an event
router.delete('/events/:id', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const eventId = req.params.id as string;
    const provider = req.session.provider ?? 'google';
    if (provider === 'microsoft') await deleteMicrosoftEvent(token, eventId);
    else await deleteEvent(token, eventId);
    res.status(204).send();
  } catch (err) {
    console.error('Calendar delete event error:', err);
    res.status(500).json({ error: 'Failed to delete calendar event.' });
  }
});

// POST /api/calendar/events/:id/attachments — update Drive attachments for an event
router.post('/events/:id/attachments', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const eventId = req.params.id as string;
    const { fileIds } = req.body as { fileIds?: string[] };

    if (!fileIds || !Array.isArray(fileIds)) {
      res.status(400).json({ error: 'fileIds array is required.' });
      return;
    }

    const provider = req.session.provider ?? 'google';
    const event =
      provider === 'microsoft'
        ? await updateMicrosoftEventAttachments(token, eventId, fileIds)
        : await updateEventAttachments(token, eventId, fileIds);

    const enriched = await enrichEventAttachments(
      token,
      provider,
      [event as any],
      req.session.microsoftStorageMode
    );
    res.json({ event: enriched[0] });
  } catch (err) {
    console.error('Calendar update attachments error:', err);
    res.status(500).json({ error: 'Failed to update event attachments.' });
  }
});

// POST /api/calendar/prep-note — light prep note for a patient before the visit
router.post('/prep-note', async (req: Request, res: Response) => {
  try {
    const { patientId, patientName } = req.body as {
      patientId?: string;
      patientName?: string;
    };

    if (!patientId || typeof patientId !== 'string') {
      res.status(400).json({ error: 'patientId is required.' });
      return;
    }

    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    // Fetch all files in the patient's folder and build a light context.
    // Note: fetchAllFilesInFolder currently returns { id, name, mimeType } without dates,
    // so we approximate \"recent\" based on name patterns only.
    const sorted = await fetchAllFilesInFolder(token, patientId);

    const recentNotes = sorted.filter(f =>
      /note/i.test(f.name)
    ).slice(0, 2);

    const recentLabs = sorted.filter(f =>
      /lab|blood|result/i.test(f.name)
    ).slice(0, 3);

    const otherFiles = sorted
      .filter(f => !recentNotes.includes(f) && !recentLabs.includes(f))
      .slice(0, 5);

    const chosenFiles = [...recentNotes, ...recentLabs, ...otherFiles];

    let fileContext = chosenFiles
      .map(f => `- ${f.name}`)
      .join('\\n');

    // Try to include short snippets of content for richer prep (small token budget)
    const contentParts: string[] = [];
    for (const file of chosenFiles.slice(0, 5)) {
      try {
        const text = await extractTextFromFile(token, file, 1200);
        if (text.trim()) {
          contentParts.push(`--- ${file.name} ---\\n${text}`);
        }
      } catch {
        // ignore extraction failures; still have filenames
      }
    }

    if (contentParts.length > 0) {
      fileContext += '\\n\\nFile Contents:\\n' + contentParts.join('\\n\\n');
    }

    const safeName = patientName || 'the patient';
    const prepText = await generateText(
      summaryPrompt(safeName, fileContext) +
      '\\n\\nPlease structure this specifically as a concise pre-visit prep note for the clinician, highlighting key history, active problems, medications, allergies, and pending follow-ups.'
    );

    res.json({ prepNote: prepText });
  } catch (err) {
    console.error('Prep note error:', err);
    res.status(500).json({ error: 'Failed to generate prep note.' });
  }
});

export default router;

