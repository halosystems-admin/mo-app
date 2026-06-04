import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../../shared/types';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { renderInlineMarkdown } from '../utils/formatting';

export type ChatSlashOption = {
  value: string;
  label: string;
  description?: string;
  group: 'templates' | 'patient-notes';
};

interface PatientChatProps {
  patientName: string;
  chatMessages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  chatLoading: boolean;
  onSendChat: () => void;
  slashOptions?: ChatSlashOption[];
  generatedDocument?: { name: string; url: string; fileId?: string } | null;
  onDismissGeneratedDocument?: () => void;
}

export const PatientChat: React.FC<PatientChatProps> = ({
  patientName,
  chatMessages,
  chatInput,
  onChatInputChange,
  chatLoading,
  onSendChat,
  slashOptions = [],
  generatedDocument,
  onDismissGeneratedDocument,
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        slashMenuRef.current.blur?.();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const referenceMatch = chatInput.match(/(?:^|\s)([\/@])([a-z0-9_-]*)$/i);
  const referenceTrigger = referenceMatch?.[1] ?? '/';
  const referenceQuery = (referenceMatch?.[2] ?? '').toLowerCase();
  const filteredSlashOptions =
    referenceMatch
      ? slashOptions.filter((option) => {
          if (!referenceQuery) return true;
          return (
            option.value.toLowerCase().includes(referenceQuery) ||
            option.label.toLowerCase().includes(referenceQuery) ||
            option.description?.toLowerCase().includes(referenceQuery)
          );
        })
      : [];

  const groupedSlashOptions = filteredSlashOptions.reduce<Record<'templates' | 'patient-notes', ChatSlashOption[]>>(
    (groups, option) => {
      groups[option.group].push(option);
      return groups;
    },
    { templates: [], 'patient-notes': [] }
  );

  const insertSlashOption = (option: ChatSlashOption) => {
    const nextValue = chatInput.replace(/(?:^|\s)([\/@])([a-z0-9_-]*)$/i, (full) => {
      const leadingSpace = full.startsWith(' ') ? ' ' : '';
      return `${leadingSpace}${referenceTrigger}${option.value} `;
    });
    onChatInputChange(nextValue);
  };

  const generatedDocumentOpenHref =
    generatedDocument?.fileId
      ? `/api/drive/files/${encodeURIComponent(generatedDocument.fileId)}/preview-docx-pdf`
      : generatedDocument?.url;

  return (
    <div className="flex min-h-[50dvh] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm max-md:min-h-0">
      <div className="bg-gradient-to-r from-teal-50 to-teal-100 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <MessageCircle size={16} className="text-teal-600" />
        <span className="text-sm font-bold text-teal-800 uppercase tracking-wider">Ask HALO</span>
      </div>

      {generatedDocument ? (
        <div className="border-b border-slate-100 bg-emerald-50/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800">Document generated</p>
              <p className="truncate text-sm text-emerald-700">{generatedDocument.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={generatedDocumentOpenHref}
                target="_blank"
                rel="noreferrer"
                className="halo-touch-min inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Open
              </a>
              {onDismissGeneratedDocument ? (
                <button
                  type="button"
                  onClick={onDismissGeneratedDocument}
                  className="halo-touch-min rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 [-webkit-overflow-scrolling:touch] max-md:px-3 max-md:py-3">
        {chatMessages.length === 0 && !chatLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mb-4">
              <MessageCircle size={28} className="text-teal-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-700 mb-1">Ask HALO anything</h3>
            <p className="text-sm text-slate-400 max-w-sm">
              <span className="font-semibold text-slate-500">{patientName}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {['Summarize recent notes', 'Any abnormal lab results?', 'What medications are listed?'].map((q) => (
                <button
                  key={q}
                  onClick={() => onChatInputChange(q)}
                  className="halo-touch-min rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((msg, idx) => {
          const isLastAssistantStreaming =
            msg.role === 'assistant' &&
            idx === chatMessages.length - 1 &&
            chatLoading &&
            !msg.content;

          return (
            <div key={`${msg.timestamp}-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-teal-600 text-white rounded-br-md'
                    : 'bg-slate-100 border border-slate-200 text-slate-800 rounded-bl-md'
                }`}
              >
                {msg.role === 'assistant' && (
                  <span className="mb-1 block text-sm font-bold uppercase tracking-wide text-teal-600">HALO</span>
                )}
                <div className="text-sm whitespace-pre-wrap break-words">
                  {msg.content.split('\n').map((line, li) => (
                    <span key={li}>
                      {li > 0 && <br />}
                      {renderInlineMarkdown(line)}
                    </span>
                  ))}
                  {isLastAssistantStreaming && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-teal-500 animate-pulse" />
                  )}
                </div>
                {!isLastAssistantStreaming && (
                  <span
                    className={`mt-1 block text-sm ${msg.role === 'user' ? 'text-teal-200' : 'text-slate-400'}`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {chatLoading &&
          !(chatMessages.length > 0 && chatMessages[chatMessages.length - 1]?.role === 'assistant' && chatMessages[chatMessages.length - 1]?.content) && (
            <div className="flex justify-start">
              <div className="bg-slate-100 border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
                <span className="mb-1 block text-sm font-bold uppercase tracking-wide text-teal-600">HALO</span>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-500 italic animate-pulse">(HALO is thinking...)</span>
                    <span className="flex gap-0.5">
                      <span
                        className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

        <div ref={chatEndRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-3 max-md:px-2 max-md:pt-2 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="relative flex gap-2" ref={slashMenuRef}>
          {referenceMatch && filteredSlashOptions.length > 0 ? (
            <div className="absolute bottom-full left-0 right-14 z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg max-md:right-0 max-md:max-h-52">
              {(['templates', 'patient-notes'] as const).map((groupKey) => {
                const options = groupedSlashOptions[groupKey];
                if (options.length === 0) return null;
                return (
                  <div key={groupKey}>
                    <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {groupKey === 'templates' ? 'Templates' : 'Patient Notes'}
                    </div>
                    {options.map((option) => (
                      <button
                        key={`${groupKey}-${option.value}`}
                        type="button"
                        onClick={() => insertSlashOption(option)}
                        className="halo-touch-min flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-teal-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-800">{referenceTrigger}{option.value}</div>
                          {option.description ? (
                            <div className="truncate text-xs text-slate-500">{option.description}</div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-xs text-teal-700">{option.label}</div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && referenceMatch) {
                onChatInputChange(chatInput.replace(/(?:^|\s)([\/@])([a-z0-9_-]*)$/i, ''));
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendChat();
              }
            }}
            placeholder="Ask a question about this patient..."
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none max-md:min-w-0"
            disabled={chatLoading}
          />
          <button
            type="button"
            onClick={onSendChat}
            disabled={chatLoading || !chatInput.trim()}
            className="halo-touch-min shrink-0 rounded-xl bg-teal-600 px-4 py-2.5 text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send"
          >
            {chatLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
