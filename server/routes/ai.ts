import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { generateText, generateTextStream, analyzeImage, transcribeAudio, safeJsonParse } from '../services/gemini';
import { isDeepgramAvailable, transcribeWithDeepgram } from '../services/deepgram';
import { fetchAllFilesInFolder, extractTextFromFile } from '../services/drive';
import { getStorageAdapter } from '../services/storage';
import {
  summaryPrompt,
  labAlertsPrompt,
  imageAnalysisPrompt,
  searchPrompt,
  chatSystemPrompt,
  geminiTranscriptionPrompt,
  fileDescriptionPrompt,
  patientStickerExtractionPrompt,
  consultContextImagePrompt,
  consultContextImageRetryPrompt,
  consultContextDocumentPrompt,
  consultContextBinaryFallbackPrompt,
  dischargeSummaryPrompt,
} from '../utils/prompts';
import type { ExtractedPatientSticker } from '../../shared/types';

const router = Router();
router.use(requireAuth);

/** Vision path for Smart Context: primary prompt + retry if output too thin (wound photos, etc.). */
async function summarizeConsultContextImage(
  base64: string,
  mimeType: string,
  fileLabel: string
): Promise<string> {
  let summary = (await analyzeImage(consultContextImagePrompt(fileLabel), base64, mimeType)).trim();
  if (summary.length < 28) {
    summary = (await analyzeImage(consultContextImageRetryPrompt(fileLabel), base64, mimeType)).trim();
  }
  return summary;
}

// POST /summary — enhanced: reads actual file content (PDF, DOCX, TXT, Google Docs)
router.post('/summary', async (req: Request, res: Response) => {
  try {
    const { patientName, patientId, files } = req.body as {
      patientName?: string;
      patientId?: string;
      files?: Array<{ name: string; createdTime: string }>;
    };

    if (!patientName || !files || !Array.isArray(files)) {
      res.status(400).json({ error: 'patientName and files are required.' });
      return;
    }

    let fileContext = files
      .slice(0, 8)
      .map((f) => `- ${f.name} (${f.createdTime})`)
      .join('\n');

    // If patientId and token available, read actual file contents for richer summary
    const token = req.session.accessToken;
    if (patientId && token) {
      try {
        const allFiles = await fetchAllFilesInFolder(token, patientId);
        const readableFiles = allFiles.filter(f =>
          f.name.endsWith('.txt') ||
          f.name.endsWith('.pdf') ||
          f.name.endsWith('.docx') ||
          f.name.endsWith('.doc') ||
          f.mimeType === 'text/plain' ||
          f.mimeType === 'application/pdf' ||
          f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          f.mimeType === 'application/msword' ||
          f.mimeType === 'application/vnd.google-apps.document'
        ).slice(0, 5);

        const contentParts: string[] = [];
        for (const file of readableFiles) {
          const text = await extractTextFromFile(token, file, 1500);
          if (text.trim()) {
            contentParts.push(`--- ${file.name} ---\n${text}`);
          }
        }

        if (contentParts.length > 0) {
          fileContext += '\n\nFile Contents:\n' + contentParts.join('\n\n');
        }
      } catch {
        // Fall back to file-name-only summary if content extraction fails
      }
    }

    const text = await generateText(summaryPrompt(patientName, fileContext));
    res.json(safeJsonParse<string[]>(text, ['Summary unavailable.']));
  } catch (err) {
    console.error('Summary error:', err);
    res.json(['Summary unavailable.']);
  }
});

// POST /lab-alerts
router.post('/lab-alerts', async (req: Request, res: Response) => {
  try {
    const { content } = req.body as { content?: string };

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'Content is required for lab alert extraction.' });
      return;
    }

    const text = await generateText(labAlertsPrompt(content));
    res.json(safeJsonParse(text, []));
  } catch (err) {
    console.error('Lab alerts error:', err);
    res.json([]);
  }
});

