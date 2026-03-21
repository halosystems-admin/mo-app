import type { AdmittedPatientKanban, DoctorDiaryEntry, DriveFile, Patient, ScribeSession, UserSettings } from '../../../shared/types';

export type StorageProvider = 'google' | 'microsoft';

export type MicrosoftStorageMode = 'onedrive' | 'sharepoint';

export type StorageAdapterParams = {
  token: string;
  provider: StorageProvider;
  microsoftStorageMode?: MicrosoftStorageMode;
};

export interface ListPatientsResult {
  patients: Patient[];
  nextPage: string | null;
}

export interface ListFilesResult {
  files: DriveFile[];
  nextPage: string | null;
}

export interface ProxyFileResult {
  mimeType: string;
  filename: string;
  data: Buffer;
}

export interface DownloadFileResult {
  downloadUrl: string;
  viewUrl: string;
  name: string;
  mimeType: string;
}

/**
 * Storage adapter abstracts away provider-specific APIs (Google Drive vs Microsoft Graph).
 * The rest of the app uses /api/drive/* routes, which delegate to this interface.
 */
export interface StorageAdapter {
  provider: StorageProvider;

  // Patient folders
  listPatients(params: {
    token: string;
    page?: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<ListPatientsResult>;

  createPatient(params: {
    token: string;
    name: string;
    dob: string;
    sex: 'M' | 'F';
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<Patient>;

  updatePatient(params: {
    token: string;
    patientId: string;
    name?: string;
    dob?: string;
    sex?: 'M' | 'F';
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  trashPatient(params: {
    token: string;
    patientId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  // Folders/files inside a patient workspace
  createFolder(params: {
    token: string;
    parentFolderId: string;
    name: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<DriveFile>;

  listFolderFiles(params: {
    token: string;
    folderId: string;
    page?: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<ListFilesResult>;

  warmAndListFolderFiles(params: {
    token: string;
    folderId: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<ListFilesResult>;

  uploadFile(params: {
    token: string;
    parentFolderId: string;
    fileName: string;
    fileType: string;
    base64Data: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<DriveFile>;

  renameFile(params: {
    token: string;
    fileId: string;
    newName: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  trashFile(params: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  downloadFileInfo(params: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<DownloadFileResult>;

  proxyFile(params: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<ProxyFileResult>;

  // Sessions/settings JSON stored inside the provider
  getPatientSessions(params: {
    token: string;
    patientFolderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ sessions: ScribeSession[] }>;

  savePatientSessions(params: {
    token: string;
    patientFolderId: string;
    payload: {
      sessionId?: string;
      transcript: string;
      context?: string;
      templates?: string[];
      noteTitles?: string[];
      notes?: Array<{
        noteId: string;
        title: string;
        content: string;
        template_id: string;
        raw?: unknown;
        fields?: Array<{ label: string; body: string }>;
      }>;
      mainComplaint?: string;
    };
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ sessions: ScribeSession[] }>;

  getUserSettings(params: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ settings: UserSettings | null }>;

  saveUserSettings(params: {
    token: string;
    settings: UserSettings;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  // --- Doctor diary + ward Kanban (stored in HALO root folder) ---

  getDoctorDiary(params: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ entries: DoctorDiaryEntry[] }>;

  saveDoctorDiary(params: {
    token: string;
    entries: DoctorDiaryEntry[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  getDoctorKanban(params: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ kanban: AdmittedPatientKanban[] }>;

  saveDoctorKanban(params: {
    token: string;
    kanban: AdmittedPatientKanban[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }>;

  // Used by /api/halo/generate-note to store DOCX
  getOrCreatePatientNotesFolder(params: {
    token: string;
    patientFolderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<string>;

  // Used by AI routes to read context from stored docs
  fetchAllFilesInFolder(params: {
    token: string;
    folderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<Array<{ id: string; name: string; mimeType: string }>>;

  extractTextFromFile(params: {
    token: string;
    file: { id: string; name: string; mimeType: string };
    maxChars?: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<string>;
}

