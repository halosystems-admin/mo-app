import React, { useCallback, useMemo, useState } from 'react';
import type { CalendarEvent, DriveFile, Patient } from '../../../shared/types';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  Calendar as CalendarIcon,
  Loader2,
  Users,
  Clock,
  Plus,
  X,
} from 'lucide-react';
import {
  fetchEventsInRange,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEventAttachments,
  fetchFilesFirstPage,
  type CalendarEventCreatePayload,
  type CalendarEventUpdatePayload,
} from '../services/api';

interface Props {
  patients: Patient[];
  onSelectPatientFromEvent?: (patientId: string) => void;
  onClose?: () => void;
}

interface EventEditorState {
  id?: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  patientId?: string;
  /** If true, saving requires patientId (used for creating from an empty slot). */
  requirePatient?: boolean;
}

const getBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const findPatientName = (patients: Patient[], id?: string) =>
  id ? patients.find((p) => p.id === id)?.name ?? '' : '';

export const CalendarPage: React.FC<Props> = ({
  patients,
  onSelectPatientFromEvent,
  onClose,
}) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentRange, setCurrentRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<EventEditorState | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<DriveFile[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);

  // Theatre filter for the theatre scheduler view.
  // Empty string means "All theatres".
  const [selectedTheatre, setSelectedTheatre] = useState<string>('');
  const [editorValidationError, setEditorValidationError] = useState<string | null>(null);

  const timeZone = useMemo(getBrowserTimeZone, []);

  const theatreOptions = useMemo(() => {
    const opts = Array.from(new Set(events.map((e) => (e.location || '').trim()).filter(Boolean)));
    opts.sort((a, b) => a.localeCompare(b));
    return opts;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!selectedTheatre) return events;
    return events.filter((e) => (e.location || '').trim() === selectedTheatre);
  }, [events, selectedTheatre]);

  const loadEvents = useCallback(
    async (startIso: string, endIso: string) => {
      setLoading(true);
      try {
        const { events: fetched } = await fetchEventsInRange(
          startIso,
          endIso,
          timeZone
        );
        setEvents(fetched);
        setCurrentRange({ start: startIso, end: endIso });
      } catch {
        // Errors are surfaced via global toast layer in App; keep this silent here.
        setEvents([]);
      }
      setLoading(false);
    },
    [timeZone]
  );

  const handleDatesSet = useCallback(
    (arg: any) => {
      const startIso = arg.start?.toISOString?.() ?? arg.startStr;
      const endIso = arg.end?.toISOString?.() ?? arg.endStr;
      if (startIso && endIso) {
        void loadEvents(startIso, endIso);
      }
    },
    [loadEvents]
  );

  const openCreateEditor = useCallback(
    (start: Date, end: Date) => {
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      setEditorValidationError(null);
      setEditorState({
        title: '',
        start: startIso,
        end: endIso,
        location: selectedTheatre || undefined,
        requirePatient: true,
      });
      setEditorOpen(true);
    },
    [selectedTheatre]
  );

  const openEditEditor = useCallback((ev: CalendarEvent) => {
    setEditorValidationError(null);
    setEditorState({
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      description: ev.description,
      location: ev.location,
      patientId: ev.patientId,
      requirePatient: false,
    });
    setEditorOpen(true);
  }, []);

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorState(null);
    setEditorValidationError(null);
  };

  const handleSaveEditor = async () => {
    if (!editorState) return;
    const { id, title, start, end, description, location, patientId } =
      editorState;
    if (!title.trim() || !start || !end) return;
    if (editorState.requirePatient && !patientId) {
      setEditorValidationError('Patient is required for a new booking.');
      return;
    }

    setSaving(true);
    try {
      const payload: CalendarEventCreatePayload = {
        title: title.trim(),
        start,
        end,
        timeZone,
        description: description?.trim() || undefined,
        location: location?.trim() || undefined,
        patientId: patientId || undefined,
      };

      if (!id) {
        const { event } = await createCalendarEvent(payload);
        setEvents((prev) => [...prev, event]);
      } else {
        const updatePayload: CalendarEventUpdatePayload = payload;
        const { event } = await updateCalendarEvent(id, updatePayload);
        setEvents((prev) =>
          prev.map((e) => (e.id === event.id ? event : e))
        );
      }
      closeEditor();
    } catch {
      // Errors are handled by global ApiError mechanism.
    }
    setSaving(false);
  };

  const handleDeleteFromEditor = async () => {
    if (!editorState?.id) return;
    setSaving(true);
    try {
      await deleteCalendarEvent(editorState.id);
      setEvents((prev) => prev.filter((e) => e.id !== editorState.id));
      closeEditor();
    } catch {
      // Silent; global handler will surface toasts if needed.
    }
    setSaving(false);
  };

  const handleEventClick = useCallback(
    (info: any) => {
      const full: CalendarEvent | undefined =
        info.event.extendedProps?.haloEvent || events.find(
          (e) => e.id === info.event.id
        );

      if (!full) return;

      if (onSelectPatientFromEvent && full.patientId) {
        onSelectPatientFromEvent(full.patientId);
      }

      openEditEditor(full);
    },
    [events, onSelectPatientFromEvent, openEditEditor]
  );

  const openAttachments = async () => {
    if (!editorState?.id || !editorState.patientId) return;
    setAttachmentsOpen(true);
    setAttachmentLoading(true);
    setAttachmentFiles([]);
    setSelectedAttachmentIds([]);
    try {
      const { files } = await fetchFilesFirstPage(editorState.patientId, 100);
      setAttachmentFiles(files);
      const current = events.find((e) => e.id === editorState.id);
      if (current?.attachments && current.attachments.length > 0) {
        setSelectedAttachmentIds(current.attachments.map((a) => a.fileId));
      }
    } catch {
      setAttachmentFiles([]);
    }
    setAttachmentLoading(false);
  };

  const toggleAttachmentSelection = (fileId: string) => {
    setSelectedAttachmentIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const saveAttachments = async () => {
    if (!editorState?.id) return;
    setAttachmentLoading(true);
    try {
      const { event } = await updateCalendarEventAttachments(
        editorState.id,
        selectedAttachmentIds
      );
      setEvents((prev) => prev.map((e) => (e.id === event.id ? event : e)));
      setAttachmentsOpen(false);
    } catch {
      // rely on global error handling
    }
    setAttachmentLoading(false);
  };

  const handleEventDropOrResize = useCallback(
    async (info: any) => {
      const id = info.event.id as string;
      const newStart = info.event.start?.toISOString();
      const newEnd = info.event.end?.toISOString();
      if (!newStart || !newEnd) return;

      try {
        const { event } = await updateCalendarEvent(id, {
          start: newStart,
          end: newEnd,
          timeZone,
        });
        setEvents((prev) =>
          prev.map((e) => (e.id === event.id ? event : e))
        );
      } catch {
        // Revert visual change when API fails
        info.revert();
      }
    },
    [timeZone]
  );

  const fcEvents = useMemo(
    () =>
      filteredEvents.map((ev) => ({
        id: ev.id,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        backgroundColor: ev.color || '#0ea5e9',
        borderColor: ev.color || '#0284c7',
        extendedProps: {
          haloEvent: ev,
          patientName: findPatientName(patients, ev.patientId),
        },
      })),
    [filteredEvents, patients]
  );

  const currentRangeLabel = useMemo(() => {
    if (!currentRange) return '';
    const start = new Date(currentRange.start);
    const end = new Date(currentRange.end);
    const fmt: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    return `${start.toLocaleDateString(undefined, fmt)} – ${end.toLocaleDateString(
      undefined,
      fmt
    )}`;
  }, [currentRange]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-teal-100 flex items-center justify-center">
            <CalendarIcon className="text-teal-600" size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">
              Schedule
            </h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Calendar &middot; {timeZone}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
              <span>Refreshing events…</span>
            </div>
          )}
          {currentRangeLabel && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
              <Clock className="w-3 h-3" />
              <span>{currentRangeLabel}</span>
            </div>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              <X className="w-3 h-3" />
              Close
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 bg-slate-50">
        <div className="max-w-6xl mx-auto h-full px-4 py-4 md:px-6 md:py-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <Users className="w-3.5 h-3.5 text-teal-500" />
                <span>Day / Week / Month</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400">
                  Drag to move &middot; Click to edit
                </span>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                    Theatre
                  </label>
                  <select
                    value={selectedTheatre}
                    onChange={(e) => setSelectedTheatre(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                  >
                    <option value="">All theatres</option>
                    {theatreOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex-1">
              <FullCalendar
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView="timeGridWeek"
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,timeGridDay',
                }}
                height="100%"
                events={fcEvents}
                selectable
                selectMirror
                editable
                eventResizableFromStart
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
                weekends
                nowIndicator
                firstDay={1}
                datesSet={handleDatesSet}
                select={(arg) => openCreateEditor(arg.start, arg.end)}
                eventClick={handleEventClick}
                eventDrop={handleEventDropOrResize}
                eventResize={handleEventDropOrResize}
              />
            </div>
          </div>
        </div>
      </div>

      {editorOpen && editorState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-editor-title"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2
                  id="event-editor-title"
                  className="text-lg font-bold text-slate-800"
                >
                  {editorState.id ? 'Edit booking' : 'New booking'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Quickly schedule sessions, then drag to adjust.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={editorState.title}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev
                    )
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                  placeholder="e.g. Sarah Connor – follow-up"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Starts
                  </label>
                  <input
                    type="datetime-local"
                    value={editorState.start.slice(0, 16)}
                    onChange={(e) =>
                      setEditorState((prev) =>
                        prev
                          ? { ...prev, start: new Date(e.target.value).toISOString() }
                          : prev
                      )
                    }
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Ends
                  </label>
                  <input
                    type="datetime-local"
                    value={editorState.end.slice(0, 16)}
                    onChange={(e) =>
                      setEditorState((prev) =>
                        prev
                          ? { ...prev, end: new Date(e.target.value).toISOString() }
                          : prev
                      )
                    }
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Patient {editorState.requirePatient ? '(required)' : '(optional)'}
                </label>
                <select
                  value={editorState.patientId || ''}
                  onChange={(e) =>
                    {
                      setEditorValidationError(null);
                      setEditorState((prev) =>
                        prev ? { ...prev, patientId: e.target.value || undefined } : prev
                      );
                    }
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                >
                  <option value="" disabled={Boolean(editorState.requirePatient)}>
                    Unlinked booking
                  </option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {editorValidationError && editorState.requirePatient && !editorState.patientId && (
                  <p className="text-xs text-rose-600 mt-1 font-medium">{editorValidationError}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Location
                </label>
                <input
                  type="text"
                  value={editorState.location || ''}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, location: e.target.value } : prev
                    )
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400"
                  placeholder="e.g. Rooms 3B, telehealth"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  value={editorState.description || ''}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, description: e.target.value } : prev
                    )
                  }
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 resize-none"
                  placeholder="Internal notes for this booking…"
                />
              </div>
              {editorState.patientId && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Attachments
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1 flex-1">
                      {events
                        .find((e) => e.id === editorState.id)
                        ?.attachments?.map((att) => (
                          <a
                            key={att.fileId}
                            href={att.url || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700 hover:bg-slate-200"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                            <span className="truncate max-w-[120px]">
                              {att.name || att.fileId}
                            </span>
                          </a>
                        ))}
                      {events.find((e) => e.id === editorState.id)?.attachments
                        ?.length === 0 && (
                        <span className="text-[11px] text-slate-400">
                          No files attached.
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={openAttachments}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-slate-100 hover:bg-slate-800 transition-colors"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
              {editorState.id ? (
                <button
                  type="button"
                  onClick={handleDeleteFromEditor}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 px-3 py-2 rounded-lg hover:bg-rose-50 transition-colors"
                  disabled={saving}
                >
                  Delete booking
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Plus className="w-3 h-3" />
                  New booking
                </span>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  disabled={
                    saving ||
                    !editorState.title.trim() ||
                    (editorState.requirePatient && !editorState.patientId)
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 shadow-sm shadow-teal-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <CalendarIcon className="w-3.5 h-3.5" />
                      Save booking
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {attachmentsOpen && editorState && editorState.patientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Attach files to booking
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose files from the patient&apos;s Drive folder to keep this visit
                  organised.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachmentsOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {attachmentLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                  <span className="text-sm">Loading patient files…</span>
                </div>
              ) : attachmentFiles.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No files found in this patient&apos;s folder yet. Upload notes, labs or
                  reports from the workspace first.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {attachmentFiles.map((file) => {
                    const selected = selectedAttachmentIds.includes(file.id);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => toggleAttachmentSelection(file.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl border text-left text-sm transition-colors ${
                          selected
                            ? 'border-teal-500 bg-teal-50 text-teal-800'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <span className="truncate mr-2">{file.name}</span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            selected ? 'bg-teal-500' : 'bg-slate-300'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
              <span className="text-[11px] text-slate-500">
                {selectedAttachmentIds.length} file
                {selectedAttachmentIds.length === 1 ? '' : 's'} attached
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAttachmentsOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  disabled={attachmentLoading}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={saveAttachments}
                  disabled={attachmentLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 shadow-sm shadow-teal-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {attachmentLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Save attachments
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

