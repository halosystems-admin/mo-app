import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../shared/types';
import { ChevronDown, Loader2, Mail, MessageCircle, Send } from 'lucide-react';
import { renderInlineMarkdown } from '../utils/formatting';

export type EmailDocumentKind = 'script' | 'sick_note' | 'motivation' | 'referral';

interface PatientChatProps {
  patientName: string;
  chatMessages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  chatLoading: boolean;
  onSendChat: () => void;
  /** Generate + email document from Ask HALO toolbar */
  emailDocumentActions?: {
    onSelectKind: (kind: EmailDocumentKind) => void;
    busyKind: EmailDocumentKind | null;
    scriptAvailable: boolean;
    sickNoteAvailable: boolean;
  };
}

export const PatientChat: React.FC<PatientChatProps> = ({
  patientName,
  chatMessages,
  chatInput,
  onChatInputChange,
  chatLoading,
  onSendChat,
  emailDocumentActions,
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const busy = emailDocumentActions?.busyKind ?? null;
  const menuDisabled = chatLoading || busy !== null;

  const pickKind = (kind: EmailDocumentKind) => {
    setMenuOpen(false);
    emailDocumentActions?.onSelectKind(kind);
  };

  return (
    <div className="h-[calc(100svh-240px)] max-h-[600px] min-h-[350px] flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-gradient-to-r from-teal-50 to-teal-100 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <MessageCircle size={16} className="text-teal-600" />
        <span className="text-sm font-bold text-teal-800 uppercase tracking-wider">Ask HALO</span>
      </div>

      {emailDocumentActions && (
        <div className="border-b border-slate-100 bg-slate-50/90 px-3 py-2">
          <div className="relative inline-block" ref={menuRef}>
            <button
              type="button"
              disabled={menuDisabled}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-lg border border-teal-600/35 bg-teal-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
              ) : (
                <Mail className="h-4 w-4 shrink-0" aria-hidden />
              )}
              Email document
              <ChevronDown className={`h-4 w-4 shrink-0 transition ${menuOpen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {menuOpen && !menuDisabled ? (
              <div
                role="menu"
                aria-label="Document type"
                className="absolute left-0 top-full z-20 mt-1 min-w-[220px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!emailDocumentActions.scriptAvailable}
                  title={emailDocumentActions.scriptAvailable ? undefined : 'Not available for this site'}
                  onClick={() => emailDocumentActions.scriptAvailable && pickKind('script')}
                  className="block w-full px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
                >
                  Script
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!emailDocumentActions.sickNoteAvailable}
                  title={emailDocumentActions.sickNoteAvailable ? undefined : 'Not available for this site'}
                  onClick={() => emailDocumentActions.sickNoteAvailable && pickKind('sick_note')}
                  className="block w-full px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
                >
                  Sick note
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => pickKind('motivation')}
                  className="block w-full px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-teal-50"
                >
                  Motivational letter
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => pickKind('referral')}
                  className="block w-full px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-teal-50"
                >
                  Referral letter
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 rounded-full transition-colors border border-slate-200 hover:border-teal-200"
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
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600 block mb-1">HALO</span>
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
                    className={`text-[10px] mt-1 block ${msg.role === 'user' ? 'text-teal-200' : 'text-slate-400'}`}
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
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600 block mb-1">HALO</span>
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

      <div className="p-3 border-t border-slate-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendChat();
              }
            }}
            placeholder="Ask a question about this patient..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
            disabled={chatLoading}
          />
          <button
            type="button"
            onClick={onSendChat}
            disabled={chatLoading || !chatInput.trim()}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            {chatLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
