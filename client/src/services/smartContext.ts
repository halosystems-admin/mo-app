import type { DriveFile } from '../../../shared/types';
import { mimeFromFilename } from '../../../shared/mimeFromFilename';
import { consultContextSmartUpload, uploadFile } from './api';

export type SmartContextUploadResult = {
  uploaded: DriveFile;
  summary: string;
  panelBlock: string;
  imageAttachment: { base64: string; mimeType: string; fileName: string } | null;
};

function buildSmartContextUploadName(file: File): string {
  return `consult_context_${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
}

function isImageContextFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg)$/i.test(file.name);
}

function normalizeImageMime(file: File, uploadedName: string): string {
  let mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (!/^image\//i.test(mime)) {
    mime = mimeFromFilename(uploadedName) || mimeFromFilename(file.name) || 'image/jpeg';
  }
  if (!/^image\/(jpeg|png|gif|webp|bmp|heic|heif|svg\+xml)$/i.test(mime)) {
    mime = 'image/jpeg';
  }
  return mime;
}

function normalizeContextFileMime(file: File, uploadedName: string): string {
  const raw = (file.type || '').split(';')[0].trim().toLowerCase();
  return raw || mimeFromFilename(uploadedName) || mimeFromFilename(file.name) || 'application/octet-stream';
}

async function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] || '' : result);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function buildSmartContextPanelBlock(fileName: string, summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.startsWith('Context from:')) return trimmed;
  return `Context from: ${fileName}\n\n${trimmed}`;
}

export async function uploadAndExtractSmartContext(
  patientId: string,
  file: File
): Promise<SmartContextUploadResult> {
  try {
    console.log('[smart-context-client] upload starting', {
      patientId,
      fileName: file.name,
      fileType: file.type,
      size: file.size,
    });

    const uploaded = await uploadFile(patientId, file, buildSmartContextUploadName(file));
    console.log('[smart-context-client] patient-folder save succeeded', {
      patientId,
      fileId: uploaded.id,
      fileName: uploaded.name,
      mimeType: uploaded.mimeType,
    });

    const inlineBase64 = await readFileBase64(file);
    const inlineMimeType = normalizeContextFileMime(file, uploaded.name);

    console.log('[smart-context-client] Gemini processing request starting', {
      patientId,
      fileId: uploaded.id,
      fileName: uploaded.name,
      inlineMimeType,
    });
    const result = await consultContextSmartUpload(patientId, uploaded, {
      base64: inlineBase64,
      mimeType: inlineMimeType,
    });
    console.log('[smart-context-client] Gemini processing request finished', {
      fileId: uploaded.id,
      summaryLength: result.summary.length,
    });

    let imageAttachment: { base64: string; mimeType: string; fileName: string } | null = null;
    if (isImageContextFile(file)) {
      imageAttachment = {
        base64: inlineBase64,
        mimeType: normalizeImageMime(file, uploaded.name),
        fileName: uploaded.name,
      };
    }

    const panelBlock = buildSmartContextPanelBlock(uploaded.name, result.summary);
    console.log('[smart-context-client] context panel block created', {
      fileName: uploaded.name,
      panelLength: panelBlock.length,
    });

    return {
      uploaded,
      summary: result.summary,
      panelBlock,
      imageAttachment,
    };
  } catch (error) {
    console.error('[smart-context-client] upload/extract pipeline failed', error);
    throw error;
  }
}
