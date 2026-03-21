import { config } from '../../config';
import type { CalendarAttachment, CalendarEvent } from '../../../shared/types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const CALENDAR_REQUEST_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(
  url: string,
  token: string,
  options: RequestInit = {},
  timeoutMs: number = CALENDAR_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

type ListEventsOptions = {
  timeMin: string;
  timeMax: string;
  timeZone?: string;
};

type CreateOrUpdateEventData = {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  location?: string;
  patientId?: string;
  attachmentFileIds?: string[];
};

const EXT_NAMESPACE = 'halo.app';
const EXT_PATIENT_ID = 'patientId';
const EXT_ATTACHMENT_IDS = 'haloAttachmentFileIds';

type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isCancelled?: boolean;
  singleValueExtendedProperties?: Array<{ id: { namespace: string; name: string }; value: string }>;
};

function getExtendedProp(
  item: GraphEvent,
  name: string
): string | undefined {
  return item.singleValueExtendedProperties?.find((p) => p.id.namespace === EXT_NAMESPACE && p.id.name === name)?.value;
}

function normaliseGraphEvent(item: GraphEvent): CalendarEvent | null {
  if (item.isCancelled) return null;
  const startIso = item.start?.dateTime ? new Date(item.start.dateTime).toISOString() : null;
  const endIso = item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null;
  if (!startIso || !endIso) return null;

  const patientId = getExtendedProp(item, EXT_PATIENT_ID);

  const attachmentIdsRaw = getExtendedProp(item, EXT_ATTACHMENT_IDS) || '';
  const attachmentFileIds = attachmentIdsRaw
    ? attachmentIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const attachments: CalendarAttachment[] | undefined =
    attachmentFileIds.length > 0
      ? attachmentFileIds.map((fileId) => ({
          fileId,
        }))
      : undefined;

  return {
    id: item.id,
    start: startIso,
    end: endIso,
    title: item.subject || '(No title)',
    description: item.bodyPreview || '',
    location: item.location?.displayName || '',
    patientId,
    attachments,
    // We'll enrich attachments into name/url/mimeType in a later step (calendar-attachment-url-resolution).
    extendedProps: {
      patientId: patientId || '',
    },
  };
}

export async function listEvents(token: string, { timeMin, timeMax }: ListEventsOptions): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let url = `${GRAPH_BASE}/me/calendarView?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}`;

  // Select extended props so patientId/attachment ids are included.
  // calendarView doesn't support $select of extendedProperties everywhere, but Graph returns singleValueExtendedProperties when requested.
  url += `&$top=50&$orderby=start/dateTime&$select=id,subject,bodyPreview,location,start,end,singleValueExtendedProperties,isCancelled`;

  while (url) {
    const res = await fetchWithTimeout(url, token, {}, CALENDAR_REQUEST_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Calendar ${res.status}] Failed to fetch events: ${text || res.statusText}`);
    }

    const data = (await res.json()) as {
      value?: GraphEvent[];
      '@odata.nextLink'?: string;
    };

    for (const item of data.value || []) {
      const mapped = normaliseGraphEvent(item);
      if (mapped) events.push(mapped);
    }

    url = data['@odata.nextLink'] || '';
  }

  return events;
}

export async function listTodayEvents(token: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return listEvents(token, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
  });
}

function buildEventBody(data: CreateOrUpdateEventData) {
  const body: any = {};
  if (data.title !== undefined) body.subject = data.title;
  if (data.description !== undefined) body.body = { contentType: 'text', content: data.description };
  if (data.location !== undefined) body.location = { displayName: data.location };
  if (data.start) body.start = { dateTime: data.start, ...(data.timeZone ? { timeZone: data.timeZone } : {}) };
  if (data.end) body.end = { dateTime: data.end, ...(data.timeZone ? { timeZone: data.timeZone } : {}) };

  const singleValueExtendedProperties: Array<{ id: { namespace: string; name: string }; value: string }> = [];
  if (data.patientId) {
    singleValueExtendedProperties.push({
      id: { namespace: EXT_NAMESPACE, name: EXT_PATIENT_ID },
      value: data.patientId,
    });
  }
  if (data.attachmentFileIds && data.attachmentFileIds.length > 0) {
    singleValueExtendedProperties.push({
      id: { namespace: EXT_NAMESPACE, name: EXT_ATTACHMENT_IDS },
      value: data.attachmentFileIds.join(','),
    });
  }

  if (singleValueExtendedProperties.length > 0) {
    body.singleValueExtendedProperties = singleValueExtendedProperties;
  }

  return body;
}

export async function createEvent(
  token: string,
  data: Required<Pick<CreateOrUpdateEventData, 'title' | 'start' | 'end'>> &
    Omit<CreateOrUpdateEventData, 'title' | 'start' | 'end'>
): Promise<CalendarEvent> {
  const url = `${GRAPH_BASE}/me/events?supportsAttachments=true`;

  const res = await fetchWithTimeout(url, token, {
    method: 'POST',
    body: JSON.stringify(buildEventBody(data)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Calendar ${res.status}] Failed to create event: ${text || res.statusText}`);
  }

  const created = (await res.json()) as GraphEvent;
  const mapped = normaliseGraphEvent(created);
  if (!mapped) throw new Error('Created event is missing start or end time.');
  return mapped;
}

export async function updateEvent(
  token: string,
  eventId: string,
  data: CreateOrUpdateEventData
): Promise<CalendarEvent> {
  const url = `${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`;

  const res = await fetchWithTimeout(url, token, {
    method: 'PATCH',
    body: JSON.stringify(buildEventBody(data)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Calendar ${res.status}] Failed to update event: ${text || res.statusText}`);
  }

  const updated = (await res.json()) as GraphEvent;
  const mapped = normaliseGraphEvent(updated);
  if (!mapped) throw new Error('Updated event is missing start or end time.');
  return mapped;
}

export async function deleteEvent(token: string, eventId: string): Promise<void> {
  const url = `${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`;
  const res = await fetchWithTimeout(url, token, { method: 'DELETE' });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Calendar ${res.status}] Failed to delete event: ${text || res.statusText}`);
  }
}

export async function getEventById(token: string, eventId: string): Promise<CalendarEvent | null> {
  const url = `${GRAPH_BASE}/me/events/${encodeURIComponent(
    eventId
  )}?$select=id,subject,bodyPreview,location,start,end,singleValueExtendedProperties,isCancelled`;

  const res = await fetchWithTimeout(url, token, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Calendar ${res.status}] Failed to fetch event: ${text || res.statusText}`);
  }

  const event = (await res.json()) as GraphEvent;
  return normaliseGraphEvent(event);
}

export async function updateEventAttachments(
  token: string,
  eventId: string,
  attachmentFileIds: string[]
): Promise<CalendarEvent> {
  // We keep patientId unchanged by fetching it from extended props.
  const existing = await getEventById(token, eventId);
  if (!existing) throw new Error('Event not found.');

  return updateEvent(token, eventId, {
    attachmentFileIds,
    patientId: existing.patientId,
  });
}

