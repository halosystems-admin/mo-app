import type { Patient, UserSettings } from '../../../shared/types';

/**
 * Narrow data-layer contracts so UI depends on facades, not raw REST or Supabase.
 * Implementations: {@link createPatientRepository} in repositories.ts (Drive-backed today).
 */
export interface PatientRepository {
  listAll(): Promise<Patient[]>;
}

export interface SettingsRepository {
  load(): Promise<UserSettings | null>;
  save(settings: UserSettings): Promise<void>;
}

export interface AppRepositories {
  patients: PatientRepository;
  settings: SettingsRepository;
}
