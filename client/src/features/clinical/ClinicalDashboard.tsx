import React from 'react';
import type { Patient, UserSettings } from '../../../../shared/types';
import { InpatientsSection } from './inpatients/InpatientsSection';

interface Props {
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
}

/** Single Sheets view: full inpatient grid (“All patients”, formerly split across Inpatients / Surgeon rounds). */
export const ClinicalDashboard: React.FC<Props> = ({
  userSettings: _userSettings,
  onToast,
  patients = [],
  onOpenPatient,
}) => (
  <div className="space-y-3 min-w-0">
    <InpatientsSection onToast={onToast} patients={patients} onOpenPatient={onOpenPatient} />
  </div>
);
