import type { UserSettings } from '../../../shared/types';
import type { AppRepositories, PatientRepository, SettingsRepository } from './types';
import { fetchAllPatients, loadSettings, saveSettings } from '../services/api';

/** Current backend: Express + Google/Microsoft storage. Swap body when Supabase is wired. */
function createDrivePatientRepository(): PatientRepository {
  return {
    async listAll() {
      return fetchAllPatients();
    },
  };
}

function createDriveSettingsRepository(): SettingsRepository {
  return {
    async load() {
      const r = await loadSettings();
      return r.settings ?? null;
    },
    async save(settings: UserSettings) {
      await saveSettings(settings);
    },
  };
}

/** Single entry for feature code — avoids scattering `fetch` vs Supabase checks. */
export function createAppRepositories(): AppRepositories {
  return {
    patients: createDrivePatientRepository(),
    settings: createDriveSettingsRepository(),
  };
}
