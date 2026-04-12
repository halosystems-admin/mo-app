import type { ClinicalContextStructured } from '../../shared/types';
import { analyzeInlineData, analyzeInlineDataJsonResponse, generateText, stripBase64DataUrl } from './gemini';
import { resolveVisionMimeType, sniffImageMimeType } from './imageMimeSniff';
import { consultContextDocumentPrompt, smartContextGeminiJsonPrompt, smartContextGeminiPrompt } from '../utils/prompts';
import type { StorageAdapter, MicrosoftStorageMode } from './storage/types';
import { insertConsultContextExtraction } from './clinicalContextStore';
import { refineMimeType } from '../../shared/mimeFromFilename';
import {
  buildSmartContextExportPdf,
  buildSmartContextMarkdownPdf,
} from './smartContextPdf';

type SmartContextCandidate = {
  rawGeminiJson: string;
  rawGeminiText: string;
  ocrText: string;
  requestResponse: {
    effectiveMimeType: string;
    sourceBytes: number;
    isVisionFile: boolean;
  } | null;
  errors: Array<{ stage: string; error: string }>;
};

type ParsedContextFields = {
  summary: string;
  context: string;
  clinicalSummary: string;
  description: string;
  extractedText: string;
  findings: string[];
};

type NormalizedSmartContext = {
  summaryMarkdown: string;
  structured: ClinicalContextStructured | null;
  usable: boolean;
  reason: string;
  parsedFields: ParsedContextFields;
};