// POST /analyze-image
router.post('/analyze-image', async (req: Request, res: Response) => {
  try {
    const { base64Image } = req.body as { base64Image?: string };

    if (!base64Image || typeof base64Image !== 'string') {
      res.status(400).json({ error: 'base64Image is required.' });
      return;
    }

    const cleanBase64 = base64Image.split(',')[1] || base64Image;
    const text = await analyzeImage(imageAnalysisPrompt(), cleanBase64, 'image/jpeg');
    const filename = text.trim() || 'processed_image.jpg';

    res.json({ filename });
  } catch (err) {
    console.error('Image analysis error:', err);
    res.json({ filename: `image_${Date.now()}.jpg` });
  }
});

// POST /describe-file — summarize a single uploaded file for context
router.post('/describe-file', async (req: Request, res: Response) => {
  try {
    const { patientId, fileId, name, mimeType } = req.body as {
      patientId?: string;
      fileId?: string;
      name?: string;
      mimeType?: string;
    };

    if (!patientId || !fileId) {
      res.status(400).json({ error: 'patientId and fileId are required.' });
      return;
    }

    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    // Reuse Drive text extraction helpers to read the file contents
    const dummyFile = {
      id: fileId,
      name: name || 'Uploaded file',
      mimeType: mimeType || 'application/octet-stream',
    };

    const extracted = await extractTextFromFile(token, dummyFile, 3000);
    if (!extracted.trim()) {
      res.json({ description: '' });
      return;
    }

    const descriptionRaw = await generateText(fileDescriptionPrompt(dummyFile.name, extracted));
    const description = (descriptionRaw || '').trim();
    res.json({ description });
  } catch (err) {
    console.error('Describe file error:', err);
    res.json({ description: '' });
  }
});

// POST /search (enhanced: includes file content context for concept-based search)
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, patients, files } = req.body as {
      query?: string;
      patients?: Array<{ id: string; name: string }>;
      files?: Record<string, Array<{ name: string }>>;
    };

    if (!patients || !Array.isArray(patients)) {
      res.status(400).json({ error: 'patients array is required.' });
      return;
    }

    if (!query) {
      res.json(patients.map((p) => p.id));
      return;
    }

    const token = req.session.accessToken!;

    // Build rich context: file names + snippet of text file contents per patient
    const contextParts: string[] = [];
    for (const p of patients) {
      const pFiles = files?.[p.id] || [];
      const fileNames = pFiles.map((f) => f.name).join(', ');
      let contentSnippets = '';

      // Fetch content from up to 5 readable files per patient for concept matching
      try {
        const allFiles = await fetchAllFilesInFolder(token, p.id);
        const readableFiles = allFiles.filter(f =>
          f.name.endsWith('.txt') ||
          f.name.endsWith('.pdf') ||
          f.name.endsWith('.docx') ||
          f.name.endsWith('.doc') ||
          f.mimeType === 'text/plain' ||
          f.mimeType === 'application/pdf' ||
          f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          f.mimeType === 'application/msword' ||
          f.mimeType === 'application/vnd.google-apps.document'
        ).slice(0, 5);

        for (const rf of readableFiles) {
          const text = await extractTextFromFile(token, rf, 500);
          if (text.trim()) {
            contentSnippets += ` | ${rf.name}: ${text}`;
          }
        }
      } catch {
        // Skip patients whose files can't be fetched
      }

      contextParts.push(`ID: ${p.id}, Name: ${p.name}, Files: [${fileNames}]${contentSnippets ? `, Content: [${contentSnippets.substring(0, 1500)}]` : ''}`);
    }

    const context = contextParts.join('\n');
    const text = await generateText(searchPrompt(query, context));
    res.json(safeJsonParse<string[]>(text, []));
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

