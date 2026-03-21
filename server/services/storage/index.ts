import type { MicrosoftStorageMode, StorageAdapter, StorageProvider } from './types';
import { googleDriveAdapter } from './googleDrive';
import { microsoftGraphAdapter } from './microsoftGraph';

export function getStorageAdapter(provider?: StorageProvider): StorageAdapter {
  switch (provider) {
    case 'microsoft':
      return microsoftGraphAdapter;
    case 'google':
    default:
      return googleDriveAdapter;
  }
}

export function getMicrosoftStorageMode(mode?: MicrosoftStorageMode): MicrosoftStorageMode | undefined {
  return mode;
}