function previewText(value: string, max = 500): string {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

function formatDebugValue(value: string): string {
  return value ? value : '(empty)';
}

function determineFallbackReason(params: {
  fileReceived: boolean;
  geminiCalled: boolean;
  geminiReturnedText: boolean;
  hasCaughtError: boolean;
  parsedFields: ParsedContextFields;
}): string {
  if (!params.fileReceived) return 'no file';
  if (!params.geminiCalled) return 'Gemini call failed';
  const parserRecoveredAnyField = Boolean(
    params.parsedFields.summary ||
      params.parsedFields.context ||
      params.parsedFields.clinicalSummary ||
      params.parsedFields.description ||
      params.parsedFields.extractedText ||
      params.parsedFields.findings.length
  );
  if (params.geminiReturnedText && !parserRecoveredAnyField) return 'parser failed';
  if (params.hasCaughtError) return 'Gemini call failed';
  return 'no usable output recovered';
}

function buildFallbackDiagnosticBlock(params: {
  fileName: string;
  fileReceived: boolean;
  savedToPatientFolder: boolean;
  geminiCalled: boolean;
  geminiReturnedText: boolean;
  rawGeminiJson: string;
  rawGeminiText: string;
  parsedFields: ParsedContextFields;
  findings: string[];
  ocrText: string;
  caughtErrors: Array<{ stage: string; error: string }>;
  requestResponse: SmartContextCandidate['requestResponse'];
  fallbackReason: string;
}): string {
  const errorSummary = params.caughtErrors.length
    ? params.caughtErrors.map((item) => `${item.stage}: ${item.error}`).join(' | ')
    : '(none)';

  return [
    `Context from: ${params.fileName}`,
    '',
    'Smart Context Debug',
    '',
    `- file received: ${params.fileReceived ? 'yes' : 'no'}`,
    `- saved to patient folder: ${params.savedToPatientFolder ? 'yes' : 'no'}`,
    `- Gemini called: ${params.geminiCalled ? 'yes' : 'no'}`,
    `- Gemini returned any text: ${params.geminiReturnedText ? 'yes' : 'no'}`,
    `- fallback reason: ${params.fallbackReason}`,
    `- request info: ${formatDebugValue(params.requestResponse ? JSON.stringify(params.requestResponse) : '')}`,
    `- caught error: ${formatDebugValue(errorSummary)}`,
    '',
    'Raw Gemini Output Preview',
    '',
    `JSON: ${formatDebugValue(previewText(params.rawGeminiJson))}`,
    '',
    `Text: ${formatDebugValue(previewText(params.rawGeminiText))}`,
    '',
    'Parsed Fields',
    '',
    `- summary: ${formatDebugValue(params.parsedFields.summary)}`,
    `- context: ${formatDebugValue(params.parsedFields.context)}`,
    `- clinical summary: ${formatDebugValue(params.parsedFields.clinicalSummary)}`,
    `- description: ${formatDebugValue(params.parsedFields.description)}`,
    `- extracted text: ${formatDebugValue(previewText(params.parsedFields.extractedText || params.ocrText))}`,
    `- findings: ${formatDebugValue(params.findings.join(' | '))}`,
  ].join('\n');
}

function cleanText(value: string): string {
  return value.replace(/```(?:json)?/gi, '').replace(/\u0000/g, '').trim();
}

function isUsableText(value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return false;
  if (/^(?:null|undefined|none|n\/a|unknown|\{\}|\[\])$/i.test(cleaned)) return false;
  if (/^_?No AI summary/i.test(cleaned)) return false;
  return true;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value || '');
    if (!isUsableText(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      return Object.values(item as Record<string, unknown>)
        .filter((entry) => typeof entry === 'string')
        .join(' ');
    }
    return '';
  }));
}

function sniffPdfMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 5) return null;
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-' ? 'application/pdf' : null;
}

function resolveSmartContextMimeType(fileName: string, declaredMime: string, buffer: Buffer): string {
  const refined = refineMimeType(declaredMime, fileName).split(';')[0].trim().toLowerCase();
  const sniffedImage = sniffImageMimeType(buffer);
  const sniffedPdf = sniffPdfMimeType(buffer);
  if (sniffedPdf) return sniffedPdf;
  if (sniffedImage) return sniffedImage;
  if (refined) return refined;
  return 'application/octet-stream';
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const candidates = [cleaned];
  const fenceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (fenceMatch?.[0] && fenceMatch[0] !== cleaned) candidates.push(fenceMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // keep trying
    }
  }
  return null;
}

function findStringField(input: unknown, keys: string[]): string {
  if (!input || typeof input !== 'object') return '';
  const entries = Object.entries(input as Record<string, unknown>);
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));

  for (const [key, value] of entries) {
    if (lowerKeys.has(key.toLowerCase()) && typeof value === 'string' && isUsableText(value)) {
      return cleanText(value);
    }
  }

  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      const nested = findStringField(value, keys);
      if (nested) return nested;
    }
  }

  return '';
}

function findArrayField(input: unknown, keys: string[]): string[] {
  if (!input || typeof input !== 'object') return [];
  const entries = Object.entries(input as Record<string, unknown>);
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));

  for (const [key, value] of entries) {
    if (lowerKeys.has(key.toLowerCase())) {
      const coerced = coerceStringArray(value);
      if (coerced.length) return coerced;
    }
  }

  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      const nested = findArrayField(value, keys);
      if (nested.length) return nested;
    }
  }

  return [];
}

function parseGeminiFields(rawJson: string, rawText: string): ParsedContextFields {
  const parsed = extractJsonObject(rawJson) || extractJsonObject(rawText);
  return {
    summary: parsed ? findStringField(parsed, ['summary']) : '',
    context: parsed ? findStringField(parsed, ['context', 'note_context', 'clinical_context']) : '',
    clinicalSummary: parsed ? findStringField(parsed, ['clinical_summary', 'clinicalsummary', 'clinical_interpretation']) : '',
    description: parsed ? findStringField(parsed, ['description', 'visual_description']) : '',
    extractedText: parsed ? findStringField(parsed, ['extracted_text', 'extractedtext', 'ocr_text', 'ocrtext', 'text']) : '',
    findings: parsed ? findArrayField(parsed, ['findings', 'key_findings', 'observations']) : [],
  };
}

function firstUsefulText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (isUsableText(value || '')) return cleanText(value || '');
  }
  return '';
}

function pickBestAvailableText(fields: ParsedContextFields, rawGeminiText: string, ocrText: string): { value: string; source: string } {
  const ordered: Array<{ source: string; value: string }> = [
    { source: 'parsed.summary', value: fields.summary },
    { source: 'parsed.context', value: fields.context },
    { source: 'parsed.clinical_summary', value: fields.clinicalSummary },
    { source: 'parsed.description', value: fields.description },
    { source: 'ocr', value: ocrText },
    { source: 'raw_gemini', value: rawGeminiText },
    { source: 'findings', value: fields.findings.join('\n') },
  ];

  for (const candidate of ordered) {
    if (isUsableText(candidate.value)) {
      return { value: cleanText(candidate.value), source: candidate.source };
    }
  }
  return { value: '', source: 'none' };
}

function buildStructured(fields: ParsedContextFields, bestText: string, ocrText: string): ClinicalContextStructured | null {
  const findings = uniqueStrings(fields.findings);
  const summary = firstUsefulText(
    fields.summary,
    fields.context,
    fields.clinicalSummary,
    fields.description,
    ocrText,
    bestText,
    findings.join('\n')
  );
  const extractedText = firstUsefulText(fields.extractedText, ocrText);
  const clinicalInterpretation = firstUsefulText(fields.context, fields.clinicalSummary);

  if (!summary && !findings.length && !extractedText && !clinicalInterpretation) return null;

  return {
    summary,
    findings,
    extracted_text: extractedText,
    clinical_interpretation: clinicalInterpretation,
  };
}

function buildMarkdown(fileName: string, structured: ClinicalContextStructured | null, bestText: string): string {
  const lines: string[] = [`Context from: ${fileName}`, ''];

  if (structured?.summary) {
    lines.push('Summary', '', structured.summary, '');
  } else if (isUsableText(bestText)) {
    lines.push(cleanText(bestText), '');
  }

  if (structured?.findings?.length) {
    lines.push('Findings', '');
    for (const finding of structured.findings) lines.push(`- ${finding}`);
    lines.push('');
  }

  if (structured?.extracted_text) {
    lines.push('Extracted text', '', structured.extracted_text, '');
  }

  if (structured?.clinical_interpretation && structured.clinical_interpretation !== structured.summary) {
    lines.push('Clinical interpretation', '', structured.clinical_interpretation, '');
  }

  return lines.join('\n').trim();
}

function normalizeSmartContextOutput(fileName: string, candidates: SmartContextCandidate): NormalizedSmartContext {
  const fields = parseGeminiFields(candidates.rawGeminiJson, candidates.rawGeminiText);
  const best = pickBestAvailableText(fields, candidates.rawGeminiText, candidates.ocrText);
  const structured = buildStructured(fields, best.value, candidates.ocrText);
  const summaryMarkdown = buildMarkdown(fileName, structured, best.value);
  const usable = isUsableText(best.value) || Boolean(structured);

  return {
    summaryMarkdown,
    structured,
    usable,
    reason: best.source,
    parsedFields: fields,
  };
}

async function persistSmartContextArtifacts(params: {
  adapter: StorageAdapter;
  token: string;
  patientId: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceBuffer: Buffer;
  summaryMarkdown: string;
  structured: ClinicalContextStructured | null;
  microsoftStorageMode?: MicrosoftStorageMode;
}): Promise<void> {
  console.log('[smart-context] persisting artifacts', {
    fileName: params.sourceFileName,
    sourceMimeType: params.sourceMimeType,
    summaryLength: params.summaryMarkdown.length,
    hasStructured: Boolean(params.structured),
  });

  await insertConsultContextExtraction({
    haloPatientId: params.patientId,
    driveFileId: params.sourceFileId,
    fileName: params.sourceFileName,
    structured: params.structured,
    summaryMarkdown: params.summaryMarkdown,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeBase =
    params.sourceFileName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'context';

  try {
    const summaryPdf = params.structured
      ? await buildSmartContextExportPdf(params.structured, {
          sourceFileName: params.sourceFileName,
          stamp,
        })
      : await buildSmartContextMarkdownPdf(params.summaryMarkdown, {
          sourceFileName: params.sourceFileName,
          stamp,
        });
    await params.adapter.uploadFile({
      token: params.token,
      parentFolderId: params.patientId,
      fileName: `Smart_context_${stamp}_${safeBase}.pdf`,
      fileType: 'application/pdf',
      base64Data: Buffer.from(summaryPdf).toString('base64'),
      microsoftStorageMode: params.microsoftStorageMode,
    });
    console.log('[smart-context] uploaded summary pdf', { fileName: params.sourceFileName });
  } catch (error) {
    console.error('[smart-context] failed to upload summary pdf', error);
  }
}

async function loadSourceFile(params: {
  adapter: StorageAdapter;
  token: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  inlineBase64?: string;
  inlineMimeType?: string;
  microsoftStorageMode?: MicrosoftStorageMode;
}): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const inlineRaw = typeof params.inlineBase64 === 'string' ? stripBase64DataUrl(params.inlineBase64) : '';
  if (inlineRaw) {
    const buffer = Buffer.from(inlineRaw, 'base64');
    const fileName = params.fileName?.trim() || 'upload';
    const declaredMime = (params.inlineMimeType || params.mimeType || '').split(';')[0].trim().toLowerCase();
    const mimeType = resolveSmartContextMimeType(fileName, declaredMime, buffer);
    return { buffer, fileName, mimeType };
  }

  const proxy = await params.adapter.proxyFile({
    token: params.token,
    fileId: params.fileId,
    microsoftStorageMode: params.microsoftStorageMode,
  });
  const fileName = params.fileName?.trim() || proxy.filename || 'upload';
  const declaredMime = (params.mimeType || proxy.mimeType || '').split(';')[0].trim().toLowerCase();
  const mimeType = resolveSmartContextMimeType(fileName, declaredMime, proxy.data);
  return { buffer: proxy.data, fileName, mimeType };
}

async function extractOcrText(params: {
  adapter: StorageAdapter;
  token: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  microsoftStorageMode?: MicrosoftStorageMode;
}): Promise<string> {
  try {
    return await params.adapter.extractTextFromFile({
      token: params.token,
      file: {
        id: params.fileId,
        name: params.fileName,
        mimeType: params.mimeType || 'application/octet-stream',
      },
      maxChars: 12000,
      microsoftStorageMode: params.microsoftStorageMode,
    });
  } catch (error) {
    console.error('[smart-context] OCR extraction failed', {
      fileName: params.fileName,
      mimeType: params.mimeType,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

async function processWithGemini(params: {
  fileName: string;
  mimeType: string;
  sourceBuffer: Buffer;
  ocrText: string;
}): Promise<SmartContextCandidate> {
  const isVisionFile = params.mimeType.startsWith('image/') || params.mimeType === 'application/pdf';
  const base64 = params.sourceBuffer.toString('base64');
  const candidate: SmartContextCandidate = {
    rawGeminiJson: '',
    rawGeminiText: '',
    ocrText: params.ocrText,
    requestResponse: null,
    errors: [],
  };

  if (isVisionFile) {
    const effectiveMime =
      params.mimeType.startsWith('image/')
        ? resolveVisionMimeType(base64, params.mimeType).mime
        : 'application/pdf';
    candidate.requestResponse = {
      effectiveMimeType: effectiveMime,
      sourceBytes: params.sourceBuffer.length,
      isVisionFile,
    };

    try {
      console.log('[smart-context] Gemini request sent', {
        fileName: params.fileName,
        mimeType: effectiveMime,
        mode: 'json',
      });
      candidate.rawGeminiJson = await analyzeInlineDataJsonResponse(
        smartContextGeminiJsonPrompt(params.fileName),
        base64,
        effectiveMime
      );
    } catch (error) {
      candidate.errors.push({
        stage: 'gemini-json',
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[smart-context] Gemini JSON request failed', {
        fileName: params.fileName,
        mimeType: effectiveMime,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      console.log('[smart-context] Gemini request sent', {
        fileName: params.fileName,
        mimeType: effectiveMime,
        mode: 'text',
      });
      candidate.rawGeminiText = await analyzeInlineData(
        smartContextGeminiPrompt(params.fileName),
        base64,
        effectiveMime
      );
    } catch (error) {
      candidate.errors.push({
        stage: 'gemini-text',
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[smart-context] Gemini text request failed', {
        fileName: params.fileName,
        mimeType: effectiveMime,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!isUsableText(candidate.rawGeminiText) && isUsableText(params.ocrText)) {
    try {
      console.log('[smart-context] Gemini OCR summarisation request sent', {
        fileName: params.fileName,
        extractedLength: params.ocrText.length,
      });
      candidate.rawGeminiText = await generateText(
        consultContextDocumentPrompt(params.fileName, params.ocrText)
      );
    } catch (error) {
      candidate.errors.push({
        stage: 'gemini-ocr-summary',
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[smart-context] Gemini OCR summarisation failed', {
        fileName: params.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('[smart-context] Gemini response received', {
    fileName: params.fileName,
    jsonLength: candidate.rawGeminiJson.length,
    textLength: candidate.rawGeminiText.length,
    ocrLength: candidate.ocrText.length,
  });

  return candidate;
}

export async function processSmartContextFile(params: {
  adapter: StorageAdapter;
  token: string;
  patientId: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  inlineBase64?: string;
  inlineMimeType?: string;
  microsoftStorageMode?: MicrosoftStorageMode;
}): Promise<{ summaryMarkdown: string; structured: ClinicalContextStructured | null }> {
  const source = await loadSourceFile({
    adapter: params.adapter,
    token: params.token,
    fileId: params.fileId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    inlineBase64: params.inlineBase64,
    inlineMimeType: params.inlineMimeType,
    microsoftStorageMode: params.microsoftStorageMode,
  });

  console.log('[smart-context] file received', {
    fileId: params.fileId,
    fileName: source.fileName,
    mimeType: source.mimeType,
    bytes: source.buffer.length,
    source: params.inlineBase64 ? 'inline-upload' : 'storage-proxy',
  });

  if (!source.buffer.length) {
    throw new Error('Smart Context received an empty file payload.');
  }

  const ocrText = await extractOcrText({
    adapter: params.adapter,
    token: params.token,
    fileId: params.fileId,
    fileName: source.fileName,
    mimeType: source.mimeType,
    microsoftStorageMode: params.microsoftStorageMode,
  });

  const gemini = await processWithGemini({
    fileName: source.fileName,
    mimeType: source.mimeType,
    sourceBuffer: source.buffer,
    ocrText,
  });

  const normalized = normalizeSmartContextOutput(source.fileName, gemini);
  console.log('[smart-context] parser result', {
    fileName: source.fileName,
    usable: normalized.usable,
    reason: normalized.reason,
    summaryLength: normalized.summaryMarkdown.length,
    hasStructured: Boolean(normalized.structured),
  });

  if (!normalized.usable) {
    const fileReceived = source.buffer.length > 0;
    const geminiCalled = Boolean(gemini.requestResponse) || gemini.errors.some((item) => item.stage.startsWith('gemini-'));
    const geminiReturnedText = isUsableText(gemini.rawGeminiJson) || isUsableText(gemini.rawGeminiText);
    const fallbackReason = determineFallbackReason({
      fileReceived,
      geminiCalled,
      geminiReturnedText,
      hasCaughtError: gemini.errors.length > 0,
      parsedFields: normalized.parsedFields,
    });
    console.error('[smart-context] fallback assignment input', {
      fileName: source.fileName,
      parsedResult: normalized,
      parsedFields: normalized.parsedFields,
      findings: normalized.parsedFields.findings,
      rawGeminiText: gemini.rawGeminiText,
      rawGeminiJson: gemini.rawGeminiJson,
      fullGeminiResponse: {
        json: gemini.rawGeminiJson,
        text: gemini.rawGeminiText,
      },
      requestResponse: gemini.requestResponse,
      caughtError: gemini.errors,
      ocrText: gemini.ocrText,
    });
    console.error('[smart-context] fallback triggered', {
      fileName: source.fileName,
      reason: fallbackReason,
    });
    return {
      summaryMarkdown: buildFallbackDiagnosticBlock({
        fileName: source.fileName,
        fileReceived,
        savedToPatientFolder: Boolean(params.fileId),
        geminiCalled,
        geminiReturnedText,
        rawGeminiJson: gemini.rawGeminiJson,
        rawGeminiText: gemini.rawGeminiText,
        parsedFields: normalized.parsedFields,
        findings: normalized.parsedFields.findings,
        ocrText: gemini.ocrText,
        caughtErrors: gemini.errors,
        requestResponse: gemini.requestResponse,
        fallbackReason,
      }),
      structured: null,
    };
  }

  await persistSmartContextArtifacts({
    adapter: params.adapter,
    token: params.token,
    patientId: params.patientId,
    sourceFileId: params.fileId,
    sourceFileName: source.fileName,
    sourceMimeType: source.mimeType,
    sourceBuffer: source.buffer,
    summaryMarkdown: normalized.summaryMarkdown,
    structured: normalized.structured,
    microsoftStorageMode: params.microsoftStorageMode,
  });

  return {
    summaryMarkdown: normalized.summaryMarkdown,
    structured: normalized.structured,
  };
}