// Shared chat context builder (used by /chat and /chat-stream)
async function buildChatContext(
  token: string,
  patientId: string,
  question: string,
  history: Array<{ role: string; content: string }>
): Promise<string> {
  const allFiles = await fetchAllFilesInFolder(token, patientId);
  const readableFiles = allFiles.filter(f =>
    f.name.endsWith('.txt') ||
    f.name.endsWith('.pdf') ||
    f.name.endsWith('.docx') ||
    f.name.endsWith('.doc') ||
    f.mimeType === 'text/plain' ||
    f.mimeType === 'application/pdf' ||
    f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    f.mimeType === 'application/msword' ||
    f.mimeType === 'application/vnd.google-apps.document'
  ).slice(0, 10);

  const contextParts: string[] = [];
  const fileList = allFiles
    .filter(f => f.mimeType !== 'application/vnd.google-apps.folder')
    .map(f => `- ${f.name} (${f.mimeType})`)
    .join('\n');
  contextParts.push(`Patient files:\n${fileList}`);

  for (const file of readableFiles) {
    const textContent = await extractTextFromFile(token, file, 2000);
    if (textContent.trim()) {
      contextParts.push(`\n--- File: ${file.name} ---\n${textContent}`);
    }
  }

  const fullContext = contextParts.join('\n').substring(0, 15000);
  const conversationHistory = (history || [])
    .slice(-10)
    .map(m => `${m.role === 'user' ? 'User' : 'HALO'}: ${m.content}`)
    .join('\n');

  return chatSystemPrompt(fullContext, conversationHistory, question);
}

// POST /chat-stream - HALO medical chatbot (streaming SSE)
router.post('/chat-stream', async (req: Request, res: Response) => {
  try {
    const { patientId, question, history } = req.body as {
      patientId?: string;
      question?: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!patientId || !question || typeof question !== 'string') {
      res.status(400).json({ error: 'patientId and question are required.' });
      return;
    }

    const token = req.session.accessToken!;
    const prompt = await buildChatContext(token, patientId, question, history || []);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for await (const chunk of generateTextStream(prompt)) {
      const escaped = JSON.stringify(chunk);
      res.write(`data: ${escaped}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed. Please try again.' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'An error occurred.' })}\n\n`);
      res.end();
    }
  }
});

// POST /chat - HALO medical chatbot (non-streaming fallback)
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { patientId, question, history } = req.body as {
      patientId?: string;
      question?: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!patientId || !question || typeof question !== 'string') {
      res.status(400).json({ error: 'patientId and question are required.' });
      return;
    }

    const token = req.session.accessToken!;
    const prompt = await buildChatContext(token, patientId, question, history || []);
    const reply = await generateText(prompt);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.json({ reply: 'I apologize, but I encountered an error processing your question. Please try again.' });
  }
});

// POST /transcribe — returns transcript only (no SOAP/note generation; use Halo generate_note for notes)
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType } = req.body as {
      audioBase64?: string;
      mimeType?: string;
    };

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: 'audioBase64 is required.' });
      return;
    }

    const cleanBase64 = audioBase64.split(',')[1] || audioBase64;
    const audioBuffer = Buffer.from(cleanBase64, 'base64');
    const audioMime = mimeType || 'audio/webm';

    console.log('[ai/transcribe] request', {
      mimeType: audioMime,
      base64Length: cleanBase64.length,
      audioBytes: audioBuffer.length,
      deepgramAvailable: isDeepgramAvailable(),
    });

    if (!isDeepgramAvailable()) {
      console.warn('[ai/transcribe] Deepgram key not set or unavailable, using Gemini fallback');
      const transcript = await transcribeAudio(
        geminiTranscriptionPrompt(undefined),
        cleanBase64,
        audioMime
      );
      console.log('[ai/transcribe] Gemini transcript length', transcript?.length || 0);
      res.json({ transcript: transcript || '', rawTranscript: transcript || '' });
      return;
    }

    let transcript: string;
    try {
      transcript = await transcribeWithDeepgram(audioBuffer, audioMime);
    } catch (err) {
      console.error('[ai/transcribe] Deepgram HTTP transcription failed:', err);
      res.status(502).json({ error: 'Live transcription provider failed. Please try again.' });
      return;
    }

    if (!transcript) {
      res.status(400).json({ error: 'No speech detected in audio.' });
      return;
    }

    console.log('[ai/transcribe] Deepgram transcript length', transcript.length);
    res.json({ transcript, rawTranscript: transcript });
  } catch (err) {
    console.error('[ai/transcribe] Transcribe error:', err);
    res.status(500).json({ error: 'Could not transcribe audio.' });
  }
});

