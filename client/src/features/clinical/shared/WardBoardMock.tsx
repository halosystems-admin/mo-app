import React from 'react';
import type { ClinicalWard, InpatientRecord } from '../../../types/clinical';
import { formatWardDisplay, wardHeadingStripClass } from './clinicalDisplay';
import { AlertCircle } from 'lucide-react';
import { CLINICAL_HORIZONTAL_SCROLL } from './tableScrollClasses';

interface Props {
  byWard: Record<ClinicalWard, InpatientRecord[]>;
  onSelect: (id: string) => void;
}

const ORDER: ClinicalWard[] = [
  'ICU',
  'F-ward (4th)',
  'S-ward (5th)',
  'medical ward',
  'paediatrics ward',
  'emergency department',
  'labour ward',
];

export const WardBoardMock: React.FC<Props> = ({ byWard, onSelect }) => (
  <div className={CLINICAL_HORIZONTAL_SCROLL} style={{ WebkitOverflowScrolling: 'touch' }}>
    {ORDER.map((w) => (
      <div
        key={w}
        className="min-w-[240px] sm:min-w-[260px] max-w-[300px] flex-shrink-0 rounded-xl border border-slate-200 bg-white flex flex-col max-h-[480px] shadow-sm"
      >
        <div
          className={`px-3 py-2 border-b rounded-t-xl ${wardHeadingStripClass(w)}`}
        >
          <div className="text-xs font-bold tracking-wide">{formatWardDisplay(w)}</div>
          <div className="text-[11px] text-slate-500">{(byWard[w] || []).length} patient(s)</div>
        </div>
        <div className="p-2 space-y-2 overflow-y-auto flex-1">
          {(byWard[w] || []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className="w-full text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-300 hover:shadow-sm transition"
            >
              <div className="font-semibold text-slate-800 text-sm truncate">
                {p.firstName} {p.surname}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Folder {p.folderNumber}</div>
              <div className="text-[11px] text-slate-600 mt-1 truncate">{p.assignedDoctor}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {p.taskIndicators.slice(0, 3).map((t) => (
                  <span
                    key={t.label}
                    className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-slate-200 ${
                      t.urgent ? 'bg-slate-200/90 text-slate-900' : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    {t.urgent ? <AlertCircle size={10} /> : null}
                    {t.label}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
);
