import multer from 'multer';

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('avatar');

export function detectImageMime(
  buf: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 },
}).single('file');

export interface DetectedAttachment {
  kind: 'image' | 'file';
  mime: string;
  ext: string;
}

const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

const extensionOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};

/** يحدد النوع من محتوى الملف. null = غير مسموح */
export function detectAttachment(
  buf: Buffer,
  originalName: string,
): DetectedAttachment | null {
  const img = detectImageMime(buf);
  if (img)
    return {
      kind: 'image',
      mime: img,
      ext: img === 'image/jpeg' ? 'jpg' : img.split('/')[1],
    };
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8')
    return { kind: 'image', mime: 'image/gif', ext: 'gif' };

  const ext = extensionOf(originalName);
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-' && ext === 'pdf') {
    return { kind: 'file', mime: 'application/pdf', ext };
  }
  const isZip =
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 3 &&
    buf[3] === 4;
  if (isZip && ext in OOXML)
    return { kind: 'file', mime: OOXML[ext as keyof typeof OOXML], ext };
  if (ext === 'txt' && !buf.subarray(0, 8192).includes(0))
    return { kind: 'file', mime: 'text/plain', ext };
  return null;
}

/** اسم ملف آمن. multer يفك ترميز الاسم كـ latin1 فنصلحه لـ UTF-8 (مهم للأسماء العربية) */
export function cleanFileName(raw: string, d: DetectedAttachment) {
  let name = /[^\x00-\xff]/.test(raw)
    ? raw
    : Buffer.from(raw, 'latin1').toString('utf8');
  name = name
    .replace(/^.*[\\/]/, '')
    .replace(/[\x00-\x1f<>:"|?*]+/g, '_')
    .trim();
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name) || 'file';
  return `${base.slice(0, 100)}.${d.ext}`;
}