// POST /extract-patient-sticker — Gemini vision: wristband / sticker / note → demographics JSON
router.post('/extract-patient-sticker', async (req: Request, res: Response) => {
  try {
    const { base64Image, mimeType } = req.body as { base64Image?: string; mimeType?: string };

    if (!base64Image || typeof base64Image !== 'string') {
      res.status(400).json({ error: 'base64Image is required.' });
      return;
    }

    const cleanBase64 = base64Image.split(',')[1] || base64Image;
    const mime = mimeType && /^image\/(jpeg|png|gif|webp|bmp)$/i.test(mimeType) ? mimeType : 'image/jpeg';

    const raw = await analyzeImage(patientStickerExtractionPrompt(), cleanBase64, mime);
    const fallback: ExtractedPatientSticker = {
      name: '',
      dob: '',
      sex: null,
      idNumber: '',
      folderNumber: '',
      ward: '',
      rawNotes: '',
      medicalAidName: '',
      medicalAidPackage: '',
      medicalAidMemberNumber: '',
      medicalAidPhone: '',
    };
    const parsed = safeJsonParse<ExtractedPatientSticker>(raw, fallback);
    let sex = parsed.sex;
    if (sex !== 'M' && sex !== 'F') sex = null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    res.json({
      ...parsed,
      sex,
      name: str(parsed.name),
      dob: str(parsed.dob),
      idNumber: str(parsed.idNumber),
      folderNumber: str(parsed.folderNumber),
      ward: str(parsed.ward),
      rawNotes: str(parsed.rawNotes),
      medicalAidName: str(parsed.medicalAidName),
      medicalAidPackage: str(parsed.medicalAidPackage),
      medicalAidMemberNumber: str(parsed.medicalAidMemberNumber),
      medicalAidPhone: str(parsed.medicalAidPhone),
    });
  } catch (err) {
    console.error('[ai/extract-patient-sticker] error:', err);
    res.status(500).json({ error: 'Could not read image. Try a clearer photo.' });
  }
});

// POST /consult-context-smart — any uploaded clinical file: vision or text extraction + fallbacks
router.post('/consult-context-smart', async (req: Request, res: Response) => {
  try {
    const { patientId, fileId, name, mimeType } = req.body as {
      patientId?: string;
      fileId?: string;
      name?: string;
      mimeType?: string;
    };

    if (!patientId || !fileId) {
      res.status(400).json({ error: 'patientId and fileId are required.' });
      return;
    }

    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const proxy = await adapter.proxyFile({ token, fileId, microsoftStorageMode });
    const fname = (typeof name === 'string' && name.trim() ? name.trim() : proxy.filename) || 'upload';
    const mimeRaw = (mimeType || proxy.mimeType || '').split(';')[0].trim().toLowerCase();
    const lower = fname.toLowerCase();
    const isImage =
      mimeRaw.startsWith('image/') ||
      /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i.test(lower);

    if (isImage) {
      const buf = proxy.data;
      if (!buf.length) {
        res.status(500).json({ error: 'Downloaded image was empty.' });
        return;
      }
      const b64 = buf.toString('base64');
      let gm = mimeRaw.startsWith('image/') ? mimeRaw : 'image/jpeg';
      if (!/^image\/(jpeg|png|gif|webp|bmp|heic|heif|svg\+xml)$/i.test(gm)) {
        gm = 'image/jpeg';
      }
      const summary = await summarizeConsultContextImage(b64, gm, fname);
      res.json({ summary });
      return;
    }

    const dummyFile = {
      id: fileId,
      name: fname,
      mimeType: mimeType || proxy.mimeType || 'application/octet-stream',
    };

    const extracted = await adapter.extractTextFromFile({
      token,
      file: dummyFile,
      maxChars: 8000,
      microsoftStorageMode,
    });

    if (extracted.trim()) {
      const raw = await generateText(consultContextDocumentPrompt(fname, extracted));
      res.json({ summary: (raw || '').trim() });
      return;
    }

    const fb = await generateText(
      consultContextBinaryFallbackPrompt(fname, dummyFile.mimeType || mimeRaw || 'unknown')
    );
    res.json({ summary: (fb || '').trim() });
  } catch (err) {
    console.error('[ai/consult-context-smart] error:', err);
    res.status(500).json({ error: 'Could not build context from this upload.' });
  }
});

