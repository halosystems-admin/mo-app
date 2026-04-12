import React, { useEffect, useState } from 'react';
import type { Patient, UserSettings } from '../../../../shared/types';
import { InpatientsSection } from './inpatients/InpatientsSection';
import { SurgeonRoundsSection } from './rounds/SurgeonRoundsSection';
import { PendingProceduresSection } from './procedures/PendingProceduresSection';
import { AdmissionsAllSection } from './admissions/AdmissionsAllSection';
import { SHEETS_TAB_ACTIVE, SHEETS_TAB_IDLE } from './shared/tableScrollClasses';
type Tab = 'inpatients' | 'rounds' | 'pending' | 'admissions';

interface Props {
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
}

const TAB_KEY = 'halo_clinical_dashboard_tab';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inpatients', label: 'INPATIENTS' },
  { id: 'rounds', label: 'SURGEON ROUNDS' },
  { id: 'pending', label: 'PENDING' },
  { id: 'admissions', label: 'ADMISSIONS' },
];

function readStoredTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY);
    if (v && TABS.some((t) => t.id === v)) return v as Tab;
    if (v === 'tools') sessionStorage.removeItem(TAB_KEY);
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
      <div className="flex flex-wrap gap-1.5 border-b border-halo-border pb-2.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`${tab === t.id ? SHEETS_TAB_ACTIVE : SHEETS_TAB_IDLE} uppercase tracking-wider`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inpatients' && (
        <InpatientsSection onToast={onToast} patients={patients} onOpenPatient={onOpenPatient} />
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
    </div>
  );
};
