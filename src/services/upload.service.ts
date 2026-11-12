import { UploadApiResponse } from 'cloudinary';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { HttpError } from '../middleware/httpError';
import { DetectedAttachment } from '../middleware/upload';

export async function uploadAvatarImage(
  buffer: Buffer,
  userId: string,
): Promise<UploadApiResponse> {
  if (!isCloudinaryConfigured)
    throw new HttpError(503, 'Image storage is not configured');

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'chat-app/avatars',
          public_id: userId, // نفس المعرّف: الصورة الجديدة تستبدل القديمة تلقائياً
          overwrite: true,
          invalidate: true,
          resource_type: 'image',
          transformation: [
            { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
          ],
        },
        (err, result) => (err || !result ? reject(err) : resolve(result)),
      )
      .end(buffer);
  });
}

export async function uploadAttachment(
  buffer: Buffer,
  d: DetectedAttachment,
  id: string,
): Promise<UploadApiResponse> {
  if (!isCloudinaryConfigured)
    throw new HttpError(503, 'File storage is not configured');

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'chat-app/attachments',
          // الملفات غير الصور (raw) تحتاج الامتداد داخل public_id
          public_id: d.kind === 'image' ? id : `${id}.${d.ext}`,
          resource_type: d.kind === 'image' ? 'image' : 'raw',
          unique_filename: false,
          use_filename: false,
        },
        (err, result) => (err || !result ? reject(err) : resolve(result)),
      )
      .end(buffer);
  });
}

/** حذف أفضل جهد: فشله لا يوقف العملية */
export async function destroyAssets(
  assets: { publicId: string | null; mimeType: string }[],
) {
  if (!isCloudinaryConfigured) return;
  await Promise.allSettled(
    assets
      .filter((a) => a.publicId)
      .map((a) =>
        cloudinary.uploader.destroy(a.publicId!, {
          resource_type: a.mimeType.startsWith('image/') ? 'image' : 'raw',
          invalidate: true,
        }),
      ),
  );
}
