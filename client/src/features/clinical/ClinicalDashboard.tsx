import React, { useEffect, useState } from 'react';
import type { Patient, UserSettings } from '../../../../shared/types';
import { InpatientsSection } from './inpatients/InpatientsSection';
import { SurgeonRoundsSection } from './rounds/SurgeonRoundsSection';
import { PendingProceduresSection } from './procedures/PendingProceduresSection';
import { AdmissionsAllSection } from './admissions/AdmissionsAllSection';
import { MultiPatientDictationMock } from './tools/MultiPatientDictationMock';
import { ClinicalNotesExport } from './tools/ClinicalNotesExport';
import { downloadTheatreListPdf } from './tools/ClinicalExportMock';

type Tab = 'inpatients' | 'rounds' | 'pending' | 'admissions' | 'tools';

interface Props {
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
  onOpenWardBoard?: () => void;
}

const TAB_KEY = 'halo_clinical_dashboard_tab';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inpatients', label: 'INPATIENTS' },
  { id: 'rounds', label: 'SURGEON ROUNDS' },
  { id: 'pending', label: 'PENDING PROCEDURES' },
  { id: 'admissions', label: 'ADMISSIONS-ALL' },
  { id: 'tools', label: 'TOOLS' },
];

function readStoredTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY);
    if (v && TABS.some((t) => t.id === v)) return v as Tab;
  } catch {
    /* ignore */
  }
  return 'inpatients';
}

export const ClinicalDashboard: React.FC<Props> = ({
  userSettings,
  onToast,
  patients = [],
  onOpenPatient,
  onOpenWardBoard,
}) => {
  const [tab, setTab] = useState<Tab>(readStoredTab);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'px-3 py-2 rounded-lg text-xs font-bold tracking-wide bg-violet-600 text-white'
                : 'px-3 py-2 rounded-lg text-xs font-bold tracking-wide bg-slate-100 text-slate-700 hover:bg-slate-200'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inpatients' && (
        <InpatientsSection
          onToast={onToast}
          patients={patients}
          onOpenPatient={onOpenPatient}
          onOpenWardBoard={onOpenWardBoard}
        />
      )}
      {tab === 'rounds' && <SurgeonRoundsSection />}
      {tab === 'pending' && (
        <PendingProceduresSection
          onToast={onToast}
          patients={patients}
          onOpenPatient={onOpenPatient}
          userSettings={userSettings}
        />
      )}
      {tab === 'admissions' && <AdmissionsAllSection onToast={onToast} patients={patients} />}
      {tab === 'tools' && (
        <div className="space-y-6">
          <section>
            <h3 className="text-sm font-bold text-slate-800 mb-2">Ward dictation</h3>
            <MultiPatientDictationMock onToast={onToast} />
          </section>
          <ClinicalNotesExport patients={patients} userSettings={userSettings} onToast={onToast} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm"
              onClick={() => {
                downloadTheatreListPdf(userSettings);
                onToast?.('PDF downloaded.', 'success');
              }}
            >
              Theatre list PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
