import { prisma } from '../config/prisma';
import { HttpError } from '../middleware/httpError';
import { detectImageMime } from '../middleware/upload';
import { uploadAvatarImage } from './upload.service';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
export const selfSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  statusText: true,
  createdAt: true,
} as const;

export const peerSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  statusText: true,
  isOnline: true,
  lastSeenAt: true,
} as const;

export const updateProfile = (
  userId: string,
  data: { displayName?: string; statusText?: string | null },
) => prisma.user.update({ where: { id: userId }, data, select: selfSelect });

export async function setAvatar(userId: string, buffer: Buffer) {
  if (!detectImageMime(buffer))
    throw new HttpError(400, 'Invalid image (JPEG, PNG or WEBP only)');
  const result = await uploadAvatarImage(buffer, userId);
  return prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: result.secure_url },
    select: selfSelect,
  });
}

export const searchUsers = (userId: string, q: string) =>
  prisma.user.findMany({
    where: {
      id: { not: userId },
      OR: [{ username: { contains: q } }, { displayName: { contains: q } }],
    },
    select: peerSelect,
    orderBy: { displayName: 'asc' },
    take: 20,
  });

export async function removeAvatar(userId: string) {
  if (isCloudinaryConfigured) {
    await cloudinary.uploader
      .destroy(`chat-app/avatars/${userId}`, {
        resource_type: 'image',
        invalidate: true,
      })
      .catch(() => {});
  }
  return prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: selfSelect,
  });
}
