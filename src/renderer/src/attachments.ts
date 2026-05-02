import type { MessageImage } from '@shared/types';

export interface PendingAttachment {
  id: string;
  /** base64 data URL for thumbnail previews */
  dataUrl: string;
  mime: string;
  filename: string;
  /** base64 without the data: prefix, for send-time */
  base64: string;
}

const SUPPORTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function isSupportedImage(mime: string): boolean {
  return SUPPORTED_MIME.has(mime);
}

/** Convert a File / Blob to base64 + data URL. Safe up to ~10 MB. */
export async function fileToAttachment(file: File): Promise<PendingAttachment> {
  if (!isSupportedImage(file.type)) {
    throw new Error(
      `Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPEG, WEBP, or GIF.`,
    );
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked binary-string conversion avoids argument-length limits for large files.
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  const base64 = btoa(binary);
  const dataUrl = `data:${file.type};base64,${base64}`;
  return {
    id: Math.random().toString(36).slice(2, 10),
    dataUrl,
    mime: file.type,
    filename: file.name || 'pasted-image',
    base64,
  };
}

export function attachmentToMessageImage(a: PendingAttachment): MessageImage {
  return { mime: a.mime, base64: a.base64, filename: a.filename };
}
