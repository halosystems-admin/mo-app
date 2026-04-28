import React from 'react';
import type { Patient, UserSettings } from '../../../shared/types';
import { ClinicalDashboard } from '../features/clinical/ClinicalDashboard';

interface SheetsPageProps {
  patients: Patient[];
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenPatient: (patientId: string) => void;
}

/** Hospital sheets / workflows — same dashboard as before, without ward board. */
export const SheetsPage: React.FC<SheetsPageProps> = ({
  patients,
  userSettings,
  onToast,
  onOpenPatient,
}) => {
  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-halo-bg px-4 py-3 md:px-8 md:py-5">
      <div className="w-full max-w-none mx-auto space-y-4">
        <header>
          <h1 className="max-md:hidden text-xl md:text-2xl font-semibold text-halo-text tracking-tight">Sheets</h1>
        </header>
        <ClinicalDashboard
          userSettings={userSettings}
          onToast={onToast}
          patients={patients}
          onOpenPatient={onOpenPatient}
        />
      </div>
    </div>
  );
};