// POST /consult-context-from-image — vision: scans/diagrams → Markdown for note context
router.post('/consult-context-from-image', async (req: Request, res: Response) => {
  try {
    const { base64Image, mimeType, fileName } = req.body as {
      base64Image?: string;
      mimeType?: string;
      fileName?: string;
    };

    if (!base64Image || typeof base64Image !== 'string') {
      res.status(400).json({ error: 'base64Image is required.' });
      return;
    }

    const cleanBase64 = base64Image.split(',')[1] || base64Image;
    const mime =
      mimeType && /^image\/(jpeg|png|gif|webp|bmp|heic|heif)$/i.test(mimeType) ? mimeType : 'image/jpeg';
    const fname =
      typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'consult-context-image';

    const summary = await summarizeConsultContextImage(cleanBase64, mime, fname);
    res.json({ summary });
  } catch (err) {
    console.error('[ai/consult-context-from-image] error:', err);
    res.status(500).json({ error: 'Could not analyse image for context. Check GEMINI_API_KEY and try again.' });
  }
});

// POST /consult-context-from-file — extracted text from PDF/DOCX → Markdown context
router.post('/consult-context-from-file', async (req: Request, res: Response) => {
  try {
    const { patientId, fileId, name, mimeType } = req.body as {
      patientId?: string;
      fileId?: string;
      name?: string;
      mimeType?: string;
    };

    if (!patientId || !fileId) {
      res.status(400).json({ error: 'patientId and fileId are required.' });
      return;
    }

    const token = req.session.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const dummyFile = {
      id: fileId,
      name: name || 'Uploaded file',
      mimeType: mimeType || 'application/octet-stream',
    };

    const extracted = await extractTextFromFile(token, dummyFile, 8000);
    if (!extracted.trim()) {
      res.json({
        summary:
          '_No extractable text in this file. If it is a scan or photo, upload it as an image (JPG/PNG) from Context → Upload._',
      });
      return;
    }

    const raw = await generateText(consultContextDocumentPrompt(dummyFile.name, extracted));
    res.json({ summary: (raw || '').trim() });
  } catch (err) {
    console.error('[ai/consult-context-from-file] error:', err);
    res.status(500).json({ error: 'Could not build context from file.' });
  }
});

// POST /draft-discharge-summary — structured admission/ward text → Markdown discharge summary
router.post('/draft-discharge-summary', async (req: Request, res: Response) => {
  try {
    const { patientName, clinicalContext } = req.body as {
      patientName?: string;
      clinicalContext?: string;
    };

    if (!patientName?.trim() || typeof clinicalContext !== 'string' || !clinicalContext.trim()) {
      res.status(400).json({ error: 'patientName and clinicalContext are required.' });
      return;
    }

    const text = await generateText(
      dischargeSummaryPrompt(patientName.trim(), clinicalContext.trim())
    );
    res.json({ text: (text || '').trim() });
  } catch (err) {
    console.error('[ai/draft-discharge-summary] error:', err);
    res.status(500).json({ error: 'Could not draft discharge summary.' });
  }
});

export default router;
